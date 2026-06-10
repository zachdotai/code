import type { PrGraphRemoteService } from "../domain/PrGraphRemoteService";
import { hostClient } from "../hostClient";

export const trpcPrGraphRemoteService: PrGraphRemoteService = {
  listForNest(nestId) {
    return hostClient().rts.prGraph.listForNest.query({ nestId });
  },
  watch(nestId, callbacks) {
    return hostClient().rts.prGraph.watch.subscribe(
      { id: nestId },
      {
        onData: callbacks.onData,
        onError: callbacks.onError,
      },
    );
  },
};
