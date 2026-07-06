import { SYNC_CLOUD_CLIENT_PROVIDER } from "@posthog/core/local-store/sync/identifiers";
import { CONTRIBUTION } from "@posthog/di/contribution";
import { ContainerModule } from "inversify";
import { createCloudClientProvider } from "./cloudClientProvider";
import { LocalFirstBootContribution } from "./localFirst.contribution";

export const localFirstUiModule = new ContainerModule(({ bind }) => {
  bind(SYNC_CLOUD_CLIENT_PROVIDER).toConstantValue(createCloudClientProvider());
  bind(CONTRIBUTION).to(LocalFirstBootContribution).inSingletonScope();
});
