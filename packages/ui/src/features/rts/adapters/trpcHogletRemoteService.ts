import type { HogletRemoteService } from "../domain/HogletRemoteService";
import { hostClient } from "../hostClient";

export const trpcHogletRemoteService: HogletRemoteService = {
  adopt(input) {
    return hostClient().rts.hoglets.adopt.mutate(input);
  },
  release(input) {
    return hostClient().rts.hoglets.release.mutate(input);
  },
  list(input) {
    return hostClient().rts.hoglets.list.query(input);
  },
  watch(scope, callbacks) {
    return hostClient().rts.hoglets.watch.subscribe(scope, {
      onData: callbacks.onData,
      onError: callbacks.onError,
    });
  },
};
