import { HostTRPCProvider } from "@posthog/host-router/react";
import { ThemeWrapper } from "@posthog/ui/primitives/ThemeWrapper";
import { buildCanvasPersistOptions } from "@posthog/ui/shell/queryPersistence";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type React from "react";
import { HotkeysProvider } from "react-hotkeys-hook";
import { queryClient } from "./web-container";
import { queryPersister } from "./web-persister";
import { hostTrpcClient } from "./web-trpc";

const persistOptions = buildCanvasPersistOptions(queryPersister);

// Web transport wiring — the per-host counterpart of apps/code's Providers.tsx.
// @posthog/ui consumes the HOST router context (useHostTRPCClient), so web only
// needs HostTRPCProvider over the HTTP client. No electron TrpcRouter context.

export const Providers: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <HotkeysProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
      >
        <HostTRPCProvider trpcClient={hostTrpcClient} queryClient={queryClient}>
          <ThemeWrapper>{children}</ThemeWrapper>
        </HostTRPCProvider>
      </PersistQueryClientProvider>
    </HotkeysProvider>
  );
};
