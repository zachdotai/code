import { buildCanvasSrcDoc } from "@features/rendering-canvas/runtime";
import { useEffect, useMemo, useRef } from "react";

export type CanvasApiResolver = (
  path: string,
  args: unknown[],
) => Promise<unknown>;

interface CanvasRendererProps {
  content: string;
  onApiCall?: CanvasApiResolver;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export function CanvasRenderer({
  content,
  onApiCall,
  className,
  style,
  onReady,
  onError,
}: CanvasRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const resolverRef = useRef<CanvasApiResolver | undefined>(onApiCall);
  resolverRef.current = onApiCall;

  const srcDoc = useMemo(() => buildCanvasSrcDoc(content), [content]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const msg = event.data as
        | { kind: "canvas:ready" }
        | { kind: "canvas:error"; message: string }
        | { kind: "canvas:api"; id: number; path: string; args: unknown[] }
        | undefined;
      if (!msg || typeof msg !== "object") return;

      if (msg.kind === "canvas:ready") {
        onReady?.();
        return;
      }
      if (msg.kind === "canvas:error") {
        onError?.(msg.message);
        return;
      }
      if (msg.kind === "canvas:api") {
        const { id, path, args } = msg;
        const resolver = resolverRef.current;
        const reply = (payload: { result?: unknown; error?: string }) => {
          iframe.contentWindow?.postMessage(
            { kind: "canvas:api-result", id, ...payload },
            "*",
          );
        };
        if (!resolver) {
          reply({ error: `No API resolver configured for "${path}"` });
          return;
        }
        Promise.resolve()
          .then(() => resolver(path, args))
          .then((result) => reply({ result }))
          .catch((err) =>
            reply({ error: err instanceof Error ? err.message : String(err) }),
          );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onReady, onError]);

  return (
    <iframe
      ref={iframeRef}
      title="rendering-canvas"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className={`h-full w-full border-0 ${className ?? ""}`}
      style={style}
    />
  );
}
