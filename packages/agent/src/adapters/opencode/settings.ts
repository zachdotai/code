import type { BaseSettingsManager } from "../base-acp-agent";

/**
 * SettingsManager for opencode sessions. Unlike codex (which scans
 * ~/.codex/config.toml to disable user MCPs), opencode runs against the
 * config file we generate in a run-private dir, so there's nothing to parse —
 * this just tracks cwd to satisfy the BaseSettingsManager interface.
 */
export class OpencodeSettingsManager implements BaseSettingsManager {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async initialize(): Promise<void> {
    // No-op. Kept async to satisfy the BaseSettingsManager interface.
  }

  getCwd(): string {
    return this.cwd;
  }

  async setCwd(cwd: string): Promise<void> {
    this.cwd = cwd;
  }

  dispose(): void {
    // No-op: no resources to release.
  }
}
