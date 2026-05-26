import { useExtensionsStore } from "@features/extensions/stores/extensionsStore";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";

const log = logger.scope("extension-subscriptions");

export function registerExtensionSubscriptions(): () => void {
  let disposed = false;

  trpcClient.extensions.list
    .query()
    .then((extensions) => {
      if (disposed) return;
      useExtensionsStore.getState().actions.setExtensions(extensions);
    })
    .catch((error) => {
      log.warn("Failed to load extensions", { error });
    });

  const subscription = trpcClient.extensions.onChanged.subscribe(undefined, {
    onData: ({ extensions }) => {
      useExtensionsStore.getState().actions.setExtensions(extensions);
    },
    onError: (error) => {
      log.warn("Extension subscription failed", { error });
    },
  });

  return () => {
    disposed = true;
    subscription.unsubscribe();
    useExtensionsStore.getState().actions.clear();
  };
}
