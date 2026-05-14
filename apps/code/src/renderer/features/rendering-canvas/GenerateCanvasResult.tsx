import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { CanvasRenderer } from "@features/rendering-canvas/CanvasRenderer";
import { buildClientResolver } from "@features/rendering-canvas/clientResolver";
import {
  getContentText,
  type ToolViewProps,
  useToolCallStatus,
} from "@features/sessions/components/session-update/toolCallUtils";
import { RobotIcon } from "@phosphor-icons/react";
import { Dialog, Flex } from "@radix-ui/themes";
import { useMemo, useState } from "react";

interface GeneratedCanvas {
  name: string;
  content: string;
}

function parseGeneratedCanvas(raw: string | undefined): GeneratedCanvas | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name : "Canvas";
    const content = typeof parsed.content === "string" ? parsed.content : null;
    if (!content) return null;
    return { name, content };
  } catch {
    return null;
  }
}

export function GenerateCanvasResult({
  toolCall,
  turnCancelled,
  turnComplete,
}: ToolViewProps) {
  const { status, content } = toolCall;
  const { isComplete, isFailed, wasCancelled } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );
  const client = useAuthenticatedClient();
  const resolver = useMemo(() => buildClientResolver(client), [client]);
  const [open, setOpen] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  if (!isComplete || isFailed || wasCancelled) return null;

  const text = getContentText(content);
  const canvas = parseGeneratedCanvas(text);

  if (!canvas) {
    return (
      <div className="mx-6 my-2 whitespace-pre-wrap rounded-(--radius-2) border border-(--red-6) bg-(--red-2) p-3 font-mono text-(--red-11) text-xs">
        generate-canvas returned a value that wasn't a canvas resource:
        {"\n"}
        {text?.slice(0, 500) ?? "(empty)"}
      </div>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <button
          type="button"
          className="mx-6 my-2 flex items-center gap-2 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-2 text-left transition-colors hover:bg-(--gray-3)"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-(--gray-10)">
            <RobotIcon size={14} />
          </span>
          <span className="flex flex-col">
            <span className="text-(--gray-12) text-xs">{canvas.name}</span>
            <span className="text-(--gray-10) text-[11px]">
              Preview generated canvas
            </span>
          </span>
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
              {canvas.name}
            </Dialog.Title>
          </Flex>
          {renderError && (
            <div className="shrink-0 whitespace-pre-wrap bg-(--red-3) px-3 py-2 font-mono text-(--red-11) text-xs">
              {renderError}
            </div>
          )}
          <Flex direction="column" className="min-h-0 flex-1">
            <CanvasRenderer
              content={canvas.content}
              onApiCall={resolver}
              onReady={() => setRenderError(null)}
              onError={setRenderError}
            />
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
