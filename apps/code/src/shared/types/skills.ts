export type SkillSource = "bundled" | "user" | "repo" | "marketplace" | "team";

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  repoName?: string;
}
