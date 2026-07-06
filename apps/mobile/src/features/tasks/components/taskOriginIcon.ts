import {
  Binoculars,
  Broadcast,
  Bug,
  FilmSlate,
  Flask,
  type Icon,
  Lifebuoy,
  Robot,
  SlackLogo,
} from "phosphor-react-native";

export interface TaskOriginIconMeta {
  Icon: Icon;
  label: string;
}

// `user_created` is intentionally absent — those tasks keep the default status
// icon. Extend this when a new origin needs its own badge.
const ORIGIN_PRODUCT_META: Record<string, TaskOriginIconMeta> = {
  slack: { Icon: SlackLogo, label: "Slack" },
  signal_report: { Icon: Broadcast, label: "Signals" },
  signals_scout: { Icon: Binoculars, label: "Signals scout" },
  support_queue: { Icon: Lifebuoy, label: "Support" },
  session_summaries: { Icon: FilmSlate, label: "Session summary" },
  error_tracking: { Icon: Bug, label: "Error tracking" },
  eval_clusters: { Icon: Flask, label: "Evals" },
  automation: { Icon: Robot, label: "Automation" },
};

export function getTaskOriginIcon(
  originProduct?: string,
): TaskOriginIconMeta | undefined {
  return originProduct ? ORIGIN_PRODUCT_META[originProduct] : undefined;
}
