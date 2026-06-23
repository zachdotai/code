import type { AgentSpec } from "@posthog/shared/agent-platform-types";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAgentAnalytics } from "../hooks/useAgentAnalytics";
import { useAgentApplication } from "../hooks/useAgentApplication";
import { useAgentApplicationSessions } from "../hooks/useAgentApplicationSessions";
import { useAgentRevision } from "../hooks/useAgentRevision";
import { useAgentRevisions } from "../hooks/useAgentRevisions";
import { AgentAnalyticsKpiStrip } from "./AgentAnalyticsView";
import { AgentDetailEmptyState, AgentDetailLayout } from "./AgentDetailLayout";
import { AgentSessionRow } from "./AgentSessionRow";

/**
 * Per-agent Overview pane: a one-paragraph description + config summary (what
 * this agent is wired up to do), then the top-level observability KPIs (spend /
 * sessions / failure rate / p95 over the last 7 days, with trends + WoW deltas —
 * the same metrics as the Observability tab), then recent sessions. Rendered
 * inside the shared {@link AgentDetailLayout} tab shell.
 */
export function AgentApplicationDetailView({ idOrSlug }: { idOrSlug: string }) {
  const { data: application } = useAgentApplication(idOrSlug);
  const { data: analytics, isLoading: analyticsLoading } = useAgentAnalytics(
    application?.id,
    "agent",
  );
  const {
    data: sessions,
    isLoading: sessionsLoading,
    isError: sessionsError,
  } = useAgentApplicationSessions(idOrSlug, { limit: 25 });

  return (
    <AgentDetailLayout idOrSlug={idOrSlug} activeTab="overview">
      <Flex direction="column" gap="6">
        <OverviewConfigSummary idOrSlug={idOrSlug} />

        <section>
          <Flex align="center" justify="between" className="mb-3">
            <Text className="font-semibold text-[13px] text-gray-12">
              Activity · last 7 days
            </Text>
            <Link
              to="/code/agents/applications/$idOrSlug/observability"
              params={{ idOrSlug }}
              className="text-[12px] text-gray-11 no-underline hover:text-gray-12"
            >
              View observability →
            </Link>
          </Flex>
          <AgentAnalyticsKpiStrip
            data={analytics}
            isLoading={analyticsLoading || !application}
          />
        </section>

        <section>
          <Text className="mb-3 block font-semibold text-[13px] text-gray-12">
            Recent sessions
          </Text>
          {sessionsLoading ? (
            <Flex direction="column" gap="2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[52px] animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)"
                />
              ))}
            </Flex>
          ) : sessionsError ? (
            <AgentDetailEmptyState
              title="Couldn't load recent sessions"
              description="The agent platform API returned an error."
            />
          ) : !sessions || sessions.results.length === 0 ? (
            <AgentDetailEmptyState
              title="No sessions yet"
              description="Sessions this agent runs will appear here."
            />
          ) : (
            <Flex direction="column" gap="2">
              {sessions.results.map((session) => (
                <AgentSessionRow
                  key={session.id}
                  session={session}
                  idOrSlug={idOrSlug}
                />
              ))}
            </Flex>
          )}
        </section>
      </Flex>
    </AgentDetailLayout>
  );
}

const KNOWN_TRIGGERS = ["cron", "slack", "webhook", "chat", "mcp"] as const;
type KnownTrigger = (typeof KNOWN_TRIGGERS)[number];

interface ConfigCounts {
  triggersByType: Map<string, number>;
  tools: number;
  skills: number;
  mcps: number;
  identities: number;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function countsFor(spec: AgentSpec | null | undefined): ConfigCounts {
  const triggersByType = new Map<string, number>();
  if (spec) {
    for (const t of arr(spec.triggers)) {
      const type =
        typeof rec(t).type === "string" ? (rec(t).type as string) : "other";
      triggersByType.set(type, (triggersByType.get(type) ?? 0) + 1);
    }
  }
  return {
    triggersByType,
    tools: arr(spec?.tools).length,
    skills: arr(spec?.skills).length,
    mcps: arr(spec?.mcps).length,
    identities: arr(spec?.identity_providers).length,
  };
}

/**
 * Top-of-overview summary: a one-liner about what this agent does (sourced from
 * `application.description`, which the agent-builder maintains via the
 * `set_application_description` client tool) and a compact map of what's wired
 * up — triggers by type, tools, skills, MCPs, identities. Counts come from the
 * live revision's spec, falling back to the newest revision when nothing is
 * live yet.
 */
function OverviewConfigSummary({ idOrSlug }: { idOrSlug: string }) {
  const { data: application } = useAgentApplication(idOrSlug);
  const { data: revisions } = useAgentRevisions(idOrSlug);
  const revisionId = application?.live_revision ?? revisions?.[0]?.id ?? null;
  const { data: revision } = useAgentRevision(idOrSlug, revisionId);
  const counts = useMemo(() => countsFor(revision?.spec), [revision?.spec]);

  const description = application?.description?.trim();
  const triggerChips = [...counts.triggersByType.entries()].sort((a, b) => {
    const aKnown = KNOWN_TRIGGERS.indexOf(a[0] as KnownTrigger);
    const bKnown = KNOWN_TRIGGERS.indexOf(b[0] as KnownTrigger);
    if (aKnown !== bKnown) {
      if (aKnown === -1) return 1;
      if (bKnown === -1) return -1;
      return aKnown - bKnown;
    }
    return a[0].localeCompare(b[0]);
  });

  return (
    <section>
      <Text className="mb-3 block font-semibold text-[13px] text-gray-12">
        About this agent
      </Text>
      <Flex direction="column" gap="3">
        {description ? (
          <Text className="text-[12.5px] text-gray-11 leading-snug">
            {description}
          </Text>
        ) : (
          <Text className="text-[12.5px] text-gray-10 italic leading-snug">
            No description yet — the agent-builder will write one as it sets
            this agent up.
          </Text>
        )}
        <Flex gap="2" wrap="wrap">
          <SummaryStat
            label="Triggers"
            value={[...counts.triggersByType.values()].reduce(
              (a, b) => a + b,
              0,
            )}
            detail={
              triggerChips.length
                ? triggerChips
                    .map(([type, n]) => (n > 1 ? `${n} ${type}` : type))
                    .join(" · ")
                : undefined
            }
          />
          <SummaryStat label="Tools" value={counts.tools} />
          <SummaryStat label="Skills" value={counts.skills} />
          <SummaryStat label="MCPs" value={counts.mcps} />
          <SummaryStat label="Identities" value={counts.identities} />
        </Flex>
      </Flex>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <Flex
      direction="column"
      className="min-w-[88px] rounded-(--radius-2) border border-border bg-(--gray-2) px-3 py-2"
    >
      <Text className="text-[10.5px] text-gray-10 uppercase tracking-wide">
        {label}
      </Text>
      <Text className="font-semibold text-[15px] text-gray-12 leading-tight">
        {value}
      </Text>
      {detail ? (
        <Text className="mt-0.5 text-[11px] text-gray-10 leading-snug">
          {detail}
        </Text>
      ) : null}
    </Flex>
  );
}
