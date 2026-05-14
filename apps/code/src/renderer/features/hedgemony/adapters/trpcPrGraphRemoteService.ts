import { trpcClient } from "@renderer/trpc/client";
import type { PrGraphRemoteService } from "../domain/PrGraphRemoteService";

export const trpcPrGraphRemoteService: PrGraphRemoteService = {
  listForNest(nestId) {
    return trpcClient.hedgemony.prGraph.listForNest.query({ nestId });
  },
  watch(nestId, callbacks) {
    return trpcClient.hedgemony.prGraph.watch.subscribe(
      { id: nestId },
      {
        onData: callbacks.onData,
        onError: callbacks.onError,
      },
    );
  },
};
