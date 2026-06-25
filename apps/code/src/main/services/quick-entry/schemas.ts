export const QuickEntryServiceEvent = {
  FocusInput: "focus-input",
  Hide: "hide",
  CreateTaskRequested: "create-task-requested",
} as const;

export interface CreateTaskRequest {
  content: string;
  repoPath: string;
  workspaceMode: "local" | "worktree";
  branch: string | null;
  adapter: "claude" | "codex";
  model: string | null;
  reasoningLevel: string | null;
  executionMode: string | null;
}

export interface QuickEntryServiceEvents {
  [QuickEntryServiceEvent.FocusInput]: true;
  [QuickEntryServiceEvent.Hide]: true;
  [QuickEntryServiceEvent.CreateTaskRequested]: CreateTaskRequest;
}

export interface RecentRepoEntry {
  id: string;
  path: string;
  name: string;
  remoteUrl: string | null;
}
