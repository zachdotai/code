import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import {
  type CanvasApiResolver,
  CanvasRenderer,
} from "@features/rendering-canvas/CanvasRenderer";
import type { PostHogAPIClient } from "@renderer/api/posthogClient";
import { useQuery } from "@tanstack/react-query";

interface RenderingCanvasProps {
  canvasId: string;
  className?: string;
  style?: React.CSSProperties;
  onApiCall?: CanvasApiResolver;
}

export function RenderingCanvas({
  canvasId,
  className,
  style,
  onApiCall,
}: RenderingCanvasProps) {
  const client = useAuthenticatedClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["rendering-canvas", canvasId],
    queryFn: () => client.getRenderingCanvas(canvasId),
  });

  if (isLoading) {
    return (
      <div className={`p-3 text-(--gray-10) text-xs ${className ?? ""}`}>
        Loading canvas…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className={`p-3 text-(--red-11) text-xs ${className ?? ""}`}>
        Failed to load canvas:{" "}
        {error instanceof Error ? error.message : "unknown error"}
      </div>
    );
  }

  return (
    <CanvasRenderer
      content={data.content}
      className={className}
      style={style}
      onApiCall={onApiCall ?? defaultResolver(client)}
    />
  );
}

function defaultResolver(client: PostHogAPIClient): CanvasApiResolver {
  return async (path, args) => {
    const segments = path.split(".");
    let target: unknown = client;
    for (const segment of segments) {
      if (target == null || typeof target !== "object") {
        throw new Error(`Path "${path}" is not callable on the client`);
      }
      target = (target as Record<string, unknown>)[segment];
    }
    if (typeof target !== "function") {
      throw new Error(`"${path}" is not a function on the client`);
    }
    return await (target as (...a: unknown[]) => unknown).apply(client, args);
  };
}
