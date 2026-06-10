import type { InjectPromptEventPayload } from "@posthog/host-router/rts-schemas";

export type PromptRoute = "inject" | "spawn_follow_up" | "failed";

export function resolveRtsPromptRoute(input: {
  payload: InjectPromptEventPayload;
  sessionStatus: string | null | undefined;
}): PromptRoute {
  if (input.payload.source === "hedgehog") {
    return input.payload.nestId ? "spawn_follow_up" : "failed";
  }
  if (input.sessionStatus === "connected") return "inject";
  return input.payload.nestId ? "spawn_follow_up" : "failed";
}
