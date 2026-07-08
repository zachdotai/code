import {
  type AgentSession,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_MODEL } from "./extensions/posthog-provider/models";
import {
  POSTHOG_PROVIDER_NAME,
  type PosthogProviderOptions,
  resolvePosthogProvider,
} from "./extensions/posthog-provider/provider";
import { createWebAccessExtension } from "./extensions/web-access/extension";

export interface HarnessSessionOptions extends PosthogProviderOptions {
  cwd?: string;
  model?: string;
  loadFromPath?: string;
  agentDir?: string;
}

export async function createHarnessSession(
  options: HarnessSessionOptions = {},
): Promise<AgentSession> {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  modelRegistry.registerProvider(
    POSTHOG_PROVIDER_NAME,
    await resolvePosthogProvider(options),
  );

  const model = modelRegistry.find(
    POSTHOG_PROVIDER_NAME,
    options.model ?? DEFAULT_MODEL,
  );

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    // Only the model provider (registered above) + web tools — not the full
    // harness extension registry, and no `pi-mcp-adapter` (additionalExtensionPaths).
    // hog-branding (TUI chrome), subagent (spawns child pi processes), and
    // pi-mcp-adapter (interactive MCP setup UI/OAuth flows) all assume a real
    // CLI/TUI runtime and aren't safe for an embedded SDK session — this
    // adapter doesn't forward ACP `mcpServers` into pi anyway, so there's
    // nothing for pi-mcp-adapter to manage here.
    extensionFactories: [createWebAccessExtension(options)],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    authStorage,
    modelRegistry,
    resourceLoader,
    cwd,
    ...(model ? { model } : {}),
    ...(options.loadFromPath
      ? { sessionManager: SessionManager.open(options.loadFromPath) }
      : {}),
  });

  return session;
}

export async function findHarnessSessionPath(
  cwd: string,
  sessionId: string,
): Promise<string | undefined> {
  const infos = await SessionManager.list(cwd);
  return infos.find((info) => info.id === sessionId)?.path;
}
