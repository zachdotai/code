export type SkillSource =
  | "bundled"
  | "user"
  | "repo"
  | "marketplace"
  | "extension";

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  repoName?: string;
}
