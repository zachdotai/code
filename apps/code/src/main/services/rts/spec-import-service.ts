import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { IDialog } from "@posthog/platform/dialog";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import {
  type ImportedSpecFile,
  importedSpecFile,
  MAX_SPEC_FILE_BYTES,
} from "./schemas";

const log = logger.scope("spec-import-service");

const ALLOWED_EXTENSIONS = ["md", "markdown", "mdx", "txt", "text"];
const MAX_NAME_LENGTH = 120; // Matches createNestInput.name / goalSpecDraft.name.

/**
 * Reads a spec document from the operator's workstation so a detailed,
 * hand-written goal can seed a nest verbatim — without funnelling it through
 * the conversational drafting model (which caps messages at 4000 chars and
 * re-drafts into its own structure). The Markdown body is kept intact; we only
 * derive the short fields the create form needs (name + definition of done).
 */
@injectable()
export class SpecImportService {
  constructor(
    @inject(MAIN_TOKENS.Dialog)
    private readonly dialog: IDialog,
  ) {}

  /**
   * Opens a native file picker, reads the chosen spec file, and derives a nest
   * name and definition of done from its Markdown structure. Returns null when
   * the operator cancels the picker.
   */
  async importSpecFile(): Promise<ImportedSpecFile | null> {
    const paths = await this.dialog.pickFile({ title: "Import spec file" });
    const filePath = paths[0];
    if (!filePath) return null;

    const extension = extname(filePath).replace(/^\./, "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw new Error(
        `Unsupported spec file type ".${extension}". Choose a ${ALLOWED_EXTENSIONS.map(
          (ext) => `.${ext}`,
        ).join(", ")} file.`,
      );
    }

    const { size } = await stat(filePath);
    if (size > MAX_SPEC_FILE_BYTES) {
      throw new Error(
        `Spec file is too large (${formatBytes(size)}). The limit is ${formatBytes(
          MAX_SPEC_FILE_BYTES,
        )}.`,
      );
    }

    // Keep the file body byte-for-byte ("verbatim"); only the emptiness check
    // looks at the trimmed form.
    const content = await readFile(filePath, "utf8");
    if (content.trim().length === 0) {
      throw new Error("Spec file is empty.");
    }

    const fileName = basename(filePath);
    const result: ImportedSpecFile = {
      filePath,
      fileName,
      content,
      suggestedName: deriveName(content, fileName),
      definitionOfDone: parseDefinitionOfDone(content),
    };

    log.info("Imported spec file", {
      fileName,
      bytes: size,
      hasDefinitionOfDone: result.definitionOfDone !== null,
    });

    // Validate before it crosses the tRPC boundary so a bad derivation surfaces
    // here rather than as an opaque output-parse error in the renderer.
    return importedSpecFile.parse(result);
  }
}

/** First Markdown H1, falling back to the file name without its extension. */
function deriveName(content: string, fileName: string): string {
  const h1 = content.match(/^#\s+(.+?)\s*$/m);
  const candidate = (h1?.[1] ?? stripExtension(fileName)).trim();
  const name = candidate.length > 0 ? candidate : "Imported spec";
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`
    : name;
}

function stripExtension(fileName: string): string {
  const ext = extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/**
 * Phrases (after numbering/emphasis are stripped) that mark a done-criteria
 * section when no explicit "definition of done" heading is present.
 */
const DOD_SECONDARY_PHRASES = [
  "success criteria",
  "acceptance criteria",
  "completion criteria",
  "done when",
  "exit criteria",
];

type HeadingKind = "primary" | "secondary";

/**
 * Captures the body under the spec's done-criteria heading, up to the next
 * heading of the same or higher level. Prefers an explicit "definition of
 * done" heading (even when buried in a numbered/parenthesised title like
 * "## 14. Success Criteria (measurable — definition of done)"), then falls
 * back to common synonyms. Returns null when no such section exists.
 */
function parseDefinitionOfDone(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const headings = lines.flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (!match) return [];
    const kind = classifyHeading(match[2]);
    return kind ? [{ level: match[1].length, index, kind }] : [];
  });

  const target =
    headings.find((heading) => heading.kind === "primary") ??
    headings.find((heading) => heading.kind === "secondary");
  if (!target) return null;

  const collected: string[] = [];
  for (let i = target.index + 1; i < lines.length; i += 1) {
    const next = lines[i].match(/^(#{1,6})\s+/);
    if (next && next[1].length <= target.level) break;
    collected.push(lines[i]);
  }

  const text = collected.join("\n").trim();
  return text.length > 0 ? text : null;
}

function classifyHeading(text: string): HeadingKind | null {
  const normalized = normalizeHeading(text);
  if (normalized.includes("definition of done")) return "primary";
  if (normalized === "dod") return "secondary";
  if (
    DOD_SECONDARY_PHRASES.some(
      (phrase) => normalized === phrase || normalized.startsWith(`${phrase} `),
    )
  ) {
    return "secondary";
  }
  return null;
}

/** Lowercase, strip emphasis markers, and drop leading "14." / "3.2" numbering. */
function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`:]/g, "")
    .replace(/^\s*\d+(\.\d+)*\.?\s*/, "")
    .trim();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
