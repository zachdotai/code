import { SYNC_CLOUD_CLIENT_PROVIDER } from "@posthog/core/local-store/sync/identifiers";
import {
  TASK_PR_STATUS_CLIENT,
  type TaskPrStatusClient,
} from "@posthog/core/tasks/taskSync";
import { resolveService } from "@posthog/di/container";
import { CONTRIBUTION } from "@posthog/di/contribution";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { ContainerModule } from "inversify";
import { createCloudClientProvider } from "./cloudClientProvider";
import { LocalFirstBootContribution } from "./localFirst.contribution";

export const localFirstUiModule = new ContainerModule(({ bind }) => {
  bind(SYNC_CLOUD_CLIENT_PROVIDER).toConstantValue(createCloudClientProvider());
  bind(TASK_PR_STATUS_CLIENT).toConstantValue({
    getTaskPrStatuses: (items) =>
      resolveService<HostTrpcClient>(
        HOST_TRPC_CLIENT,
      ).workspace.getTaskPrStatuses.query({ items }),
  } satisfies TaskPrStatusClient);
  bind(CONTRIBUTION).to(LocalFirstBootContribution).inSingletonScope();
});
