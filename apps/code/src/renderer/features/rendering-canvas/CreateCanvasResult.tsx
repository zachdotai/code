import { RenderingCanvas } from "@features/rendering-canvas/RenderingCanvas";
import {
  getContentText,
  type ToolViewProps,
  useToolCallStatus,
} from "@features/sessions/components/session-update/toolCallUtils";
import { ArrowSquareOutIcon, RobotIcon } from "@phosphor-icons/react";
import { Button, Dialog, Flex } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useState } from "react";

interface CreatedCanvas {
  id: string;
  name: string;
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function parseCreatedCanvas(raw: string | undefined): CreatedCanvas | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const id = typeof parsed.id === "string" ? parsed.id : null;
    const name = typeof parsed.name === "string" ? parsed.name : "Canvas";
    if (id) return { id, name };
  } catch {
    // PostHog MCP serializes canvas results as YAML-style "key: value" lines,
    // not JSON — fall through to the line parser.
  }

  let id: string | null = null;
  let name = "Canvas";
  for (const line of trimmed.split("\n")) {
    const match = /^\s*([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (key === "id" && UUID_RE.test(value)) id = value;
    else if (key === "name" && value) name = value;
  }
  if (!id) {
    const fallback = UUID_RE.exec(trimmed);
    if (fallback) id = fallback[0];
  }
  return id ? { id, name } : null;
}

export function CreateCanvasResult({
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
  const navigateToCanvasInput = useNavigationStore(
    (s) => s.navigateToCanvasInput,
  );
  const [open, setOpen] = useState(false);

  if (!isComplete || isFailed || wasCancelled) return null;

  const text = getContentText(content);
  const canvas = parseCreatedCanvas(text);

  if (!canvas) {
    return (
      <div className="mx-6 my-2 whitespace-pre-wrap rounded-(--radius-2) border border-(--amber-6) bg-(--amber-2) p-3 font-mono text-(--amber-11) text-xs">
        create-canvas widget couldn't parse a canvas id from this result:
        {"\n"}
        {text?.slice(0, 800) ?? "(empty)"}
      </div>
    );
  }

  const handleOpenInView = () => {
    setOpen(false);
    navigateToCanvasInput(canvas.id);
  };

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
            <span className="font-mono text-(--gray-10) text-[11px]">
              {canvas.id.slice(0, 8)} — click to preview
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
            gap="2"
            className="shrink-0 border-(--gray-5) border-b px-3 py-2"
          >
            <Dialog.Title className="m-0 text-(--gray-12) text-sm">
              {canvas.name}
            </Dialog.Title>
            <Button size="1" variant="soft" onClick={handleOpenInView}>
              <ArrowSquareOutIcon weight="regular" />
              Open in full view
            </Button>
          </Flex>
          <Flex direction="column" className="min-h-0 flex-1">
            <RenderingCanvas canvasId={canvas.id} className="h-full" />
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
