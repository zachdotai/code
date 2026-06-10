import type { NestRemoteService } from "../domain/NestRemoteService";
import { hostClient } from "../hostClient";

export const trpcNestRemoteService: NestRemoteService = {
  update(input) {
    return hostClient().rts.nests.update.mutate(input);
  },
  list() {
    return hostClient().rts.nests.list.query();
  },
  watch(id, callbacks) {
    return hostClient().rts.nests.watch.subscribe(
      { id },
      {
        onData: callbacks.onData,
        onError: callbacks.onError,
      },
    );
  },
};
