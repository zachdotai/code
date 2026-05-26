import { useExtensionsStore } from "@features/extensions/stores/extensionsStore";
import {
  type ExtensionViewToHostMessage,
  POSTHOG_CODE_EXTENSION_API_VERSION,
} from "@posthog/code-extension-api";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useThemeStore } from "@renderer/stores/themeStore";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { useEffect, useRef } from "react";

const log = logger.scope("extension-view");

interface ExtensionViewProps {
  sidebarItemId: string;
}

function isBridgeMessage(data: unknown): data is ExtensionViewToHostMessage {
  return !!data && typeof data === "object" && "type" in data;
}

export function ExtensionView({ sidebarItemId }: ExtensionViewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const item = useExtensionsStore((state) =>
    state.sidebar.find((sidebarItem) => sidebarItem.id === sidebarItemId),
  );

  useEffect(() => {
    if (!item) return;

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isBridgeMessage(event.data)) return;

      switch (event.data.type) {
        case "posthogCode.ready": {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "posthogCode.hostReady",
              version: POSTHOG_CODE_EXTENSION_API_VERSION,
              extensionId: item.extensionId,
              viewId: item.id,
              theme: isDarkMode ? "dark" : "light",
            },
            "*",
          );
          break;
        }
        case "posthogCode.log": {
          const level = event.data.level ?? "info";
          const metadata = {
            extensionId: item.extensionId,
            viewId: item.id,
            data: event.data.data,
          };
          if (level === "error") log.error(event.data.message, metadata);
          else if (level === "warning") log.warn(event.data.message, metadata);
          else if (level === "debug") log.debug(event.data.message, metadata);
          else log.info(event.data.message, metadata);
          break;
        }
        case "posthogCode.notify": {
          const level = event.data.level ?? "info";
          if (level === "error") toast.error(event.data.message);
          else if (level === "warning") toast.warning(event.data.message);
          else toast.info(event.data.message);
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [item, isDarkMode]);

  if (!item) {
    return (
      <Flex align="center" justify="center" height="100%">
        <Text className="text-gray-10 text-sm">Extension view not found</Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" height="100%" className="bg-gray-1">
      <Flex
        align="center"
        px="4"
        py="2"
        className="shrink-0 border-gray-6 border-b"
      >
        <Text className="font-medium text-gray-12 text-sm">{item.title}</Text>
      </Flex>
      <Box flexGrow="1" overflow="hidden">
        <iframe
          ref={iframeRef}
          title={item.title}
          src={item.html ? undefined : item.url}
          srcDoc={item.html}
          sandbox="allow-forms allow-popups allow-scripts"
          className="h-full w-full border-0 bg-white"
        />
      </Box>
    </Flex>
  );
}
