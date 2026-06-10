// The gateway model catalogue logic lives in @posthog/shared so the mobile app
// and the agent/desktop fetch and format the available model list the exact
// same way. Re-exported here to preserve this module's existing public surface
// (consumed via the `@posthog/agent/gateway-models` subpath export).
export {
  DEFAULT_CODEX_MODEL,
  DEFAULT_GATEWAY_MODEL,
  type FetchGatewayModelsOptions,
  fetchGatewayModels,
  fetchModelsList,
  formatGatewayModelName,
  formatModelId,
  type GatewayModel,
  getProviderName,
  isAnthropicModel,
  isBlockedModelId,
  isOpenAIModel,
  type ModelInfo,
  supportsReasoningEffort,
} from "@posthog/shared";
