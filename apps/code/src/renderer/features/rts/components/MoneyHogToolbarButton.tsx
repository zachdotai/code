import { useCanViewFinOps } from "@features/auth/hooks/useOrgRole";
import { CurrencyDollarSimple, Sparkle } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import { trpc } from "@renderer/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

function formatCost(usd: number): string {
  if (usd < 0.01) return "$0.00";
  if (usd < 10) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

interface MoneyHogToolbarButtonProps {
  selected?: boolean;
  onSelect?: () => void;
}

/**
 * Live "Money Hedgehog" toolbar chip. Gated behind `useCanViewFinOps` so it
 * only renders for PostHog org members and the demo-allowlisted accounts —
 * the figure is raw provider API cost and would confuse non-allowlisted
 * viewers who only see the consumer product price.
 */
export function MoneyHogToolbarButton({
  selected,
  onSelect,
}: MoneyHogToolbarButtonProps) {
  const canView = useCanViewFinOps();
  const { data } = useQuery(
    trpc.hedgemony.usage.summary.queryOptions(undefined, {
      refetchInterval: 5000,
      staleTime: 4000,
      enabled: canView === true,
    }),
  );

  if (!canView) return null;

  const cost = data ? formatCost(data.global.totalCostUsd) : "$0.00";
  const baseClasses =
    "flex h-7 items-center gap-1 rounded-(--radius-2) border px-2 text-[12px] tabular-nums transition-colors";
  const stateClasses = selected
    ? "border-(--accent-8) bg-(--accent-a4) text-(--accent-12)"
    : "border-(--gray-5) bg-(--gray-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)";

  return (
    <Tooltip content="Money Hedgehog · token spend across Hedgemony">
      <button
        type="button"
        onClick={onSelect}
        className={`${baseClasses} ${stateClasses}`}
        aria-label="Money Hedgehog"
      >
        <span className="relative inline-flex items-center">
          <CurrencyDollarSimple
            size={14}
            weight="bold"
            className="text-[#f3c84a]"
            style={{
              filter:
                "drop-shadow(0 0 3px rgba(243, 200, 74, 0.7)) drop-shadow(0 0 1px rgba(243, 200, 74, 0.9))",
            }}
          />
          <motion.span
            className="-top-1 -right-1.5 pointer-events-none absolute text-[#f3c84a]"
            animate={{
              opacity: [0.3, 1, 0.3],
              scale: [0.6, 1.1, 0.6],
              rotate: [0, 90, 180],
            }}
            transition={{
              duration: 1.6,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
          >
            <Sparkle size={7} weight="fill" />
          </motion.span>
        </span>
        {cost}
      </button>
    </Tooltip>
  );
}
