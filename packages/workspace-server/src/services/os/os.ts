import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_META_SERVICE, type IAppMeta } from "@posthog/platform/app-meta";
import {
  DIALOG_SERVICE,
  type DialogSeverity,
  type IDialog,
} from "@posthog/platform/dialog";
import {
  type IImageProcessor,
  IMAGE_PROCESSOR_SERVICE,
} from "@posthog/platform/image-processor";
import {
  type IStoragePaths,
  STORAGE_PATHS_SERVICE,
} from "@posthog/platform/storage-paths";
import {
  type IUrlLauncher,
  URL_LAUNCHER_SERVICE,
} from "@posthog/platform/url-launcher";
import {
  type IWorkspaceSettings,
  WORKSPACE_SETTINGS_SERVICE,
} from "@posthog/platform/workspace-settings";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_MIME_TYPES,
  isRasterImageFile,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import type {
  ClaudePermissions,
  ImageAttachment,
  MessageBoxOptions,
  SavedAttachment,
  SelectAttachmentsMode,
  SelectedAttachment,
  UserAgentInstructions,
} from "./schemas";
import { USER_AGENT_INSTRUCTIONS_MAX_LENGTH } from "./schemas";

const fsPromises = fs.promises;

const MAX_IMAGE_DIMENSION = 1568;
const JPEG_QUALITY = 85;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CLIPBOARD_TEMP_DIR = path.join(os.tmpdir(), "posthog-code-clipboard");
const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");

// User-level agent instruction files, most-preferred first: AGENTS.md (the
// cross-agent convention) from any of its conventional homes wins over Claude
// Code's CLAUDE.md.
const USER_AGENT_INSTRUCTIONS_CANDIDATES: ReadonlyArray<[string, string]> = [
  [".agents", "AGENTS.md"],
  [".codex", "AGENTS.md"],
  [".claude", "AGENTS.md"],
  [".claude", "CLAUDE.md"],
];

// Claude Code follows `@path` imports up to four hops deep; we match that so a
// stub CLAUDE.md that only `@`-imports its real rules still syncs those rules.
const USER_AGENT_INSTRUCTIONS_MAX_IMPORT_DEPTH = 4;
const AGENT_IMPORT_PATTERN_SOURCE = "(^|\\s)@(\\S+)";
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

@injectable()
export class OsService {
  constructor(
    @inject(DIALOG_SERVICE)
    private readonly dialog: IDialog,
    @inject(URL_LAUNCHER_SERVICE)
    private readonly urlLauncher: IUrlLauncher,
    @inject(APP_META_SERVICE)
    private readonly appMeta: IAppMeta,
    @inject(IMAGE_PROCESSOR_SERVICE)
    private readonly imageProcessor: IImageProcessor,
    @inject(WORKSPACE_SETTINGS_SERVICE)
    private readonly workspaceSettings: IWorkspaceSettings,
    @inject(STORAGE_PATHS_SERVICE)
    private readonly storagePaths: IStoragePaths,
  ) {}

  async getClaudePermissions(): Promise<ClaudePermissions> {
    try {
      const content = await fsPromises.readFile(claudeSettingsPath, "utf-8");
      const settings = JSON.parse(content);
      return {
        allow: Array.isArray(settings?.permissions?.allow)
          ? settings.permissions.allow
          : [],
        deny: Array.isArray(settings?.permissions?.deny)
          ? settings.permissions.deny
          : [],
      };
    } catch {
      return { allow: [], deny: [] };
    }
  }

  /**
   * The user-level agent instructions file to mirror into personalization:
   * the first non-empty AGENTS.md across its conventional homes, else the
   * user's CLAUDE.md. Null when none exists.
   */
  async getUserAgentInstructions(): Promise<UserAgentInstructions | null> {
    for (const [dir, file] of USER_AGENT_INSTRUCTIONS_CANDIDATES) {
      const filePath = path.join(os.homedir(), dir, file);
      let content: string;
      try {
        content = await fsPromises.readFile(filePath, "utf-8");
      } catch {
        continue;
      }
      if (!content.trim()) continue;

      const realPath = await this.realpathOrSelf(filePath);
      const expanded = await this.expandAgentImports(
        content,
        path.dirname(realPath),
        1,
        new Set([realPath]),
      );
      const truncated = expanded.length > USER_AGENT_INSTRUCTIONS_MAX_LENGTH;
      return {
        path: filePath,
        displayPath: `~/${dir}/${file}`,
        content: truncated
          ? expanded.slice(0, USER_AGENT_INSTRUCTIONS_MAX_LENGTH)
          : expanded,
        truncated,
      };
    }
    return null;
  }

  private async realpathOrSelf(filePath: string): Promise<string> {
    try {
      return await fsPromises.realpath(filePath);
    } catch {
      return filePath;
    }
  }

  private async expandAgentImports(
    content: string,
    baseDir: string,
    depth: number,
    visited: Set<string>,
  ): Promise<string> {
    if (depth > USER_AGENT_INSTRUCTIONS_MAX_IMPORT_DEPTH) return content;

    const lines = content.split("\n");
    const expandedLines: string[] = [];
    let fenceMarker: string | null = null;

    for (const line of lines) {
      const fence = line.match(FENCE_PATTERN);
      if (fence) {
        const marker = fence[1][0];
        if (fenceMarker === null) fenceMarker = marker;
        else if (marker === fenceMarker) fenceMarker = null;
        expandedLines.push(line);
        continue;
      }
      if (fenceMarker !== null) {
        expandedLines.push(line);
        continue;
      }
      expandedLines.push(
        await this.expandImportsInLine(line, baseDir, depth, visited),
      );
    }

    return expandedLines.join("\n");
  }

  private async expandImportsInLine(
    line: string,
    baseDir: string,
    depth: number,
    visited: Set<string>,
  ): Promise<string> {
    // Odd-indexed segments sit inside single-backtick code spans, where
    // Claude Code treats `@path` as literal text rather than an import.
    const segments = line.split("`");
    const rebuilt = await Promise.all(
      segments.map((segment, index) =>
        index % 2 === 0
          ? this.expandImportsInSegment(segment, baseDir, depth, visited)
          : Promise.resolve(segment),
      ),
    );
    return rebuilt.join("`");
  }

  private async expandImportsInSegment(
    segment: string,
    baseDir: string,
    depth: number,
    visited: Set<string>,
  ): Promise<string> {
    const pattern = new RegExp(AGENT_IMPORT_PATTERN_SOURCE, "g");
    let result = "";
    let lastIndex = 0;
    for (const match of segment.matchAll(pattern)) {
      const [full, lead, importPath] = match;
      const matchIndex = match.index ?? 0;
      result += segment.slice(lastIndex, matchIndex) + lead;
      const imported = await this.resolveAgentImport(
        importPath,
        baseDir,
        depth,
        visited,
      );
      result += imported ?? `@${importPath}`;
      lastIndex = matchIndex + full.length;
    }
    result += segment.slice(lastIndex);
    return result;
  }

  private async resolveAgentImport(
    importPath: string,
    baseDir: string,
    depth: number,
    visited: Set<string>,
  ): Promise<string | null> {
    const resolved = importPath.startsWith("~")
      ? path.join(os.homedir(), importPath.slice(1))
      : path.resolve(baseDir, importPath);

    let realPath: string;
    try {
      realPath = await fsPromises.realpath(resolved);
    } catch {
      return null;
    }
    if (visited.has(realPath)) return null;

    let imported: string;
    try {
      imported = await fsPromises.readFile(realPath, "utf-8");
    } catch {
      return null;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(realPath);
    return this.expandAgentImports(
      imported,
      path.dirname(realPath),
      depth + 1,
      nextVisited,
    );
  }

  async selectDirectory(): Promise<string | null> {
    const paths = await this.dialog.pickFile({
      title: "Select a repository folder",
      directories: true,
      createDirectories: true,
    });
    return paths[0] ?? null;
  }

  async selectFiles(): Promise<string[]> {
    return this.dialog.pickFile({
      title: "Select files",
      multiple: true,
    });
  }

  async selectAttachments(
    mode: SelectAttachmentsMode,
  ): Promise<SelectedAttachment[]> {
    const titleByMode = {
      files: "Select files",
      directories: "Select folders",
      both: "Select files or folders",
    } as const;
    const paths = await this.dialog.pickFile({
      title: titleByMode[mode],
      multiple: true,
      directories: mode === "directories",
      filesAndDirectories: mode === "both",
    });
    const statResults = await Promise.all(
      paths.map(async (p) => {
        try {
          const stat = await fsPromises.stat(p);
          return {
            path: p,
            kind: stat.isDirectory()
              ? ("directory" as const)
              : ("file" as const),
          };
        } catch {
          return null;
        }
      }),
    );
    return statResults.filter((r): r is SelectedAttachment => r !== null);
  }

  async checkWriteAccess(directoryPath: string): Promise<boolean> {
    if (!directoryPath) return false;
    try {
      await fsPromises.access(directoryPath, fs.constants.W_OK);
      const testFile = path.join(
        directoryPath,
        `.agent-write-test-${Date.now()}`,
      );
      await fsPromises.writeFile(testFile, "ok");
      await fsPromises.unlink(testFile).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async showMessageBox(
    options: MessageBoxOptions,
  ): Promise<{ response: number }> {
    const severity: DialogSeverity | undefined =
      options?.type && options.type !== "none" ? options.type : undefined;
    const response = await this.dialog.confirm({
      severity,
      title: options?.title || "PostHog Code",
      message: options?.message || "",
      detail: options?.detail,
      options:
        Array.isArray(options?.buttons) && options.buttons.length > 0
          ? options.buttons
          : ["OK"],
      defaultIndex: options?.defaultId ?? 0,
      cancelIndex: options?.cancelId ?? 1,
    });
    return { response };
  }

  async openExternal(url: string): Promise<void> {
    await this.urlLauncher.launch(url);
  }

  async showLogFolder(): Promise<void> {
    await this.urlLauncher.launch(
      pathToFileURL(this.storagePaths.logFolderPath).href,
    );
  }

  async searchDirectories(query: string): Promise<string[]> {
    if (!query?.trim()) return [];

    const searchPath = this.expandHomePath(query.trim());
    const lastSlashIdx = searchPath.lastIndexOf("/");
    const basePath =
      lastSlashIdx === -1 ? "" : searchPath.substring(0, lastSlashIdx + 1);
    const searchTerm =
      lastSlashIdx === -1 ? searchPath : searchPath.substring(lastSlashIdx + 1);
    const pathToRead = basePath || os.homedir();

    try {
      const entries = await fsPromises.readdir(pathToRead, {
        withFileTypes: true,
      });
      const directories = entries.filter((entry) => entry.isDirectory());

      const filtered = searchTerm
        ? directories.filter((dir) =>
            dir.name.toLowerCase().includes(searchTerm.toLowerCase()),
          )
        : directories;

      return filtered
        .map((dir) => path.join(pathToRead, dir.name))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
        .slice(0, 20);
    } catch {
      return [];
    }
  }

  getAppVersion(): string {
    return this.appMeta.version;
  }

  getWorktreeLocation(): string {
    return this.workspaceSettings.getWorktreeLocation();
  }

  async readFileAsDataUrl(
    filePath: string,
    maxSizeBytes: number,
  ): Promise<string | null> {
    try {
      const stat = await fsPromises.stat(filePath);
      if (stat.size > maxSizeBytes) return null;

      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mime = IMAGE_MIME_TYPES[ext];
      if (!mime || !ALLOWED_IMAGE_MIME_TYPES.has(mime)) return null;

      const buffer = await fsPromises.readFile(filePath);
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  }

  async saveClipboardText(
    text: string,
    originalName?: string,
  ): Promise<SavedAttachment> {
    const displayName = path.basename(originalName ?? "pasted-text.txt");
    const filePath = await this.createClipboardTempFilePath(displayName);
    await fsPromises.writeFile(filePath, text, "utf-8");
    return { path: filePath, name: displayName };
  }

  async saveClipboardImage(
    base64Data: string,
    mimeType: string,
    originalName?: string,
  ): Promise<ImageAttachment> {
    const raw = new Uint8Array(Buffer.from(base64Data, "base64"));
    const isGenericName =
      !originalName ||
      originalName === "image.png" ||
      originalName === "image.jpeg" ||
      originalName === "image.jpg";
    const displayName = isGenericName
      ? "clipboard.png"
      : (originalName ?? "clipboard.png");

    return this.downscaleAndPersist(raw, mimeType, displayName);
  }

  async downscaleImageFile(filePath: string): Promise<ImageAttachment> {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (!isRasterImageFile(filePath)) {
      throw new Error(`Unsupported image type: .${ext}`);
    }

    const stat = await fsPromises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `Image too large (${Math.round(stat.size / 1024 / 1024)}MB). Max is 50MB.`,
      );
    }

    const raw = new Uint8Array(await fsPromises.readFile(filePath));
    const inputMime = IMAGE_MIME_TYPES[ext];

    return this.downscaleAndPersist(raw, inputMime, path.basename(filePath));
  }

  async saveClipboardFile(
    base64Data: string,
    originalName?: string,
  ): Promise<SavedAttachment> {
    const displayName = path.basename(originalName ?? "attachment");
    const filePath = await this.createClipboardTempFilePath(displayName);
    await fsPromises.writeFile(filePath, Buffer.from(base64Data, "base64"));
    return { path: filePath, name: displayName };
  }

  private async createClipboardTempFilePath(
    displayName: string,
  ): Promise<string> {
    const safeName = path.basename(displayName) || "attachment";
    await fsPromises.mkdir(CLIPBOARD_TEMP_DIR, { recursive: true });
    const tempDir = await fsPromises.mkdtemp(
      path.join(CLIPBOARD_TEMP_DIR, "attachment-"),
    );
    return path.join(tempDir, safeName);
  }

  private async downscaleAndPersist(
    raw: Uint8Array,
    inputMime: string,
    displayName: string,
  ): Promise<ImageAttachment> {
    const { buffer, mimeType, extension } = this.imageProcessor.downscale(
      raw,
      inputMime,
      { maxDimension: MAX_IMAGE_DIMENSION, jpegQuality: JPEG_QUALITY },
    );

    const finalName = displayName.replace(/\.[^.]+$/, `.${extension}`);
    const filePath = await this.createClipboardTempFilePath(finalName);
    await fsPromises.writeFile(filePath, Buffer.from(buffer));

    return { path: filePath, name: finalName, mimeType };
  }

  private expandHomePath(searchPath: string): string {
    return searchPath.startsWith("~")
      ? searchPath.replace(/^~/, os.homedir())
      : searchPath;
  }
}
