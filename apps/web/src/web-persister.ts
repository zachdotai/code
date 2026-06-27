import { CANVAS_PERSIST_KEY } from "@posthog/ui/shell/queryPersistence";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

// Web persists the query cache to localStorage (synchronous, always available
// in the browser). The desktop host uses an async electron-backed persister.
export const queryPersister = createSyncStoragePersister({
  key: CANVAS_PERSIST_KEY,
  storage: window.localStorage,
});
