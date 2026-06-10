// Renderer-facing surface of the RTS boundary schemas. The schema source of
// truth lives in workspace-server next to the services that validate with it;
// @posthog/ui must not depend on workspace-server directly, so this file
// re-exports the pure (zod-only, no Node) pieces the RTS UI consumes through
// the host-router package it already depends on for tRPC types.

export {
  genderForName,
  type HogletGender,
} from "@posthog/workspace-server/services/rts/hoglet-names";
export type {
  AdoptHogletInput,
  GoalDraftTranscriptMessage,
  GoalSpecBootstrapContext,
  GoalSpecDraft,
  HedgehogStateView,
  Hoglet,
  HogletWatchEvent,
  HogletWatchScope,
  ImportedSpecFile,
  InjectPromptEventPayload,
  ListHogletsInput,
  Nest,
  NestMessage,
  NestMessageKind,
  NestWatchEvent,
  PrDependencyView,
  PrGraphWatchEvent,
  RebaseChildEventPayload,
  ReleaseHogletInput,
  UpdateNestInput,
} from "@posthog/workspace-server/services/rts/schemas";
export {
  goalDraftTranscriptMessage,
  goalSpecDraft,
  MAX_GOAL_DRAFT_TRANSCRIPT,
  MAX_SPEC_FILE_BYTES,
} from "@posthog/workspace-server/services/rts/schemas";
