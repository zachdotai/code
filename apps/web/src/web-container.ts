import "reflect-metadata";
import { TypedContainer } from "@inversifyjs/strongly-typed";
import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE, authCoreModule } from "@posthog/core/auth/auth.module";
import {
  AUTH_CONNECTIVITY,
  AUTH_OAUTH_FLOW_SERVICE,
  AUTH_PREFERENCE_STORE,
  AUTH_SESSION_STORE,
  AUTH_TOKEN_CIPHER,
  AUTH_TOKEN_OVERRIDE,
  type IAuthConnectivity,
  type IAuthOAuthFlowService,
  type IAuthPreferenceStore,
  type IAuthSessionStore,
  type IAuthTokenCipher,
} from "@posthog/core/auth/identifiers";
import type { CloudTaskService } from "@posthog/core/cloud-task/cloud-task";
import { cloudTaskModule } from "@posthog/core/cloud-task/cloud-task.module";
import {
  CLOUD_TASK_AUTH,
  CLOUD_TASK_SERVICE,
  type ICloudTaskAuth,
} from "@posthog/core/cloud-task/identifiers";
import { deepLinksCoreModule } from "@posthog/core/deep-links/deep-links.module";
import {
  GITHUB_ISSUE_CLIENT,
  type GitHubIssueClient,
} from "@posthog/core/deep-links/identifiers";
import { githubConnectModule } from "@posthog/core/integrations/githubConnect.module";
import {
  GITHUB_CONNECT_CLIENT as INTEGRATIONS_GITHUB_CONNECT_CLIENT,
  type GithubConnectClient as IntegrationsGithubConnectClient,
  REPOSITORIES_CLIENT,
  REPOSITORIES_SERVICE,
  type RepositoriesClient,
} from "@posthog/core/integrations/identifiers";
import { RepositoriesService } from "@posthog/core/integrations/repositoriesService";
import {
  GITHUB_CONNECT_CLIENT as ONBOARDING_GITHUB_CONNECT_CLIENT,
  type GithubConnectClient as OnboardingGithubConnectContract,
} from "@posthog/core/onboarding/identifiers";
import { onboardingModule } from "@posthog/core/onboarding/onboarding.module";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { type ISetupStore, SETUP_STORE } from "@posthog/core/setup/identifiers";
import { setupCoreModule } from "@posthog/core/setup/setup.module";
import { setRootContainer } from "@posthog/di/container";
import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import {
  ANALYTICS_SERVICE,
  type IAnalytics,
} from "@posthog/platform/analytics";
import {
  HOST_CAPABILITIES,
  type HostCapabilities,
} from "@posthog/platform/host-capabilities";
import {
  type IPowerManager,
  POWER_MANAGER_SERVICE,
} from "@posthog/platform/power-manager";
import { sandboxProxyHtml } from "@posthog/shared/mcp-sandbox-proxy";
import { authUiModule } from "@posthog/ui/features/auth/auth.module";
import {
  AUTH_SIDE_EFFECTS,
  type IAuthSideEffects,
} from "@posthog/ui/features/auth/identifiers";
import {
  FEATURE_FLAGS,
  type FeatureFlags,
} from "@posthog/ui/features/feature-flags/identifiers";
import {
  UiGithubConnectClient,
  UiRepositoriesClient,
} from "@posthog/ui/features/integrations/integrationsClientImpl";
import { McpAppHost } from "@posthog/ui/features/mcp-apps/components/McpAppHost";
import {
  MCP_APP_HOST_COMPONENT,
  MCP_SANDBOX_PROXY_URL,
  type McpAppHostComponent,
  type McpSandboxProxyUrlProvider,
} from "@posthog/ui/features/mcp-apps/identifiers";
import { OnboardingGithubConnectClient } from "@posthog/ui/features/onboarding/githubConnectClientImpl";
import { getSessionService } from "@posthog/ui/features/sessions/sessionServiceHost";
import { setupUiModule } from "@posthog/ui/features/setup/setup.module";
import {
  ANALYTICS_TRACKER,
  type AnalyticsTracker,
} from "@posthog/ui/shell/analytics";
import {
  HEDGEHOG_MODE_HOST,
  type HedgehogModeHost,
} from "@posthog/ui/shell/hedgehogModeHost";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { QueryClient } from "@tanstack/react-query";
import {
  WebAuthConnectivity,
  WebAuthPreferenceStore,
  WebAuthSessionStore,
  webAuthTokenCipher,
  webPowerManager,
} from "./web-auth-adapters";
import { WebAuthSideEffects } from "./web-auth-side-effects";
import { WebOAuthFlowService } from "./web-oauth-flow";
import { webSetupStore } from "./web-setup-store";
import { hostTrpcClient } from "./web-trpc";

interface WebBindings {
  [HOST_TRPC_CLIENT]: HostTrpcClient;
  [ROOT_LOGGER]: RootLogger;
  [FEATURE_FLAGS]: FeatureFlags;
  [ANALYTICS_TRACKER]: AnalyticsTracker;
  [ANALYTICS_SERVICE]: IAnalytics;
  [IMPERATIVE_QUERY_CLIENT]: ImperativeQueryClient;
  [AUTH_SIDE_EFFECTS]: IAuthSideEffects;
  [MCP_APP_HOST_COMPONENT]: McpAppHostComponent;
  [MCP_SANDBOX_PROXY_URL]: McpSandboxProxyUrlProvider;
  [AUTH_SESSION_STORE]: IAuthSessionStore;
  [AUTH_PREFERENCE_STORE]: IAuthPreferenceStore;
  [AUTH_OAUTH_FLOW_SERVICE]: IAuthOAuthFlowService;
  [AUTH_TOKEN_CIPHER]: IAuthTokenCipher;
  [AUTH_CONNECTIVITY]: IAuthConnectivity;
  [AUTH_TOKEN_OVERRIDE]: string | null;
  [POWER_MANAGER_SERVICE]: IPowerManager;
  [AUTH_SERVICE]: AuthService;
  [CLOUD_TASK_SERVICE]: CloudTaskService;
  [CLOUD_TASK_AUTH]: ICloudTaskAuth;
  [SESSION_SERVICE]: SessionService;
  [SETUP_STORE]: ISetupStore;
  [GITHUB_ISSUE_CLIENT]: GitHubIssueClient;
  [HEDGEHOG_MODE_HOST]: HedgehogModeHost;
  [INTEGRATIONS_GITHUB_CONNECT_CLIENT]: IntegrationsGithubConnectClient;
  [ONBOARDING_GITHUB_CONNECT_CLIENT]: OnboardingGithubConnectContract;
  [REPOSITORIES_CLIENT]: RepositoriesClient;
  [REPOSITORIES_SERVICE]: RepositoriesService;
  [HOST_CAPABILITIES]: HostCapabilities;
}

export const queryClient = new QueryClient();

export const container = new TypedContainer<WebBindings>({
  defaultScope: "Singleton",
});

// Keystone: the same typed host client the renderer binds — served in-process
// here (web-trpc.ts) instead of over Electron IPC.
container.bind(HOST_TRPC_CLIENT).toConstantValue(hostTrpcClient);

// Logger: web uses console; electron uses electron-log. Same RootLogger shape.
const scoped = (name?: string): RootLogger => ({
  debug: (...a) => console.debug(name ? `[${name}]` : "", ...a),
  info: (...a) => console.info(name ? `[${name}]` : "", ...a),
  warn: (...a) => console.warn(name ? `[${name}]` : "", ...a),
  error: (...a) => console.error(name ? `[${name}]` : "", ...a),
  scope: (n: string) => scoped(n),
});
container.bind(ROOT_LOGGER).toConstantValue(scoped());

// ── Auth: the portable core state machine over web adapters ──
// Desktop runs AuthService in the Electron main process (SQLite session store,
// machine-bound cipher, deep-link OAuth). Web runs the SAME service in the
// browser over localStorage adapters and a popup PKCE flow.
container.load(authCoreModule);
container.bind(AUTH_SESSION_STORE).toConstantValue(new WebAuthSessionStore());
container
  .bind(AUTH_PREFERENCE_STORE)
  .toConstantValue(new WebAuthPreferenceStore());
container
  .bind(AUTH_OAUTH_FLOW_SERVICE)
  .toConstantValue(new WebOAuthFlowService(scoped("web-oauth")));
container.bind(AUTH_TOKEN_CIPHER).toConstantValue(webAuthTokenCipher);
container.bind(AUTH_CONNECTIVITY).toConstantValue(new WebAuthConnectivity());
container
  .bind(AUTH_TOKEN_OVERRIDE)
  .toConstantValue(
    (import.meta.env.VITE_POSTHOG_ACCESS_TOKEN_OVERRIDE as
      | string
      | undefined) ?? null,
  );
container.bind(POWER_MANAGER_SERVICE).toConstantValue(webPowerManager);

// The web host is cloud-only: no local filesystem, so the UI must use remote
// (connected-GitHub-org) repositories and cloud workspaces everywhere it would
// otherwise reach for local folders/worktrees/terminal.
container
  .bind(HOST_CAPABILITIES)
  .toConstantValue({ localWorkspaces: false } satisfies HostCapabilities);

container.load(authUiModule);

// ── Cloud tasks: CloudTaskService is pure fetch/SSE core code ──
// Same wiring as apps/code's main container, minus Electron.
container.load(cloudTaskModule);
container.bind(CLOUD_TASK_AUTH).toDynamicValue((ctx) => ({
  authenticatedFetch: (url: string, init?: RequestInit) =>
    ctx
      .get<AuthService>(AUTH_SERVICE)
      .authenticatedFetch(
        (input, fetchInit) => fetch(input, fetchInit),
        url,
        init,
      ),
}));

// SessionService is built from host-agnostic deps (host tRPC client + UI
// stores) — same construction the desktop renderer uses.
container
  .bind(SESSION_SERVICE)
  .toDynamicValue(() => getSessionService())
  .inSingletonScope();

// ── Stubbed web ports (TODO: real web adapters — posthog-js, etc.) ──
container.bind(FEATURE_FLAGS).toConstantValue({
  isEnabled: () => false,
  onFlagsLoaded: () => () => {},
});
container.bind(ANALYTICS_TRACKER).toConstantValue({
  track: () => {},
  setActiveTaskContext: () => {},
  captureException: () => {},
  identifyUser: () => {},
  setUserGroups: () => {},
  resetUser: () => {},
  captureSurveyResponse: () => {},
});
let analyticsSessionId: string | null = null;
container.bind(ANALYTICS_SERVICE).toConstantValue({
  initialize: () => {},
  track: () => {},
  identify: () => {},
  setCurrentUserId: () => {},
  getCurrentUserId: () => null,
  getOrCreateSessionId: () => {
    if (!analyticsSessionId) analyticsSessionId = crypto.randomUUID();
    return analyticsSessionId;
  },
  resetUser: () => {},
  captureException: () => {},
  flush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
});
container.bind(IMPERATIVE_QUERY_CLIENT).toConstantValue(queryClient);

container.bind(AUTH_SIDE_EFFECTS).to(WebAuthSideEffects);

// Interactive MCP App iframe host. Electron isolates the proxy with a custom
// privileged scheme; web gets a separate origin for free via a blob URL of the
// same (host-agnostic) proxy HTML. The blob is created once, lazily.
container.bind(MCP_APP_HOST_COMPONENT).toConstantValue(McpAppHost);
let sandboxProxyUrl: string | null = null;
container.bind(MCP_SANDBOX_PROXY_URL).toConstantValue(() => {
  if (!sandboxProxyUrl) {
    sandboxProxyUrl = URL.createObjectURL(
      new Blob([sandboxProxyHtml], { type: "text/html" }),
    );
  }
  return sandboxProxyUrl;
});

// ── Post-login shell: the tokens __root.tsx resolves eagerly via useService ──
// The shared app shell (packages/ui __root.tsx) mounts the full desktop surface
// once authenticated+onboarded. These three are resolved synchronously in
// render, so an unbound token crashes the tree (unlike tRPC/query calls, which
// degrade to a rejected promise). Bind the real host-agnostic services where
// they exist and thin stubs for genuinely local-only host capabilities.

// Setup discovery (useSetupDiscovery at __root): SetupRunService is portable
// core; SetupRunServiceImpl talks to the PostHog API via HOST_TRPC_CLIENT; the
// store adapter is host-agnostic zustand, reused verbatim from desktop.
container.load(setupCoreModule);
container.load(setupUiModule);
container.bind(SETUP_STORE).toConstantValue(webSetupStore);

// New-task deep links (useNewTaskDeepLink at __root): the resolver is portable
// core, but its GITHUB_ISSUE_CLIENT dep reads a local git repo on desktop. Web
// has no git backend, so bind a stub that rejects if an "issue" deep link is
// ever resolved (the browser has no deep-link scheme, so this never fires).
container.load(deepLinksCoreModule);
container.bind(GITHUB_ISSUE_CLIENT).toConstantValue({
  getGithubIssue: () =>
    Promise.reject(new Error("GitHub issue lookup is not available on web")),
});

// Hedgehog overlay (HedgehogMode at __root): optional cosmetic canvas game the
// desktop adapter owns via @posthog/hedgehog-mode. Web binds a no-op host so
// the useService call resolves; nothing renders.
container.bind(HEDGEHOG_MODE_HOST).toConstantValue({
  mount: () => Promise.resolve({ destroy: () => {} }),
});

// ── GitHub integration: onboarding connect step + __root's useIntegrations() ──
// Cloud tasks operate on GitHub repos, so these are REAL bindings backed by the
// PostHog API (api-client), not stubs. The onboarding and integrations features
// each define their own GITHUB_CONNECT_{CLIENT,SERVICE} tokens; both services
// are portable core and both client impls are host-agnostic, reused verbatim
// from the desktop renderer. RepositoriesService has no module, so bind it
// directly like desktop does.
container.load(githubConnectModule);
container.load(onboardingModule);
container
  .bind(INTEGRATIONS_GITHUB_CONNECT_CLIENT)
  .toConstantValue(new UiGithubConnectClient());
container
  .bind(ONBOARDING_GITHUB_CONNECT_CLIENT)
  .toConstantValue(new OnboardingGithubConnectClient());
container.bind(REPOSITORIES_CLIENT).toConstantValue(new UiRepositoriesClient());
container.bind(REPOSITORIES_SERVICE).to(RepositoriesService).inSingletonScope();

setRootContainer(container);
