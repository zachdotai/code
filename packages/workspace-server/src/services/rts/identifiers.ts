export const NEST_SERVICE = Symbol.for("posthog.workspace.rts.nestService");
export const NEST_CHAT_SERVICE = Symbol.for(
  "posthog.workspace.rts.nestChatService",
);
export const HOGLET_SERVICE = Symbol.for("posthog.workspace.rts.hogletService");
export const CLOUD_TASK_CLIENT = Symbol.for(
  "posthog.workspace.rts.cloudTaskClient",
);
export const PR_GRAPH_SERVICE = Symbol.for(
  "posthog.workspace.rts.prGraphService",
);
export const HEDGEHOG_TICK_SERVICE = Symbol.for(
  "posthog.workspace.rts.hedgehogTickService",
);
export const HEDGEHOG_DECISION_ROUTER = Symbol.for(
  "posthog.workspace.rts.hedgehogDecisionRouter",
);
export const FEEDBACK_ROUTING_SERVICE = Symbol.for(
  "posthog.workspace.rts.feedbackRoutingService",
);
export const GOAL_SPEC_DRAFT_SERVICE = Symbol.for(
  "posthog.workspace.rts.goalSpecDraftService",
);
export const SPEC_IMPORT_SERVICE = Symbol.for(
  "posthog.workspace.rts.specImportService",
);
export const USAGE_ATTRIBUTION_SERVICE = Symbol.for(
  "posthog.workspace.rts.usageAttributionService",
);
export const AFFINITY_ROUTER_SERVICE = Symbol.for(
  "posthog.workspace.rts.affinityRouterService",
);
export const SIGNAL_INGESTION_SERVICE = Symbol.for(
  "posthog.workspace.rts.signalIngestionService",
);
export const RTS_LLM_GATEWAY = Symbol.for("posthog.workspace.rts.llmGateway");

// Host-bound port (see ports.ts). Settings and logging are configured via
// the setRtsSettings()/setRtsRootLogger() module facades instead of DI.
export const RTS_AUTH = Symbol.for("posthog.workspace.rts.auth");
