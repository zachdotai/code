import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IStoragePaths } from "@posthog/platform/storage-paths";
import { inject, injectable, postConstruct, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import { AuthServiceEvent, type AuthState } from "../auth/schemas";
import type { AuthService } from "../auth/service";
import { captureException } from "../posthog-analytics";

const log = logger.scope("team-skills");

const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const PAGE_LIMIT = 100;

interface TeamSkillsEvents {
  skillsUpdated: true;
}

interface LlmSkill {
  id: number | string;
  name: string;
  description?: string | null;
  body?: string | null;
}

interface PaginatedLlmSkills {
  results: LlmSkill[];
  next: string | null;
}

export const TEAM_SKILLS_DIRNAME = "team-skills";

/**
 * Syncs team skills from the PostHog API into a local directory so they
 * appear in the Skills view and can be loaded by the agent SDK as a
 * synthetic plugin (see {@link discoverExternalPlugins}).
 */
@injectable()
export class TeamSkillsService extends TypedEventEmitter<TeamSkillsEvents> {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private lastProjectId: number | null = null;

  constructor(
    @inject(MAIN_TOKENS.StoragePaths)
    private readonly storagePaths: IStoragePaths,
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {
    super();
  }

  get skillsDir(): string {
    return join(this.storagePaths.appDataPath, TEAM_SKILLS_DIRNAME);
  }

  @postConstruct()
  init(): void {
    this.authService.on(AuthServiceEvent.StateChanged, this.handleAuthChange);

    this.intervalId = setInterval(() => {
      this.sync().catch((err) =>
        log.warn("Periodic team skills sync failed", err),
      );
    }, UPDATE_INTERVAL_MS);

    this.sync().catch((err) => {
      log.warn("Initial team skills sync failed", err);
      captureException(err, {
        source: "team-skills",
        operation: "init",
      });
    });
  }

  private handleAuthChange = (state: AuthState): void => {
    if (
      state.status === "authenticated" &&
      state.projectId !== this.lastProjectId
    ) {
      this.sync().catch((err) =>
        log.warn("Team skills sync after auth change failed", err),
      );
    }
  };

  async sync(): Promise<void> {
    if (this.syncing) return;

    const state = this.authService.getState();
    if (state.status !== "authenticated" || state.projectId == null) {
      return;
    }

    this.syncing = true;
    this.lastProjectId = state.projectId;

    try {
      const { apiHost } = await this.authService.getValidAccessToken();
      const skills = await this.fetchAllSkills(apiHost, state.projectId);
      await this.writeSkillsAtomic(skills);
      this.emit("skillsUpdated", true);
    } catch (err) {
      log.warn("Team skills sync failed", err);
      captureException(err, {
        source: "team-skills",
        operation: "sync",
      });
    } finally {
      this.syncing = false;
    }
  }

  private async fetchAllSkills(
    apiHost: string,
    projectId: number,
  ): Promise<LlmSkill[]> {
    const collected: LlmSkill[] = [];
    let url: string | null =
      `${apiHost}/api/environments/${projectId}/llm_skills/?limit=${PAGE_LIMIT}`;

    while (url) {
      const response = await this.authService.authenticatedFetch(fetch, url);
      if (!response.ok) {
        throw new Error(
          `Fetch llm_skills failed: ${response.status} ${response.statusText}`,
        );
      }
      const page = (await response.json()) as PaginatedLlmSkills;
      if (Array.isArray(page.results)) {
        collected.push(...page.results);
      }
      url = page.next ?? null;
    }

    return collected;
  }

  private async writeSkillsAtomic(skills: LlmSkill[]): Promise<void> {
    const finalDir = this.skillsDir;
    const stagingDir = `${finalDir}.tmp-${Date.now()}`;

    await mkdir(stagingDir, { recursive: true });

    for (const skill of skills) {
      const slug = slugify(skill.name);
      if (!slug) continue;
      const skillDir = join(stagingDir, slug);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        renderSkillMarkdown(skill),
        "utf-8",
      );
    }

    const oldDir = `${finalDir}.old-${Date.now()}`;
    const hadOld = existsSync(finalDir);
    if (hadOld) {
      await rename(finalDir, oldDir);
    }
    try {
      await rename(stagingDir, finalDir);
    } catch (err) {
      // Roll back the rename of the previous directory if the swap fails
      if (hadOld) {
        await rename(oldDir, finalDir).catch(() => {});
      }
      throw err;
    }
    if (hadOld) {
      await rm(oldDir, { recursive: true, force: true });
    }
  }

  @preDestroy()
  cleanup(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.authService.off(AuthServiceEvent.StateChanged, this.handleAuthChange);
  }
}

function slugify(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderSkillMarkdown(skill: LlmSkill): string {
  const name = yamlString(skill.name);
  const description = yamlString(skill.description ?? "");
  const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n`;
  const body = (skill.body ?? "").trimStart();
  return body ? `${frontmatter}\n${body}` : frontmatter;
}

function yamlString(value: string): string {
  // Always single-quote and escape embedded single quotes so multi-line and
  // special-character descriptions round-trip through parseSkillFrontmatter.
  const escaped = value.replace(/'/g, "''").replace(/\r?\n/g, " ");
  return `'${escaped}'`;
}
