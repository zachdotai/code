import { trpc } from "@renderer/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { selectNests, useNestStore } from "../stores/nestStore";
import { CommandConsole } from "./CommandConsole";
import { MoneyHedgehog } from "./MoneyHedgehog";

interface FinOpsPanelProps {
  onClose: () => void;
}

const WORKLOAD_LABEL: Record<string, string> = {
  "hedgehog-tick": "Hedgehog ticks",
  "brood-hoglet": "Brood hoglets",
  "wild-hoglet": "Wild hoglets",
};

function formatCost(usd: number): string {
  if (usd < 0.01) return "$0.00";
  if (usd < 10) return `$${usd.toFixed(4)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

export function FinOpsPanel({ onClose }: FinOpsPanelProps) {
  const { data, isLoading } = useQuery(
    trpc.hedgemony.usage.summary.queryOptions(undefined, {
      refetchInterval: 5000,
      staleTime: 4000,
    }),
  );

  const nests = useNestStore(selectNests);
  const nestNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nests) map.set(n.id, n.name);
    return map;
  }, [nests]);

  return (
    <CommandConsole consoleKey="finops" placement="right">
      <CommandConsole.Header
        eyebrow="FinOps"
        title="Money Hedgehog"
        subtitle="Raw token spend across Hedgemony · demo-only"
        onClose={onClose}
      />
      <CommandConsole.Body scroll>
        <div className="flex items-center gap-3 pb-1">
          <MoneyHedgehog size={88} />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-(--gray-10) text-[10px] uppercase tracking-[0.18em]">
              Total spend
            </div>
            <div className="font-semibold text-(--gray-12) text-[28px] tabular-nums leading-tight">
              {data ? formatCost(data.global.totalCostUsd) : "—"}
            </div>
            <div className="text-(--gray-10) text-[11px] leading-snug">
              {data
                ? `${data.global.eventCount.toLocaleString()} events · ${formatTokens(data.global.totalInputTokens + data.global.totalOutputTokens)} tokens`
                : isLoading
                  ? "Loading…"
                  : "No data yet"}
            </div>
          </div>
        </div>

        <CommandConsole.Section noDivider className="pt-2">
          <div className="font-mono text-(--accent-11) text-[10px] uppercase tracking-[0.18em]">
            By workload
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {data?.byWorkload.length ? (
              data.byWorkload
                .slice()
                .sort((a, b) => b.row.totalCostUsd - a.row.totalCostUsd)
                .map((entry) => (
                  <div
                    key={entry.workload}
                    className="flex items-baseline justify-between gap-2 border-(--gray-4) border-b border-dashed pb-1 last:border-b-0"
                  >
                    <span className="truncate text-(--gray-12) text-[12px]">
                      {WORKLOAD_LABEL[entry.workload] ?? entry.workload}
                    </span>
                    <span className="shrink-0 text-(--gray-11) text-[11px] tabular-nums">
                      {formatCost(entry.row.totalCostUsd)}
                      <span className="ml-1 text-(--gray-9)">
                        · {entry.row.eventCount}
                      </span>
                    </span>
                  </div>
                ))
            ) : (
              <span className="text-(--gray-9) text-[11px]">No usage yet.</span>
            )}
          </div>
        </CommandConsole.Section>

        <CommandConsole.Section noDivider className="pt-2">
          <div className="font-mono text-(--accent-11) text-[10px] uppercase tracking-[0.18em]">
            By model
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {data?.byModel.length ? (
              data.byModel.map((entry) => (
                <div
                  key={entry.model}
                  className="flex items-baseline justify-between gap-2 border-(--gray-4) border-b border-dashed pb-1 last:border-b-0"
                >
                  <span className="truncate font-mono text-(--gray-12) text-[12px]">
                    {entry.model}
                  </span>
                  <span className="shrink-0 text-(--gray-11) text-[11px] tabular-nums">
                    {formatCost(entry.row.totalCostUsd)}
                    <span className="ml-1 text-(--gray-9)">
                      ·{" "}
                      {formatTokens(
                        entry.row.totalInputTokens +
                          entry.row.totalOutputTokens,
                      )}{" "}
                      tok
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <span className="text-(--gray-9) text-[11px]">No usage yet.</span>
            )}
          </div>
        </CommandConsole.Section>

        <CommandConsole.Section noDivider className="pt-2">
          <div className="font-mono text-(--accent-11) text-[10px] uppercase tracking-[0.18em]">
            Top nests
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {data?.topNests.length ? (
              data.topNests.map((entry) => (
                <div
                  key={entry.nestId}
                  className="flex items-baseline justify-between gap-2 border-(--gray-4) border-b border-dashed pb-1 last:border-b-0"
                >
                  <span className="truncate text-(--gray-12) text-[12px]">
                    {nestNameById.get(entry.nestId) ?? entry.nestId}
                  </span>
                  <span className="shrink-0 text-(--gray-11) text-[11px] tabular-nums">
                    {formatCost(entry.row.totalCostUsd)}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-(--gray-9) text-[11px]">
                No nest spend yet.
              </span>
            )}
          </div>
        </CommandConsole.Section>

        <div className="mt-1 text-(--gray-9) text-[10px] leading-snug">
          Polls every 5s. Cost is raw provider API spend (sdk-reported when
          available, otherwise pricing-table fallback). Not the product price.
        </div>
      </CommandConsole.Body>
    </CommandConsole>
  );
}
