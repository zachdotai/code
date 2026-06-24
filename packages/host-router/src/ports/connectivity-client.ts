import type { WorkspaceClient } from "@posthog/workspace-client/client";

export const CONNECTIVITY_CLIENT = Symbol.for(
  "posthog.host.connectivityClient",
);

export interface HostConnectivityClient {
  connectivity: WorkspaceClient["connectivity"];
}

// CI test: deliberate type error to verify the pipeline fails as expected.
const _ciTestBrokenValue: number = "this is not a number";
