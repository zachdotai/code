import { trpcClient } from "@renderer/trpc/client";
import type { HogletRemoteService } from "../domain/HogletRemoteService";

export const trpcHogletRemoteService: HogletRemoteService = {
  adopt(input) {
    return trpcClient.hedgemony.hoglets.adopt.mutate(input);
  },
  release(input) {
    return trpcClient.hedgemony.hoglets.release.mutate(input);
  },
  list(input) {
    return trpcClient.hedgemony.hoglets.list.query(input);
  },
  watch(scope, callbacks) {
    return trpcClient.hedgemony.hoglets.watch.subscribe(scope, {
      onData: callbacks.onData,
      onError: callbacks.onError,
    });
  },
};
