/**
 * Shared status / PR-state vocabulary for the hoglet UI surfaces.
 * BroodHoglet (in-nest sprite) and WildHoglet (on-map sprite) derive their
 * colors, labels, and animations from these tables. The two sprites render
 * differently enough that we don't share a component, but the source of
 * truth for "what does each status mean visually" lives here.
 */

import type { HedgehogAnimation } from "./AnimatedHedgehog";

export type TaskStatus =
  | "not_started"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | null;

export type PrState = "open" | "draft" | "merged" | "closed";

export const ANIMATION_BY_TASK_STATUS: Record<
  NonNullable<TaskStatus>,
  HedgehogAnimation
> = {
  not_started: "idle",
  queued: "idle",
  in_progress: "action",
  completed: "wave",
  failed: "fall",
  cancelled: "idle",
};

/**
 * Signal-backed hoglets render with the robohog skin so the operator can read
 * their provenance at a glance (auto-generated from an Inbox signal vs.
 * operator-summoned). Upstream hedgehog-mode has no robohog "action" frames,
 * so `in_progress` falls back to `walkRobo` — distinct from `completed`
 * (`waveRobo`) so the two states don't conflate.
 */
export const ANIMATION_BY_TASK_STATUS_ROBO: Record<
  NonNullable<TaskStatus>,
  HedgehogAnimation
> = {
  not_started: "idleRobo",
  queued: "idleRobo",
  in_progress: "walkRobo",
  completed: "waveRobo",
  failed: "fallRobo",
  cancelled: "idleRobo",
};

export const FPS_BY_TASK_STATUS: Record<NonNullable<TaskStatus>, number> = {
  not_started: 8,
  queued: 8,
  in_progress: 12,
  completed: 10,
  failed: 10,
  cancelled: 8,
};

/** CSS var color tokens, for `style={{ backgroundColor: PR_DOT_COLOR[state] }}`. */
export const PR_DOT_COLOR: Record<PrState, string> = {
  open: "var(--green-9)",
  draft: "var(--gray-8)",
  merged: "var(--purple-9)",
  closed: "var(--red-9)",
};

/** Radix Badge `color` prop values, for `<Badge color={STATUS_BADGE_COLOR[state]}>`. */
export const STATUS_BADGE_COLOR: Record<
  NonNullable<TaskStatus>,
  "gray" | "blue" | "green" | "red"
> = {
  not_started: "gray",
  queued: "gray",
  in_progress: "blue",
  completed: "green",
  failed: "red",
  cancelled: "gray",
};

export const PR_STATE_LABEL: Record<PrState, string> = {
  open: "open PR",
  draft: "draft PR",
  merged: "merged",
  closed: "closed",
};

export const PR_BADGE_COLOR: Record<
  PrState,
  "green" | "gray" | "purple" | "red"
> = {
  open: "green",
  draft: "gray",
  merged: "purple",
  closed: "red",
};
