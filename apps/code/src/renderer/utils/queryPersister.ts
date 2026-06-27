import { CANVAS_PERSIST_KEY } from "@posthog/ui/shell/queryPersistence";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { trpcClient } from "../trpc";

// Persist the query cache through the same electron-backed secure store that
// holds the renderer's other persisted state. We talk to the raw string-in/out
// secureStore backend directly (not the createJSONStorage `electronStorage`
// wrapper) so the persister owns serialization without double-encoding.
export const queryPersister = createAsyncStoragePersister({
  key: CANVAS_PERSIST_KEY,
  storage: {
    getItem: (key) => trpcClient.secureStore.getItem.query({ key }),
    setItem: (key, value) =>
      trpcClient.secureStore.setItem.query({ key, value }),
    removeItem: (key) => trpcClient.secureStore.removeItem.query({ key }),
  },
});
