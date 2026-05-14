import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { CanvasRenderer } from "@features/rendering-canvas/CanvasRenderer";
import GENERATED_CANVAS from "@features/rendering-canvas/generated-canvas-stub.tsx?raw";
import { RobotIcon } from "@phosphor-icons/react";
import { Dialog, Flex } from "@radix-ui/themes";
import type { PostHogAPIClient } from "@renderer/api/posthogClient";
import { useMemo, useState } from "react";

const CANVAS_NAME = "Activity overview (LLM-generated)";

function buildClientResolver(client: PostHogAPIClient) {
  return async (path: string, args: unknown[]) => {
    const segments = path.split(".");
    let target: unknown = client;
    for (const segment of segments) {
      if (target == null || typeof target !== "object") {
        throw new Error(`"${path}" is not callable on the client`);
      }
      target = (target as Record<string, unknown>)[segment];
    }
    if (typeof target !== "function") {
      throw new Error(`"${path}" is not a function on the client`);
    }
    return await (target as (...a: unknown[]) => unknown).apply(client, args);
  };
}

export function GeneratedCanvasButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useAuthenticatedClient();
  const resolver = useMemo(() => buildClientResolver(client), [client]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <button
          type="button"
          className="flex w-full items-center gap-1 bg-transparent px-2 py-1.5 text-left text-(--gray-11) text-[13px] transition-colors hover:bg-(--gray-3)"
        >
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center text-(--gray-10)">
            <RobotIcon size={14} />
          </span>
          <span>{CANVAS_NAME}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Content
        maxWidth="780px"
        style={{ height: 640, padding: 0, overflow: "hidden" }}
      >
        <Flex direction="column" className="h-full w-full">
          <Flex
            align="center"
            justify="between"
            className="shrink-0 border-(--gray-5) border-b px-3 py-2"
          >
            <Dialog.Title className="m-0 text-(--gray-12) text-sm">
              {CANVAS_NAME}
            </Dialog.Title>
          </Flex>
          {error && (
            <div className="shrink-0 whitespace-pre-wrap bg-(--red-3) px-3 py-2 font-mono text-(--red-11) text-xs">
              {error}
            </div>
          )}
          <Flex direction="column" className="min-h-0 flex-1">
            <CanvasRenderer
              content={GENERATED_CANVAS}
              onReady={() => setError(null)}
              onError={setError}
              onApiCall={resolver}
            />
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
