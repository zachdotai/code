import { ArrowLeftIcon, RobotIcon } from "@phosphor-icons/react";
import { formatRelativeTimeShort } from "@posthog/shared";
import type {
  AgentSessionPrincipal,
  AgentSessionSummary,
} from "@posthog/shared/agent-platform-types";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useAgentApplication } from "../hooks/useAgentApplication";
import { useAgentApplicationSessions } from "../hooks/useAgentApplicationSessions";
import { useAgentApplicationStats } from "../hooks/useAgentApplicationStats";
import { formatSpendUsd, sessionStateColor } from "../utils/format";

/**
 * Per-agent detail: overview + stat strip + recent sessions. The chat surface
 * and config editor land in later milestones.
 */
export function AgentApplicationDetailView({ idOrSlug }: { idOrSlug: string }) {
  const {
    data: application,
    isLoading,
    isError,
  } = useAgentApplication(idOrSlug);
  const { data: stats } = useAgentApplicationStats(idOrSlug);
  const { data: sessions, isLoading: sessionsLoading } =
    useAgentApplicationSessions(idOrSlug, { limit: 25 });

  const title = application?.name ?? idOrSlug;
  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <RobotIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title={title}
        >
          {title}
        </Text>
      </Flex>
    ),
    [title],
  );
  useSetHeaderContent(headerContent);

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="2"
        className="cursor-default select-none border-(--gray-5) border-b px-6 pt-5 pb-5"
      >
        <Link
          to="/code/agents/applications"
          className="flex w-fit items-center gap-1.5 text-[12px] text-gray-11 no-underline hover:text-gray-12"
        >
          <ArrowLeftIcon size={13} />
          Applications
        </Link>
        <Flex align="center" gap="2" wrap="wrap">
          <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
            {title}
          </Text>
          {application ? (
            <Badge color={application.live_revision ? "green" : "gray"}>
              {application.live_revision ? "Live" : "Draft"}
            </Badge>
          ) : null}
        </Flex>
        {application?.description?.trim() ? (
          <Text className="max-w-3xl text-[12.5px] text-gray-11 leading-snug">
            {application.description}
          </Text>
        ) : null}
      </Flex>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {isLoading ? (
            <div className="h-24 animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)" />
          ) : isError || !application ? (
            <EmptyState
              title="Couldn't load this agent"
              description="It may have been archived, or the agent platform API returned an error."
            />
          ) : (
            <Flex direction="column" gap="6">
              <StatStrip
                liveCount={stats?.liveCount ?? 0}
                sessionsInWindowCount={stats?.sessionsInWindowCount ?? 0}
                spendInWindowUsd={stats?.spendInWindowUsd ?? 0}
                failedInWindowCount={stats?.failedInWindowCount ?? 0}
              />

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
                ) : !sessions || sessions.results.length === 0 ? (
                  <EmptyState
                    title="No sessions yet"
                    description="Sessions this agent runs will appear here."
                  />
                ) : (
                  <Flex direction="column" gap="2">
                    {sessions.results.map((session) => (
                      <SessionRow key={session.id} session={session} />
                    ))}
                  </Flex>
                )}
              </section>
            </Flex>
          )}
        </div>
      </div>
    </Flex>
  );
}

function StatStrip({
  liveCount,
  sessionsInWindowCount,
  spendInWindowUsd,
  failedInWindowCount,
}: {
  liveCount: number;
  sessionsInWindowCount: number;
  spendInWindowUsd: number;
  failedInWindowCount: number;
}) {
  return (
    <Flex
      gap="0"
      className="overflow-hidden rounded-(--radius-2) border border-border bg-(--color-panel-solid)"
    >
      <Stat label="Live" value={String(liveCount)} />
      <Stat label="Sessions (24h)" value={String(sessionsInWindowCount)} />
      <Stat label="Spend (24h)" value={formatSpendUsd(spendInWindowUsd)} />
      <Stat label="Failed (24h)" value={String(failedInWindowCount)} last />
    </Flex>
  );
}

function Stat({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <Flex
      direction="column"
      gap="1"
      className={`min-w-0 flex-1 px-4 py-3 ${
        last ? "" : "border-(--gray-5) border-r"
      }`}
    >
      <Text className="truncate text-[11px] text-gray-10 uppercase tracking-wide">
        {label}
      </Text>
      <Text className="font-semibold text-[18px] text-gray-12 leading-none">
        {value}
      </Text>
    </Flex>
  );
}

function principalLabel(principal: AgentSessionPrincipal | null): string {
  if (!principal) return "anonymous";
  return principal.kind;
}

function SessionRow({ session }: { session: AgentSessionSummary }) {
  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3"
    >
      <Flex direction="column" gap="1" className="min-w-0">
        <Flex align="center" gap="2" className="min-w-0">
          <Badge color={sessionStateColor(session.state)}>
            {session.state}
          </Badge>
          <Text className="truncate text-[12.5px] text-gray-12">
            {session.preview?.trim() ? session.preview : "No assistant output"}
          </Text>
        </Flex>
        <Text className="truncate text-[11px] text-gray-10">
          {principalLabel(session.principal)} · {session.turns} turns ·{" "}
          {formatSpendUsd(session.usage_total.cost_total)}
        </Text>
      </Flex>
      <Text className="shrink-0 text-[11px] text-gray-10">
        {formatRelativeTimeShort(session.updated_at)}
      </Text>
    </Flex>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <Flex
      direction="column"
      align="center"
      gap="1"
      className="rounded-(--radius-2) border border-(--gray-5) border-dashed px-6 py-10 text-center"
    >
      <Text className="font-medium text-[13px] text-gray-12">{title}</Text>
      <Text className="max-w-md text-[12px] text-gray-11 leading-snug">
        {description}
      </Text>
    </Flex>
  );
}
