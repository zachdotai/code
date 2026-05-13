import fs from "node:fs/promises";
import path from "node:path";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { LlmGatewayService } from "../llm-gateway/service";
import { type ScanRepoResult, scanRepoResultSchema } from "./schemas";

const log = logger.scope("feature-scan");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".vscode",
  ".idea",
  ".vite",
  ".pnpm",
  "target",
  ".DS_Store",
]);

const README_MAX_BYTES = 4096;

@injectable()
export class FeatureScanService {
  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llmGateway: LlmGatewayService,
  ) {}

  async scanRepo(repoPath: string): Promise<ScanRepoResult> {
    const repoName = path.basename(repoPath);
    const dirs = await this.listTopLevelDirs(repoPath);
    const readme = await this.readReadmeExcerpt(repoPath);

    log.debug("Scanning repo", {
      repoPath,
      dirCount: dirs.length,
      readmeBytes: readme.length,
    });

    if (dirs.length === 0 && readme.length === 0) {
      return { folders: [] };
    }

    const system =
      "You categorize a software project into 4 to 10 primary feature areas for a navigation UI. " +
      'Output strict JSON of shape `{"folders":[{"name":"...","description":"..."}]}`. ' +
      'Each name is 1 to 3 words, Title Case, human-friendly (e.g. "Authentication", "Billing"). ' +
      "Each description is a short sentence. Output JSON only, no prose, no code fences.";

    const userContent = [
      `Repository: ${repoName}`,
      "",
      "Top-level directories:",
      dirs.length > 0 ? dirs.map((d) => `- ${d}`).join("\n") : "(none)",
      "",
      "README excerpt:",
      readme || "(no README found)",
      "",
      "Return JSON only.",
    ].join("\n");

    const response = await this.llmGateway.prompt(
      [{ role: "user", content: userContent }],
      { system, maxTokens: 1500 },
    );

    return this.parseResponse(response.content);
  }

  private parseResponse(content: string): ScanRepoResult {
    const trimmed = content.trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
      throw new Error("LLM response did not contain JSON object");
    }
    const json = trimmed.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(json);
    return scanRepoResultSchema.parse(parsed);
  }

  private async listTopLevelDirs(repoPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(repoPath, { withFileTypes: true });
      return entries
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith(".") &&
            !SKIP_DIRS.has(e.name),
        )
        .map((e) => e.name)
        .sort();
    } catch (err) {
      log.warn("Failed to read repo directories", { repoPath, err });
      return [];
    }
  }

  private async readReadmeExcerpt(repoPath: string): Promise<string> {
    const candidates = ["README.md", "README.MD", "README", "readme.md"];
    for (const name of candidates) {
      const filePath = path.join(repoPath, name);
      try {
        const handle = await fs.open(filePath, "r");
        try {
          const buffer = Buffer.alloc(README_MAX_BYTES);
          const { bytesRead } = await handle.read(
            buffer,
            0,
            README_MAX_BYTES,
            0,
          );
          return buffer.slice(0, bytesRead).toString("utf8");
        } finally {
          await handle.close();
        }
      } catch {
        // try next
      }
    }
    return "";
  }
}
