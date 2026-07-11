import { ContainerModule } from "inversify";
import { SIGNING_ACCESS_SERVICE } from "../signing-access/identifiers";
import { SecureEnclaveSigningAccessService } from "../signing-access/service";
import { AgentService } from "./agent";
import { AgentAuthAdapter } from "./auth-adapter";
import { AGENT_AUTH_ADAPTER, AGENT_SERVICE } from "./identifiers";

export const agentModule = new ContainerModule(({ bind }) => {
  bind(SIGNING_ACCESS_SERVICE)
    .to(SecureEnclaveSigningAccessService)
    .inSingletonScope();
  bind(AGENT_SERVICE).to(AgentService).inSingletonScope();
  bind(AGENT_AUTH_ADAPTER).to(AgentAuthAdapter).inSingletonScope();
});
