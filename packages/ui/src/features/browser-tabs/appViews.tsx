import {
  BrainIcon,
  HouseIcon,
  PlugsConnectedIcon,
  RobotIcon,
  SquaresFourIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

/**
 * The top-level app pages that can be a pane target. Keyed by useAppView's
 * view.type; each maps to the strip's label + icon (the canonical route lives
 * in tabHref.ts). These pages have no channel, task, or dashboard id, so this
 * is what lets them be a real pane target (label + restore-on-refocus).
 */
export type AppView =
  | "home"
  | "inbox"
  | "agents"
  | "skills"
  | "mcp-servers"
  | "command-center";

export const APP_VIEW_META: Record<
  AppView,
  { label: string; icon: ReactNode }
> = {
  home: { label: "Home", icon: <HouseIcon size={14} /> },
  inbox: { label: "Inbox", icon: <TrayIcon size={14} /> },
  agents: { label: "Agents", icon: <RobotIcon size={14} /> },
  skills: { label: "Skills", icon: <BrainIcon size={14} /> },
  "mcp-servers": {
    label: "MCP servers",
    icon: <PlugsConnectedIcon size={14} />,
  },
  "command-center": {
    label: "Command center",
    icon: <SquaresFourIcon size={14} />,
  },
};

export function isAppView(value: string): value is AppView {
  return value in APP_VIEW_META;
}
