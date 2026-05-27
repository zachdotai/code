import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { unzipAsync } from "@main/utils/extract-zip";
import type { NativeAgentToolDefinition } from "@posthog/agent/types";
import type { IBundledResources } from "@posthog/platform/bundled-resources";
import type { IStoragePaths } from "@posthog/platform/storage-paths";
import type {
  ExtensionChangedPayload,
  ExtensionCommandContribution,
  ExtensionInfo,
  ExtensionPromptContribution,
  ExtensionSidebarContribution,
  ExtensionToolContribution,
} from "@shared/types/extensions";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import { parseSkillFrontmatter } from "../agent/parse-skill-frontmatter";
import type { SkillInfo } from "../agent/skill-schemas";

const log = logger.scope("extensions-service");
const requireExtension = createRequire(import.meta.url);

const PACKAGE_JSON = "package.json";
const PLUGIN_JSON = "plugin.json";
const EXTENSIONS_DIR = "extensions";
const PROMPTS_DIR = "prompts";
const RUNTIME_COMMANDS_DIR = "commands";
const SKILLS_DIR = "skills";
const RUNTIME_PLUGIN_VERSION = "1.0.0";

interface RawPackageJson {
  name?: unknown;
  displayName?: unknown;
  version?: unknown;
  description?: unknown;
  posthogCode?: unknown;
  pi?: unknown;
}

interface ExtensionManifest {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  commands: CommandManifestContribution[];
  prompts: PromptManifestContribution[];
  sidebar: SidebarManifestContribution[];
  skillPaths: string[];
  extensionPaths: string[];
}

interface CommandManifestContribution {
  name: string;
  description: string;
  input?: { hint: string };
}

interface PromptManifestContribution {
  name: string;
  description: string;
  input?: { hint: string };
  path?: string;
}

interface SidebarManifestContribution {
  id: string;
  title: string;
  icon?: string;
  entry: string;
}

interface ExtensionServiceEvents {
  changed: ExtensionChangedPayload;
}

interface ExecuteCommandInput {
  name: string;
  args?: string;
  taskId?: string;
  repoPath?: string | null;
}

interface ExecuteCommandResult {
  handled: boolean;
  message?: string;
  prompt?: string;
}

type ExtensionRuntimeContext = {
  extensionId: string;
  taskId?: string;
  repoPath?: string | null;
};

type ExtensionCommandHandler = (
  args: string | undefined,
  context: ExtensionRuntimeContext & { commandName: string },
) => unknown | Promise<unknown>;

type ExtensionToolHandler = (
  args: Record<string, unknown>,
  context: ExtensionRuntimeContext & { toolName: string },
) => unknown | Promise<unknown>;

interface RegisteredExtensionCommand extends CommandManifestContribution {
  extensionId: string;
  handler: ExtensionCommandHandler;
}

interface ExtensionToolParameter {
  type: "string" | "number" | "boolean";
  description?: string;
  optional?: boolean;
}

interface RegisteredExtensionTool extends ExtensionToolContribution {
  handler: ExtensionToolHandler;
  parameters?: Record<string, ExtensionToolParameter>;
}

interface RegisteredExtensionView {
  extensionId: string;
  id: string;
  location: "sidebar";
  title: string;
  icon?: string;
  entry?: string;
  html?: string;
}

interface ExtensionRuntimeLoadResult {
  commands: RegisteredExtensionCommand[];
  tools: RegisteredExtensionTool[];
  views: RegisteredExtensionView[];
  errors: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readStringArrayProperty(
  record: Record<string, unknown> | null,
  key: string,
): string[] | undefined {
  if (!record || !Object.hasOwn(record, key)) return undefined;
  return asStringArray(record[key]);
}

function rejectUnsupportedResourcePatterns(
  paths: string[],
  resourceType: string,
): void {
  for (const resourcePath of paths) {
    if (
      resourcePath.startsWith("!") ||
      resourcePath.startsWith("+") ||
      /[*?[\]{}]/.test(resourcePath)
    ) {
      throw new Error(
        `Extension ${resourceType} paths must be exact paths; glob, exclusion, and force-include patterns are not supported yet: ${resourcePath}`,
      );
    }
  }
}

function sanitizeExtensionId(name: string): string {
  return name
    .replace(/^@/, "")
    .replace(/[\\/]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .toLowerCase();
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function safeResolve(basePath: string, manifestPath: string): string {
  if (isAbsolute(manifestPath)) {
    throw new Error(`Extension paths must be relative: ${manifestPath}`);
  }
  const resolved = resolve(basePath, manifestPath);
  if (!isPathInside(resolve(basePath), resolved)) {
    throw new Error(`Extension path escapes package: ${manifestPath}`);
  }
  return resolved;
}

function removeMarkdownExtension(filename: string): string {
  return filename.replace(/\.mdx?$/i, "");
}

function normalizePromptName(promptName: string): string {
  const normalized = promptName.replace(/^\/+/, "").trim();
  if (!normalized || /[\\/\s]/.test(normalized)) {
    throw new Error(`Invalid extension prompt name: ${promptName}`);
  }
  return normalized;
}

function normalizeViewId(viewId: string): string {
  const normalized = viewId.trim();
  if (!normalized || /[\\/\s]/.test(normalized)) {
    throw new Error(`Invalid extension view id: ${viewId}`);
  }
  return normalized;
}

function normalizeToolParameters(
  value: unknown,
): Record<string, ExtensionToolParameter> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const parameters: Record<string, ExtensionToolParameter> = {};
  for (const [name, rawParameter] of Object.entries(record)) {
    const parameter = asRecord(rawParameter);
    if (!parameter) {
      throw new Error(`Extension tool parameter ${name} must be an object`);
    }
    const type = parameter.type;
    if (type !== "string" && type !== "number" && type !== "boolean") {
      throw new Error(`Extension tool parameter ${name} has unsupported type`);
    }
    parameters[name] = {
      type,
      description: asString(parameter.description),
      optional: asBoolean(parameter.optional),
    };
  }

  return parameters;
}

function runtimePromptFileName(promptName: string, extension: string): string {
  const safeName = promptName
    .replace(/^\/+/, "")
    .replace(/[\\/]/g, "-")
    .replace(/[^a-zA-Z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!safeName) {
    throw new Error(`Invalid extension prompt name: ${promptName}`);
  }
  return `${safeName}${extension || ".md"}`;
}

function isMarkdownFile(filename: string): boolean {
  return /\.mdx?$/i.test(filename);
}

function isExtensionRuntimeFile(filename: string): boolean {
  return /\.(cjs|mjs|js)$/i.test(filename);
}

function isCommonJsRuntimeFile(filename: string): boolean {
  return /\.(cjs|js)$/i.test(filename);
}

function extractPromptMetadata(
  content: string,
  fallbackName: string,
): { name: string; description: string } {
  const frontmatter = parseSkillFrontmatter(content);
  if (frontmatter) return frontmatter;

  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { name: fallbackName, description: heading ?? "" };
}

interface SkillContribution {
  path: string;
  kind: "directory" | "file";
}

async function collectSkillContributions(
  skillRoot: string,
  includeTopLevelMarkdown = true,
): Promise<SkillContribution[]> {
  if (!existsSync(skillRoot)) return [];

  const rootStat = await stat(skillRoot);
  if (rootStat.isFile()) {
    return isMarkdownFile(skillRoot) ? [{ path: skillRoot, kind: "file" }] : [];
  }

  if (existsSync(join(skillRoot, "SKILL.md"))) {
    return [{ path: skillRoot, kind: "directory" }];
  }

  const entries = await readdir(skillRoot, { withFileTypes: true });
  const contributions: SkillContribution[] = [];

  for (const entry of entries) {
    const entryPath = join(skillRoot, entry.name);
    if (
      entry.isFile() &&
      includeTopLevelMarkdown &&
      isMarkdownFile(entry.name)
    ) {
      contributions.push({ path: entryPath, kind: "file" });
    } else if (entry.isDirectory()) {
      contributions.push(
        ...(await collectSkillContributions(entryPath, false)),
      );
    }
  }

  return contributions;
}

async function countSkillDirs(skillRoot: string): Promise<number> {
  return (await collectSkillContributions(skillRoot)).length;
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result;

  const record = asRecord(result);
  const message = asString(record?.message);
  const prompt = asString(record?.prompt);
  if (message && prompt) return `${message}\n\n${prompt}`;
  if (prompt) return prompt;
  if (message) return message;
  if (result === undefined) return "Done";
  return JSON.stringify(result);
}

@injectable()
export class ExtensionService extends TypedEventEmitter<ExtensionServiceEvents> {
  constructor(
    @inject(MAIN_TOKENS.StoragePaths)
    private readonly storagePaths: IStoragePaths,
    @inject(MAIN_TOKENS.BundledResources)
    private readonly bundledResources: IBundledResources,
  ) {
    super();
  }

  private get extensionsDir(): string {
    return join(this.storagePaths.appDataPath, "extensions");
  }

  private get runtimePluginsDir(): string {
    return join(this.storagePaths.appDataPath, "plugins", "extensions");
  }

  private get bundledExtensionsDir(): string {
    return this.bundledResources.resolve(".vite/build/extensions");
  }

  async list(): Promise<ExtensionInfo[]> {
    const manifests = await this.listManifests();
    const extensions: ExtensionInfo[] = [];

    for (const { installPath } of manifests) {
      try {
        extensions.push(await this.readInstalledExtension(installPath));
      } catch (error) {
        log.warn("Skipping invalid extension", {
          installPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return extensions.sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  async listCommands(): Promise<ExtensionCommandContribution[]> {
    const commands = await this.loadExtensionCommands();
    return commands.map(({ handler: _handler, ...command }) => command);
  }

  async listPrompts(): Promise<ExtensionPromptContribution[]> {
    const extensions = await this.list();
    return extensions.flatMap((extension) => extension.prompts);
  }

  async executeCommand(
    input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult> {
    const commands = await this.loadExtensionCommands();
    const command = commands.find((item) => item.name === input.name);
    if (!command) return { handled: false };

    const result = await command.handler(input.args, {
      commandName: command.name,
      extensionId: command.extensionId,
      taskId: input.taskId,
      repoPath: input.repoPath,
    });

    if (typeof result === "string") {
      return { handled: true, message: result };
    }

    const record = asRecord(result);
    const commandResult: ExecuteCommandResult = { handled: true };
    const message = asString(record?.message);
    const prompt = asString(record?.prompt);
    if (message) commandResult.message = message;
    if (prompt) commandResult.prompt = prompt;
    return commandResult;
  }

  async listSidebar(): Promise<ExtensionSidebarContribution[]> {
    const extensions = await this.list();
    return extensions.flatMap((extension) => extension.sidebar);
  }

  async listSkills(): Promise<SkillInfo[]> {
    const extensions = await this.listManifests();
    const skills: SkillInfo[] = [];

    for (const extension of extensions) {
      for (const skillPath of extension.manifest.skillPaths) {
        const absolutePath = safeResolve(extension.installPath, skillPath);
        skills.push(
          ...(await this.readSkillMetadataFromContribution(
            extension.manifest.displayName,
            absolutePath,
          )),
        );
      }
    }

    return skills;
  }

  async installFromZip(zipPath: string): Promise<ExtensionInfo> {
    const tempRoot = await mkdtemp(join(tmpdir(), "posthog-code-extension-"));
    const extractDir = join(tempRoot, "extract");

    try {
      await mkdir(extractDir, { recursive: true });
      await this.extractZipSafely(zipPath, extractDir);
      const packageRoot = await this.findPackageRoot(extractDir);
      const manifest = await this.readManifest(packageRoot);
      const targetPath = join(this.extensionsDir, manifest.id);

      await mkdir(this.extensionsDir, { recursive: true });
      await rm(targetPath, { recursive: true, force: true });
      await cp(packageRoot, targetPath, { recursive: true });
      await this.ensurePluginJson(targetPath, manifest);

      const installed = await this.readInstalledExtension(targetPath);
      await this.emitChanged();
      return installed;
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  async uninstall(extensionId: string): Promise<void> {
    const safeId = sanitizeExtensionId(extensionId);
    if (safeId !== extensionId) {
      throw new Error(`Invalid extension id: ${extensionId}`);
    }

    await rm(join(this.extensionsDir, extensionId), {
      recursive: true,
      force: true,
    });
    await rm(join(this.runtimePluginsDir, extensionId), {
      recursive: true,
      force: true,
    });
    await this.emitChanged();
  }

  async getAgentTools(): Promise<NativeAgentToolDefinition[]> {
    const tools = await this.loadExtensionTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      handler: async (args, context) => {
        const result = await tool.handler(args, {
          toolName: tool.name,
          extensionId: tool.extensionId,
          taskId: context.taskId,
          repoPath: context.cwd,
        });
        return formatToolResult(result);
      },
    }));
  }

  async getAgentPluginPaths(): Promise<{ type: "local"; path: string }[]> {
    const extensions = await this.listManifests();
    const paths: { type: "local"; path: string }[] = [];

    await mkdir(this.runtimePluginsDir, { recursive: true });

    for (const extension of extensions) {
      if (
        extension.manifest.skillPaths.length === 0 &&
        extension.manifest.prompts.length === 0
      ) {
        continue;
      }

      const runtimePath = join(this.runtimePluginsDir, extension.manifest.id);
      await rm(runtimePath, { recursive: true, force: true });
      await mkdir(runtimePath, { recursive: true });
      await this.materializeRuntimePluginJson(extension, runtimePath);
      await this.materializeRuntimeSkills(extension, runtimePath);
      await this.materializeRuntimePrompts(extension, runtimePath);
      paths.push({ type: "local", path: runtimePath });
    }

    return paths;
  }

  private async emitChanged(): Promise<void> {
    this.emit("changed", { extensions: await this.list() });
  }

  private async readInstalledExtension(
    installPath: string,
  ): Promise<ExtensionInfo> {
    const manifest = await this.readManifest(installPath);
    const staticSidebar = manifest.sidebar.map((item) => {
      const entryPath = safeResolve(installPath, item.entry);
      return {
        extensionId: manifest.id,
        id: `${manifest.id}.${item.id}`,
        title: item.title,
        icon: item.icon,
        entry: item.entry,
        url: pathToFileURL(entryPath).toString(),
      } satisfies ExtensionSidebarContribution;
    });

    let skillCount = 0;
    for (const skillPath of manifest.skillPaths) {
      skillCount += await countSkillDirs(safeResolve(installPath, skillPath));
    }

    const runtimeResult = await this.loadRuntimeContributionsForExtension(
      manifest,
      installPath,
    );
    const runtimeSidebar = runtimeResult.views.map((view) =>
      this.registeredViewToSidebarContribution(view, installPath),
    );

    return {
      id: manifest.id,
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      description: manifest.description,
      installPath,
      commands: runtimeResult.commands.map(
        ({ handler: _handler, ...command }) => command,
      ),
      prompts: manifest.prompts.map((prompt) => ({
        extensionId: manifest.id,
        name: prompt.name,
        description: prompt.description,
        input: prompt.input,
      })),
      tools: runtimeResult.tools.map(({ handler: _handler, ...tool }) => tool),
      sidebar: [...staticSidebar, ...runtimeSidebar],
      skillCount,
      loadErrors: runtimeResult.errors,
    };
  }

  private async listManifests(): Promise<
    Array<{ installPath: string; manifest: ExtensionManifest }>
  > {
    const manifests = new Map<
      string,
      { installPath: string; manifest: ExtensionManifest }
    >();

    const addManifestsFromDir = async (rootDir: string) => {
      if (!existsSync(rootDir)) return;
      const entries = await readdir(rootDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const installPath = join(rootDir, entry.name);
        try {
          const manifest = await this.readManifest(installPath);
          manifests.set(manifest.id, { installPath, manifest });
        } catch (error) {
          log.warn("Skipping invalid extension manifest", {
            installPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    await addManifestsFromDir(this.bundledExtensionsDir);
    await mkdir(this.extensionsDir, { recursive: true });
    await addManifestsFromDir(this.extensionsDir);

    return [...manifests.values()];
  }

  private async readManifest(packageRoot: string): Promise<ExtensionManifest> {
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, PACKAGE_JSON), "utf-8"),
    ) as RawPackageJson;

    const name = asString(packageJson.name);
    if (!name) throw new Error("Extension package.json must include a name");

    const id = sanitizeExtensionId(name);
    if (!id) throw new Error(`Extension name cannot be used as an id: ${name}`);

    const displayName = asString(packageJson.displayName) ?? name;
    const version = asString(packageJson.version) ?? "0.0.0";
    const description = asString(packageJson.description);
    const codeConfig = asRecord(packageJson.posthogCode);
    const piConfig = asRecord(packageJson.pi);

    return {
      id,
      name,
      displayName,
      version,
      description,
      commands: [],
      prompts: await this.resolvePrompts(packageRoot, codeConfig, piConfig),
      sidebar: this.resolveSidebar(packageRoot, codeConfig),
      skillPaths: this.resolveSkillPaths(packageRoot, codeConfig, piConfig),
      extensionPaths: await this.resolveExtensionPaths(
        packageRoot,
        codeConfig,
        piConfig,
      ),
    };
  }

  private async resolvePrompts(
    packageRoot: string,
    codeConfig: Record<string, unknown> | null,
    piConfig: Record<string, unknown> | null,
  ): Promise<PromptManifestContribution[]> {
    const promptFiles = await this.resolvePromptFiles(
      packageRoot,
      codeConfig,
      piConfig,
    );
    const prompts = await Promise.all(
      promptFiles.map((path) => this.readPromptContribution(packageRoot, path)),
    );

    const byName = new Map<string, PromptManifestContribution>();
    for (const prompt of prompts) {
      byName.set(prompt.name, prompt);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async resolvePromptFiles(
    packageRoot: string,
    codeConfig: Record<string, unknown> | null,
    piConfig: Record<string, unknown> | null,
  ): Promise<string[]> {
    const explicitCodePrompts = readStringArrayProperty(codeConfig, "prompts");
    const explicitPiPrompts = readStringArrayProperty(piConfig, "prompts");
    const promptRoots = explicitCodePrompts ?? explicitPiPrompts;
    if (promptRoots) rejectUnsupportedResourcePatterns(promptRoots, "prompt");
    const resolvedRoots =
      promptRoots ??
      (existsSync(join(packageRoot, PROMPTS_DIR)) ? [PROMPTS_DIR] : []);

    const files: string[] = [];
    for (const promptRoot of resolvedRoots) {
      const absolutePath = safeResolve(packageRoot, promptRoot);
      if (!existsSync(absolutePath)) {
        throw new Error(`Extension prompt path not found: ${promptRoot}`);
      }

      const promptStat = await stat(absolutePath);
      if (promptStat.isDirectory()) {
        files.push(...(await this.collectPromptFiles(packageRoot, promptRoot)));
      } else if (promptStat.isFile() && isMarkdownFile(promptRoot)) {
        files.push(promptRoot);
      } else if (promptRoots) {
        throw new Error(
          `Extension prompt path is not a markdown file: ${promptRoot}`,
        );
      }
    }

    return [...new Set(files)].sort();
  }

  private async collectPromptFiles(
    packageRoot: string,
    relativeDir: string,
  ): Promise<string[]> {
    const absoluteDir = safeResolve(packageRoot, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        files.push(
          ...(await this.collectPromptFiles(packageRoot, relativePath)),
        );
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        files.push(relativePath);
      }
    }

    return files;
  }

  private async readPromptContribution(
    packageRoot: string,
    promptPath: string,
  ): Promise<PromptManifestContribution> {
    const content = await readFile(
      safeResolve(packageRoot, promptPath),
      "utf-8",
    );
    const metadata = extractPromptMetadata(
      content,
      removeMarkdownExtension(basename(promptPath)),
    );

    return {
      name: normalizePromptName(metadata.name),
      description: metadata.description,
      path: promptPath,
    };
  }

  private async resolveExtensionPaths(
    packageRoot: string,
    codeConfig: Record<string, unknown> | null,
    piConfig: Record<string, unknown> | null,
  ): Promise<string[]> {
    const explicitCodeExtensions = readStringArrayProperty(
      codeConfig,
      "extensions",
    );
    const explicitPiExtensions = readStringArrayProperty(
      piConfig,
      "extensions",
    );
    const extensionRoots = explicitCodeExtensions ?? explicitPiExtensions;
    if (extensionRoots) {
      rejectUnsupportedResourcePatterns(extensionRoots, "runtime extension");
    }
    const resolvedRoots =
      extensionRoots ??
      (existsSync(join(packageRoot, EXTENSIONS_DIR)) ? [EXTENSIONS_DIR] : []);

    const files: string[] = [];
    for (const extensionRoot of resolvedRoots) {
      const absolutePath = safeResolve(packageRoot, extensionRoot);
      if (!existsSync(absolutePath)) {
        throw new Error(`Extension runtime path not found: ${extensionRoot}`);
      }

      const extensionStat = await stat(absolutePath);
      if (extensionStat.isDirectory()) {
        const indexPath = join(extensionRoot, "index.js");
        if (existsSync(safeResolve(packageRoot, indexPath))) {
          files.push(indexPath);
        } else {
          files.push(
            ...(await this.collectExtensionFiles(packageRoot, extensionRoot)),
          );
        }
      } else if (
        extensionStat.isFile() &&
        isExtensionRuntimeFile(extensionRoot)
      ) {
        files.push(extensionRoot);
      } else if (extensionRoots) {
        throw new Error(
          `Extension runtime path is not a supported JavaScript file: ${extensionRoot}`,
        );
      }
    }

    return [...new Set(files)].sort();
  }

  private async collectExtensionFiles(
    packageRoot: string,
    relativeDir: string,
  ): Promise<string[]> {
    const absoluteDir = safeResolve(packageRoot, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        files.push(
          ...(await this.collectExtensionFiles(packageRoot, relativePath)),
        );
      } else if (entry.isFile() && isExtensionRuntimeFile(entry.name)) {
        files.push(relativePath);
      }
    }

    return files;
  }

  private resolveSidebar(
    packageRoot: string,
    codeConfig: Record<string, unknown> | null,
  ): SidebarManifestContribution[] {
    const sidebar = codeConfig?.sidebar;
    if (!Array.isArray(sidebar)) return [];

    return sidebar.flatMap((raw) => {
      const item = asRecord(raw);
      if (!item) return [];
      const id = asString(item.id);
      const title = asString(item.title) ?? asString(item.name);
      const entry = asString(item.entry) ?? asString(item.path);
      if (!id || !title || !entry) return [];
      if (!existsSync(safeResolve(packageRoot, entry))) {
        throw new Error(`Extension sidebar entry not found: ${entry}`);
      }
      return [{ id, title, entry, icon: asString(item.icon) }];
    });
  }

  private resolveSkillPaths(
    packageRoot: string,
    codeConfig: Record<string, unknown> | null,
    piConfig: Record<string, unknown> | null,
  ): string[] {
    const explicitCodeSkills = readStringArrayProperty(codeConfig, "skills");
    const explicitPiSkills = readStringArrayProperty(piConfig, "skills");
    const paths = explicitCodeSkills ?? explicitPiSkills;
    if (paths) rejectUnsupportedResourcePatterns(paths, "skill");
    const resolvedPaths =
      paths ?? (existsSync(join(packageRoot, SKILLS_DIR)) ? [SKILLS_DIR] : []);

    const uniquePaths = [...new Set(resolvedPaths)].sort();
    for (const path of uniquePaths) {
      if (!existsSync(safeResolve(packageRoot, path))) {
        throw new Error(`Extension skill path not found: ${path}`);
      }
    }
    return uniquePaths;
  }

  private async readSkillMetadataFromContribution(
    extensionName: string,
    skillRoot: string,
  ): Promise<SkillInfo[]> {
    const contributions = await collectSkillContributions(skillRoot);
    const skills = await Promise.all(
      contributions.map((contribution) =>
        this.readOneSkill(extensionName, contribution),
      ),
    );
    return skills.flat();
  }

  private async readOneSkill(
    extensionName: string,
    contribution: SkillContribution,
  ): Promise<SkillInfo[]> {
    try {
      const skillFilePath =
        contribution.kind === "directory"
          ? join(contribution.path, "SKILL.md")
          : contribution.path;
      const content = await readFile(skillFilePath, "utf-8");
      const frontmatter = parseSkillFrontmatter(content);
      return [
        {
          name:
            frontmatter?.name ??
            (contribution.kind === "directory"
              ? basename(contribution.path)
              : removeMarkdownExtension(basename(contribution.path))),
          description: frontmatter?.description ?? "",
          source: "extension",
          path: contribution.path,
          repoName: extensionName,
        },
      ];
    } catch {
      return [];
    }
  }

  private registeredViewToSidebarContribution(
    view: RegisteredExtensionView,
    installPath: string,
  ): ExtensionSidebarContribution {
    const entryPath = view.entry
      ? safeResolve(installPath, view.entry)
      : undefined;
    return {
      extensionId: view.extensionId,
      id: `${view.extensionId}.${view.id}`,
      title: view.title,
      icon: view.icon,
      entry: view.entry,
      url: entryPath ? pathToFileURL(entryPath).toString() : undefined,
      html: view.html,
    };
  }

  private async loadExtensionTools(): Promise<RegisteredExtensionTool[]> {
    const extensions = (await this.listManifests()).sort((a, b) =>
      a.manifest.id.localeCompare(b.manifest.id),
    );
    const byName = new Map<string, RegisteredExtensionTool>();

    for (const extension of extensions) {
      const { tools } = await this.loadRuntimeContributionsForExtension(
        extension.manifest,
        extension.installPath,
      );
      for (const tool of tools) {
        if (!byName.has(tool.name)) {
          byName.set(tool.name, tool);
        }
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadExtensionCommands(): Promise<RegisteredExtensionCommand[]> {
    const extensions = (await this.listManifests()).sort((a, b) =>
      a.manifest.id.localeCompare(b.manifest.id),
    );
    const byName = new Map<string, RegisteredExtensionCommand>();

    for (const extension of extensions) {
      const { commands } = await this.loadRuntimeContributionsForExtension(
        extension.manifest,
        extension.installPath,
      );
      for (const command of commands) {
        if (!byName.has(command.name)) {
          byName.set(command.name, command);
        }
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadRuntimeContributionsForExtension(
    manifest: ExtensionManifest,
    installPath: string,
  ): Promise<ExtensionRuntimeLoadResult> {
    const commands = new Map<string, RegisteredExtensionCommand>();
    const tools = new Map<string, RegisteredExtensionTool>();
    const views = new Map<string, RegisteredExtensionView>();
    const errors: string[] = [];

    for (const extensionPath of manifest.extensionPaths) {
      const absolutePath = safeResolve(installPath, extensionPath);
      try {
        if (isCommonJsRuntimeFile(absolutePath)) {
          delete requireExtension.cache[requireExtension.resolve(absolutePath)];
        }
        const extensionModule = isCommonJsRuntimeFile(absolutePath)
          ? (requireExtension(absolutePath) as {
              default?: unknown;
              activate?: unknown;
            })
          : ((await import(pathToFileURL(absolutePath).toString())) as {
              default?: unknown;
              activate?: unknown;
            });
        const activate =
          typeof extensionModule === "function"
            ? extensionModule
            : typeof extensionModule.default === "function"
              ? extensionModule.default
              : extensionModule.activate;
        if (typeof activate !== "function") continue;

        await activate({
          registerCommand: (
            name: string,
            options: {
              description?: string;
              input?: { hint?: string };
              argumentHint?: string;
              handler: ExtensionCommandHandler;
            },
          ) => {
            if (typeof options.handler !== "function") {
              throw new Error(
                `Extension command ${name} must provide a handler`,
              );
            }

            const inputHint =
              asString(options.input?.hint) ?? asString(options.argumentHint);
            const command: RegisteredExtensionCommand = {
              extensionId: manifest.id,
              name: normalizePromptName(name),
              description: asString(options.description) ?? "",
              input: inputHint ? { hint: inputHint } : undefined,
              handler: options.handler,
            };
            commands.set(command.name, command);
            return { dispose: () => commands.delete(command.name) };
          },
          registerTool: (
            name: string,
            options: {
              description?: string;
              parameters?: unknown;
              handler: ExtensionToolHandler;
            },
          ) => {
            if (typeof options.handler !== "function") {
              throw new Error(`Extension tool ${name} must provide a handler`);
            }

            const tool: RegisteredExtensionTool = {
              extensionId: manifest.id,
              name: normalizePromptName(name),
              description: asString(options.description) ?? "",
              parameters: normalizeToolParameters(options.parameters),
              handler: options.handler,
            };
            tools.set(tool.name, tool);
            return { dispose: () => tools.delete(tool.name) };
          },
          registerView: (
            id: string,
            options: {
              location: string;
              title?: string;
              icon?: string;
              entry?: string;
              html?: string;
            },
          ) => {
            if (options.location !== "sidebar") {
              throw new Error(
                `Extension view ${id} uses unsupported location: ${options.location}`,
              );
            }

            const normalizedId = normalizeViewId(id);
            const title = asString(options.title);
            if (!title) {
              throw new Error(`Extension view ${id} must provide a title`);
            }

            const entry = asString(options.entry);
            const html = asString(options.html);
            if (!entry && !html) {
              throw new Error(
                `Extension view ${id} must provide either entry or html`,
              );
            }
            if (entry && !existsSync(safeResolve(installPath, entry))) {
              throw new Error(`Extension view entry not found: ${entry}`);
            }

            views.set(normalizedId, {
              extensionId: manifest.id,
              id: normalizedId,
              location: "sidebar",
              title,
              icon: asString(options.icon),
              entry,
              html,
            });
            return { dispose: () => views.delete(normalizedId) };
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${extensionPath}: ${message}`);
        log.warn("Failed to load extension runtime", {
          installPath,
          extensionPath,
          error: message,
        });
      }
    }

    return {
      commands: [...commands.values()],
      tools: [...tools.values()],
      views: [...views.values()],
      errors,
    };
  }

  private async materializeRuntimePluginJson(
    extension: { installPath: string; manifest: ExtensionManifest },
    runtimePath: string,
  ): Promise<void> {
    const sourcePluginJson = join(extension.installPath, PLUGIN_JSON);
    if (existsSync(sourcePluginJson)) {
      await cp(sourcePluginJson, join(runtimePath, PLUGIN_JSON));
      return;
    }

    await this.ensurePluginJson(runtimePath, extension.manifest);
  }

  private async materializeRuntimeSkills(
    extension: { installPath: string; manifest: ExtensionManifest },
    runtimePath: string,
  ): Promise<void> {
    const runtimeSkillsDir = join(runtimePath, SKILLS_DIR);
    for (const skillPath of extension.manifest.skillPaths) {
      const absolutePath = safeResolve(extension.installPath, skillPath);
      const contributions = await collectSkillContributions(absolutePath);
      for (const contribution of contributions) {
        await mkdir(runtimeSkillsDir, { recursive: true });
        if (contribution.kind === "directory") {
          await cp(
            contribution.path,
            join(runtimeSkillsDir, basename(contribution.path)),
            { recursive: true },
          );
        } else {
          const skillName = removeMarkdownExtension(
            basename(contribution.path),
          );
          const targetDir = join(runtimeSkillsDir, skillName);
          await mkdir(targetDir, { recursive: true });
          await cp(contribution.path, join(targetDir, "SKILL.md"));
        }
      }
    }
  }

  private async materializeRuntimePrompts(
    extension: { installPath: string; manifest: ExtensionManifest },
    runtimePath: string,
  ): Promise<void> {
    const commandsDir = join(runtimePath, RUNTIME_COMMANDS_DIR);
    for (const prompt of extension.manifest.prompts) {
      if (!prompt.path) continue;
      const sourcePath = safeResolve(extension.installPath, prompt.path);
      if (!existsSync(sourcePath)) continue;
      await mkdir(commandsDir, { recursive: true });
      await cp(
        sourcePath,
        join(
          commandsDir,
          runtimePromptFileName(prompt.name, extname(sourcePath)),
        ),
      );
    }
  }

  private async ensurePluginJson(
    packageRoot: string,
    manifest: ExtensionManifest,
  ): Promise<void> {
    const pluginJsonPath = join(packageRoot, PLUGIN_JSON);
    if (existsSync(pluginJsonPath)) return;
    await writeFile(
      pluginJsonPath,
      JSON.stringify(
        {
          name: manifest.id,
          description: manifest.description ?? manifest.displayName,
          version: manifest.version || RUNTIME_PLUGIN_VERSION,
        },
        null,
        2,
      ),
    );
  }

  private async extractZipSafely(
    zipPath: string,
    extractDir: string,
  ): Promise<void> {
    const data = await readFile(zipPath);
    const unzipped = await unzipAsync(new Uint8Array(data));

    for (const [filename, content] of Object.entries(unzipped)) {
      const normalized = normalize(filename);
      if (
        normalized.startsWith("..") ||
        isAbsolute(normalized) ||
        normalized.split(/[\\/]+/).includes("..")
      ) {
        throw new Error(`Unsafe zip entry path: ${filename}`);
      }

      const fullPath = resolve(extractDir, normalized);
      if (!isPathInside(resolve(extractDir), fullPath)) {
        throw new Error(`Unsafe zip entry path: ${filename}`);
      }

      if (filename.endsWith("/")) {
        await mkdir(fullPath, { recursive: true });
      } else {
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content);
      }
    }
  }

  private async findPackageRoot(extractDir: string): Promise<string> {
    const directPackage = join(extractDir, PACKAGE_JSON);
    if (existsSync(directPackage)) return extractDir;

    const entries = (await readdir(extractDir, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && entry.name !== "__MACOSX",
    );

    if (entries.length === 1) {
      const nested = join(extractDir, entries[0].name);
      if (existsSync(join(nested, PACKAGE_JSON))) return nested;
    }

    throw new Error("Extension zip must contain a root-level package.json");
  }
}
