import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "../hooks/agentApplicationsKeys";
import type { ClientToolHandler } from "../hooks/useAgentChat";
import { useAgentBuilderStore } from "./agentBuilderStore";

const MAX_DESCRIPTION_CHARS = 280;

/**
 * The agent builder's UI-driving client tools. The agent calls these to steer the
 * user's screen (`focus_*`, which navigate code's agent routes and report back
 * `{ focused }`) and to set secrets (`set_secret`, an interactive punch-out:
 * park the call and render a form — see the dock). Returning `null` defers to
 * the built-in toast/get_context handlers.
 *
 * `focus_*` navigations are gated by follow-mode: when off, they report
 * `{ focused: false, reason: "user_paused_follow" }` instead of moving the UI.
 */
export function useAgentBuilderClientTools(): ClientToolHandler {
  const navigate = useNavigate();
  const client = useAuthenticatedClient();
  const queryClient = useQueryClient();
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const followMode = useAgentBuilderStore((s) => s.followMode);
  const setPendingSecret = useAgentBuilderStore((s) => s.setPendingSecret);
  const page = useAgentBuilderStore((s) => s.page);
  const followRef = useRef(followMode);
  followRef.current = followMode;
  // Latest page context without re-creating the handler each render — resolves
  // the revision a `set_secret` punch-out targets when the agent omits one.
  const pageRef = useRef(page);
  pageRef.current = page;

  return useCallback(
    async (data) => {
      const args = (data.args ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);

      // set_application_description — write the agent's short summary. The
      // overview surfaces this directly; capping the length keeps it scannable
      // and forces the agent to retry shorter on overflow.
      if (data.tool_id === "set_application_description") {
        const agentSlug = str(args.agent_slug);
        const description = str(args.description);
        if (!agentSlug) return { error: "missing_arg: agent_slug" };
        if (description === undefined) {
          return { error: "missing_arg: description" };
        }
        const trimmed = description.trim();
        if (trimmed.length > MAX_DESCRIPTION_CHARS) {
          return {
            error: `description_too_long: max ${MAX_DESCRIPTION_CHARS} chars`,
          };
        }
        try {
          await client.updateAgentApplication(agentSlug, {
            description: trimmed,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { error: `update_failed: ${msg}` };
        }
        void queryClient.invalidateQueries({
          queryKey: agentApplicationsKeys.detail(projectId, agentSlug),
        });
        void queryClient.invalidateQueries({
          queryKey: agentApplicationsKeys.list(projectId),
        });
        return { result: { success: true } };
      }

      // set_secret — interactive punch-out. Park the call (defer) and render a
      // form; the dock PUTs the key and wakes the session on submit. Env keys
      // are revision-scoped, so resolve the target revision from the tool args,
      // falling back to the revision the user is currently viewing in the
      // agent-config page.
      if (data.tool_id === "set_secret") {
        const agentSlug = str(args.agent_slug);
        const secret = str(args.secret);
        if (!agentSlug) return { error: "missing_arg: agent_slug" };
        if (!secret) return { error: "missing_arg: secret" };
        const p = pageRef.current;
        const pageRevision = p.kind === "agent-config" ? p.revision : undefined;
        const revisionId = str(args.revision_id) ?? pageRevision;
        if (!revisionId) return { error: "missing_arg: revision_id" };
        const mode = args.mode === "rotate" ? "rotate" : "set";
        setPendingSecret({
          callId: data.call_id,
          agentSlug,
          revisionId,
          secret,
          mode,
          purpose: str(args.purpose),
        });
        return { defer: true };
      }

      if (!data.tool_id.startsWith("focus_")) return null;
      const slug = str(args.slug);
      if (!followRef.current) {
        return { result: { focused: false, reason: "user_paused_follow" } };
      }
      if (!slug) {
        return { result: { focused: false, reason: "missing_slug" } };
      }
      const params = { idOrSlug: slug };

      switch (data.tool_id) {
        case "focus_tab": {
          const tab = str(args.tab) ?? "overview";
          switch (tab) {
            case "configuration":
              navigate({
                to: "/code/agents/applications/$idOrSlug/configuration",
                params,
              });
              break;
            case "sessions":
              navigate({
                to: "/code/agents/applications/$idOrSlug/sessions",
                params,
              });
              break;
            case "memory":
              navigate({
                to: "/code/agents/applications/$idOrSlug/memory",
                params,
              });
              break;
            case "approvals":
              navigate({
                to: "/code/agents/applications/$idOrSlug/approvals",
                params,
              });
              break;
            case "observability":
              navigate({
                to: "/code/agents/applications/$idOrSlug/observability",
                params,
              });
              break;
            case "chat":
              navigate({
                to: "/code/agents/applications/$idOrSlug/chat",
                params,
              });
              break;
            default:
              navigate({
                to: "/code/agents/applications/$idOrSlug",
                params,
              });
          }
          return { result: { focused: true } };
        }
        case "focus_file":
          navigate({
            to: "/code/agents/applications/$idOrSlug/configuration",
            params,
            search: { node: str(args.path) },
          });
          return { result: { focused: true } };
        case "focus_spec_section":
          navigate({
            to: "/code/agents/applications/$idOrSlug/configuration",
            params,
            search: { node: str(args.section) },
          });
          return { result: { focused: true } };
        case "focus_revision":
          navigate({
            to: "/code/agents/applications/$idOrSlug/configuration",
            params,
            search: { revision: str(args.revisionId) },
          });
          return { result: { focused: true } };
        case "focus_session": {
          const sessionId = str(args.sessionId);
          if (!sessionId) {
            return { result: { focused: false, reason: "missing_session_id" } };
          }
          navigate({
            to: "/code/agents/applications/$idOrSlug/sessions/$sessionId",
            params: { idOrSlug: slug, sessionId },
          });
          return { result: { focused: true } };
        }
        default:
          return { result: { focused: false, reason: "unknown_focus_target" } };
      }
    },
    [navigate, setPendingSecret, client, queryClient, projectId],
  );
}
