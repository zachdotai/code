import { ContainerModule } from "inversify";
import {
  FEEDBACK_EVENT_REPOSITORY,
  HEDGEHOG_STATE_REPOSITORY,
  HOGLET_REPOSITORY,
  NEST_MESSAGE_REPOSITORY,
  NEST_REPOSITORY,
  OPERATOR_DECISION_REPOSITORY,
  PR_DEPENDENCY_REPOSITORY,
  TICK_LOG_REPOSITORY,
  USAGE_EVENT_REPOSITORY,
} from "../../db/identifiers";
import { FeedbackEventRepository } from "../../db/repositories/rts/feedback-event-repository";
import { HedgehogStateRepository } from "../../db/repositories/rts/hedgehog-state-repository";
import { HogletRepository } from "../../db/repositories/rts/hoglet-repository";
import { NestMessageRepository } from "../../db/repositories/rts/nest-message-repository";
import { NestRepository } from "../../db/repositories/rts/nest-repository";
import { OperatorDecisionRepository } from "../../db/repositories/rts/operator-decision-repository";
import { PrDependencyRepository } from "../../db/repositories/rts/pr-dependency-repository";
import { TickLogRepository } from "../../db/repositories/rts/tick-log-repository";
import { UsageEventRepository } from "../../db/repositories/rts/usage-event-repository";
import { AffinityRouterService } from "./affinity-router";
import { CloudTaskClient } from "./cloud-task-client";
import { FeedbackRoutingService } from "./feedback-routing-service";
import { GoalSpecDraftService } from "./goal-spec-draft-service";
import { HedgehogDecisionRouter } from "./hedgehog-decision-router";
import { HedgehogTickService } from "./hedgehog-tick-service";
import { HogletService } from "./hoglet-service";
import {
  AFFINITY_ROUTER_SERVICE,
  CLOUD_TASK_CLIENT,
  FEEDBACK_ROUTING_SERVICE,
  GOAL_SPEC_DRAFT_SERVICE,
  HEDGEHOG_DECISION_ROUTER,
  HEDGEHOG_TICK_SERVICE,
  HOGLET_SERVICE,
  NEST_CHAT_SERVICE,
  NEST_SERVICE,
  PR_GRAPH_SERVICE,
  RTS_LLM_GATEWAY,
  SIGNAL_INGESTION_SERVICE,
  SPEC_IMPORT_SERVICE,
  USAGE_ATTRIBUTION_SERVICE,
} from "./identifiers";
import { LlmGatewayService } from "./llm-gateway";
import { NestChatService } from "./nest-chat-service";
import { NestService } from "./nest-service";
import { PrGraphService } from "./pr-graph-service";
import { SignalIngestionService } from "./signal-ingestion-service";
import { SpecImportService } from "./spec-import-service";
import { UsageAttributionService } from "./usage-attribution-service";

// RTS_AUTH is a host-bound port (see ports.ts) and is not bound here; the
// host also calls setRtsSettings()/setRtsRootLogger() during composition.
export const rtsModule = new ContainerModule(({ bind }) => {
  bind(NEST_REPOSITORY).to(NestRepository).inSingletonScope();
  bind(NEST_MESSAGE_REPOSITORY).to(NestMessageRepository).inSingletonScope();
  bind(HOGLET_REPOSITORY).to(HogletRepository).inSingletonScope();
  bind(HEDGEHOG_STATE_REPOSITORY)
    .to(HedgehogStateRepository)
    .inSingletonScope();
  bind(FEEDBACK_EVENT_REPOSITORY)
    .to(FeedbackEventRepository)
    .inSingletonScope();
  bind(OPERATOR_DECISION_REPOSITORY)
    .to(OperatorDecisionRepository)
    .inSingletonScope();
  bind(PR_DEPENDENCY_REPOSITORY).to(PrDependencyRepository).inSingletonScope();
  bind(TICK_LOG_REPOSITORY).to(TickLogRepository).inSingletonScope();
  bind(USAGE_EVENT_REPOSITORY).to(UsageEventRepository).inSingletonScope();

  bind(RTS_LLM_GATEWAY).to(LlmGatewayService).inSingletonScope();
  bind(GOAL_SPEC_DRAFT_SERVICE).to(GoalSpecDraftService).inSingletonScope();
  bind(SPEC_IMPORT_SERVICE).to(SpecImportService).inSingletonScope();
  bind(NEST_CHAT_SERVICE).to(NestChatService).inSingletonScope();
  bind(NEST_SERVICE).to(NestService).inSingletonScope();
  bind(AFFINITY_ROUTER_SERVICE).to(AffinityRouterService).inSingletonScope();
  bind(HOGLET_SERVICE).to(HogletService).inSingletonScope();
  bind(CLOUD_TASK_CLIENT).to(CloudTaskClient).inSingletonScope();
  bind(PR_GRAPH_SERVICE).to(PrGraphService).inSingletonScope();
  bind(HEDGEHOG_DECISION_ROUTER).to(HedgehogDecisionRouter).inSingletonScope();
  bind(HEDGEHOG_TICK_SERVICE).to(HedgehogTickService).inSingletonScope();
  bind(FEEDBACK_ROUTING_SERVICE).to(FeedbackRoutingService).inSingletonScope();
  bind(SIGNAL_INGESTION_SERVICE).to(SignalIngestionService).inSingletonScope();
  bind(USAGE_ATTRIBUTION_SERVICE)
    .to(UsageAttributionService)
    .inSingletonScope();
});
