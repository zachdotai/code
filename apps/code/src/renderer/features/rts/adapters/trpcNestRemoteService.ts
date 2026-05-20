import { trpcClient } from "@renderer/trpc/client";
import type { NestRemoteService } from "../domain/NestRemoteService";

export const trpcNestRemoteService: NestRemoteService = {
  update(input) {
    return trpcClient.hedgemony.nests.update.mutate(input);
  },
  list() {
    return trpcClient.hedgemony.nests.list.query();
  },
  watch(id, callbacks) {
    return trpcClient.hedgemony.nests.watch.subscribe(
      { id },
      {
        onData: callbacks.onData,
        onError: callbacks.onError,
      },
    );
  },
};
