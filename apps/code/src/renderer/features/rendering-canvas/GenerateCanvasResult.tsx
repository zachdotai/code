import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { CanvasRenderer } from "@features/rendering-canvas/CanvasRenderer";
import { buildClientResolver } from "@features/rendering-canvas/clientResolver";
import {
  getContentText,
  type ToolViewProps,
  useToolCallStatus,
} from "@features/sessions/components/session-update/toolCallUtils";
import { useMemo, useState } from "react";

interface GeneratedCanvas {
  id: string;
  name: string;
  content: string;
}

function parseGeneratedCanvas(raw: string | undefined): GeneratedCanvas | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const id = typeof parsed.id === "string" ? parsed.id : null;
    const name = typeof parsed.name === "string" ? parsed.name : "Canvas";
    const content = typeof parsed.content === "string" ? parsed.content : null;
    if (!id || !content) return null;
    return { id, name, content };
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
    <div className="mx-6 my-2 overflow-hidden rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1)">
      <div className="flex items-center justify-between border-(--gray-5) border-b px-3 py-1.5">
        <span className="font-medium text-(--gray-12) text-xs">
          {canvas.name}
        </span>
        <span className="font-mono text-(--gray-10) text-[11px]">
          {canvas.id.slice(0, 8)}
        </span>
      </div>
      {renderError && (
        <div className="whitespace-pre-wrap bg-(--red-3) px-3 py-2 font-mono text-(--red-11) text-xs">
          {renderError}
        </div>
      )}
      <div className="h-[420px]">
        <CanvasRenderer
          content={canvas.content}
          onApiCall={resolver}
          onReady={() => setRenderError(null)}
          onError={setRenderError}
        />
      </div>
    </div>
  );
}
