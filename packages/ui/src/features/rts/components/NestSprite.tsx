import { useDroppable } from "@dnd-kit/react";
import { CheckCircle, Snowflake, Sparkle } from "@phosphor-icons/react";
import type { Nest } from "@posthog/host-router/rts-schemas";
import { Tooltip } from "@radix-ui/themes";
import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import nestImage from "../../../assets/images/rts/nest.png";
import { RTS_CONFIG } from "../config";
import {
  selectNestHoglets,
  selectTaskSummary,
  useHogletStore,
} from "../stores/hogletStore";
import { selectHedgehogState, useNestStore } from "../stores/nestStore";
import {
  deriveNestLifecycle,
  type NestLifecycle,
} from "../utils/nestLifecycle";
import { AnimatedHedgehog } from "./AnimatedHedgehog";
import type { TaskStatus } from "./hogletStatus";

const NEST_SIZE = 140;
const HOG_SIZE_IDLE = 44;
const HOG_SIZE_MOVING = 88;
const SELECTION_RING_SIZE = NEST_SIZE + 24;
const TERRITORY_SIZE = 220;
const TERRITORY_SIZE_SELECTED = 260;
const TERRITORY_SIZE_DROP_TARGET = 280;
const WALK_ANIMATION = "walk" as const;
const IDLE_ANIMATION = "idle" as const;
const TICKING_ANIMATION = "action" as const;

function residentAnimation({
  isMoving,
  isTicking,
}: {
  isMoving: boolean;
  isTicking: boolean;
}): "walk" | "idle" | "action" {
  if (isMoving) return WALK_ANIMATION;
  if (isTicking) return TICKING_ANIMATION;
  return IDLE_ANIMATION;
}

interface NestSpriteProps {
  nest: Nest;
  selected?: boolean;
  /**
   * True when this nest is the parent of the currently selected hoglet(s) but
   * is not itself the selection target. Draws a softer dashed ring so the
   * link between a selected hoglet and its home nest is visible at a glance.
   */
  affiliated?: boolean;
  dimmed?: boolean;
  onSelect?: (nest: Nest) => void;
  onFocus?: (nest: Nest) => void;
}

function territoryBackground(nest: Nest, lifecycle: NestLifecycle): string {
  if (nest.health !== "ok") {
    return "radial-gradient(circle, rgba(251, 146, 60, 0.22) 0%, rgba(251, 146, 60, 0.1) 42%, transparent 72%)";
  }
  if (nest.status === "needs_attention") {
    return "radial-gradient(circle, rgba(248, 113, 113, 0.22) 0%, rgba(248, 113, 113, 0.1) 42%, transparent 72%)";
  }
  switch (lifecycle) {
    case "dormant":
      return "radial-gradient(circle, rgba(148, 163, 184, 0.18) 0%, rgba(148, 163, 184, 0.08) 42%, transparent 72%)";
    case "validated":
      return "radial-gradient(circle, rgba(74, 222, 128, 0.22) 0%, rgba(74, 222, 128, 0.1) 42%, transparent 72%)";
    case "validating":
      return "radial-gradient(circle, rgba(168, 85, 247, 0.26) 0%, rgba(168, 85, 247, 0.12) 42%, transparent 72%)";
    case "planning":
      return "radial-gradient(circle, rgba(125, 211, 252, 0.18) 0%, rgba(125, 211, 252, 0.08) 42%, transparent 72%)";
    default:
      return "radial-gradient(circle, rgba(251, 146, 60, 0.18) 0%, rgba(251, 146, 60, 0.08) 42%, transparent 72%)";
  }
}

const LIFECYCLE_LABEL: Record<NestLifecycle, string> = {
  planning: "Planning",
  working: "Working",
  validating: "Validating",
  validated: "Validated",
  dormant: "Dormant",
  archived: "Archived",
};

function LifecycleBadge({ lifecycle }: { lifecycle: NestLifecycle }) {
  if (lifecycle === "validating") {
    return (
      <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-(--purple-9) text-(--gray-1) shadow">
        <Sparkle size={12} weight="fill" />
      </span>
    );
  }
  if (lifecycle === "validated") {
    return (
      <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-(--green-9) text-(--gray-1) shadow">
        <CheckCircle size={12} weight="fill" />
      </span>
    );
  }
  if (lifecycle === "dormant") {
    return (
      <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-(--gray-8) text-(--gray-1) shadow">
        <Snowflake size={12} weight="fill" />
      </span>
    );
  }
  return null;
}

export function NestSprite({
  nest,
  selected,
  affiliated,
  dimmed,
  onSelect,
  onFocus,
}: NestSpriteProps) {
  const motionX = useMotionValue(nest.mapX);
  const motionY = useMotionValue(nest.mapY);
  const [isMoving, setIsMoving] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const hedgehogState = useNestStore(selectHedgehogState(nest.id));
  const isTicking = hedgehogState?.state === "ticking";

  const hoglets = useHogletStore(selectNestHoglets(nest.id));
  const taskSummaries = useHogletStore((s) => s.taskSummaries);
  const lifecycle = useMemo(
    () =>
      deriveNestLifecycle({
        nest,
        hoglets,
        taskStatusFor: (taskId) =>
          (selectTaskSummary(taskId)({ taskSummaries } as never)?.latest_run
            ?.status as TaskStatus | null) ?? "not_started",
      }),
    [nest, hoglets, taskSummaries],
  );

  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `nest-drop-${nest.id}`,
    data: { type: "nest", nestId: nest.id },
  });

  useEffect(() => {
    const fromX = motionX.get();
    const fromY = motionY.get();
    const dx = nest.mapX - fromX;
    const dy = nest.mapY - fromY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) {
      motionX.set(nest.mapX);
      motionY.set(nest.mapY);
      return;
    }
    // Not prop-sync: facing/isMoving mirror the framer-motion walk animation
    // this effect starts and are cleared by its onComplete/cleanup.
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    if (dx > 0) setFacing("right");
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    else if (dx < 0) setFacing("left");
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setIsMoving(true);
    const duration = dist / RTS_CONFIG.speeds.nest;
    const xControls = animate(motionX, nest.mapX, {
      duration,
      ease: RTS_CONFIG.camera.ease,
    });
    const yControls = animate(motionY, nest.mapY, {
      duration,
      ease: RTS_CONFIG.camera.ease,
      onComplete: () => setIsMoving(false),
    });
    return () => {
      xControls.stop();
      yControls.stop();
    };
  }, [nest.mapX, nest.mapY, motionX, motionY]);

  const showResident = lifecycle !== "dormant";

  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      style={{ x: motionX, y: motionY, opacity: dimmed ? 0.42 : 1 }}
    >
      <Tooltip
        content={
          <div className="flex max-w-[260px] flex-col gap-1">
            <span className="font-medium">{nest.name}</span>
            <span className="text-[11px] opacity-80">{nest.goalPrompt}</span>
          </div>
        }
        side="bottom"
      >
        <motion.button
          ref={dropRef}
          type="button"
          data-rts-nest
          aria-label={`Select ${nest.name}`}
          className="-translate-x-1/2 -translate-y-1/2 flex cursor-pointer flex-col items-center border-0 bg-transparent p-0"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(nest);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onFocus?.(nest);
          }}
        >
          <div className="relative h-[140px] w-[140px]">
            <div
              className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full transition-all duration-150"
              style={{
                width: isDropTarget
                  ? TERRITORY_SIZE_DROP_TARGET
                  : selected
                    ? TERRITORY_SIZE_SELECTED
                    : TERRITORY_SIZE,
                height: isDropTarget
                  ? TERRITORY_SIZE_DROP_TARGET
                  : selected
                    ? TERRITORY_SIZE_SELECTED
                    : TERRITORY_SIZE,
                background: territoryBackground(nest, lifecycle),
                filter: isDropTarget ? "saturate(1.6) brightness(1.1)" : "none",
              }}
            />
            {isTicking && (
              <motion.div
                aria-hidden
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-[260px] w-[260px] rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(253, 224, 71, 0.40) 0%, rgba(253, 224, 71, 0.18) 50%, transparent 78%)",
                  mixBlendMode: "screen",
                }}
                initial={{ opacity: 0.55, scale: 0.9 }}
                animate={{
                  opacity: [0.55, 0.95, 0.55],
                  scale: [0.9, 1.05, 0.9],
                }}
                transition={{
                  duration: 1.6,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
              />
            )}
            {isDropTarget && (
              <motion.span
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-[184px] w-[184px] rounded-full border-(--accent-9) border-2 border-dashed"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              />
            )}
            {selected && !isDropTarget && (
              <motion.span
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-[164px] w-[164px] rounded-full border-(--accent-9) border-2"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            )}
            {affiliated && !selected && !isDropTarget && (
              <motion.span
                aria-hidden
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full border border-(--accent-9) border-dashed opacity-60"
                style={{
                  width: SELECTION_RING_SIZE,
                  height: SELECTION_RING_SIZE,
                }}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 0.6, scale: 1 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            )}
            <motion.img
              src={nestImage}
              alt=""
              className="pointer-events-none absolute inset-0 h-[140px] w-[140px] select-none drop-shadow-md"
              draggable={false}
              animate={{
                opacity: isMoving ? 0 : 1,
                scale: isMoving ? 0.85 : 1,
              }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            />
            {showResident && (
              <motion.div
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute"
                animate={{
                  left: "50%",
                  top: isMoving ? "50%" : "72%",
                }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <AnimatedHedgehog
                  animation={residentAnimation({ isMoving, isTicking })}
                  fps={isMoving ? 14 : isTicking ? 10 : 8}
                  facing={facing}
                  size={isMoving ? HOG_SIZE_MOVING : HOG_SIZE_IDLE}
                />
              </motion.div>
            )}
            <LifecycleBadge lifecycle={lifecycle} />
          </div>
          <div className="mt-1 flex max-w-[180px] items-center gap-1 truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-12) text-[12px] shadow-sm">
            <span className="truncate">{nest.name}</span>
            {lifecycle !== "working" && lifecycle !== "archived" && (
              <span className="shrink-0 text-(--gray-10) text-[10px] uppercase tracking-wider">
                · {LIFECYCLE_LABEL[lifecycle]}
              </span>
            )}
          </div>
        </motion.button>
      </Tooltip>
    </motion.div>
  );
}
