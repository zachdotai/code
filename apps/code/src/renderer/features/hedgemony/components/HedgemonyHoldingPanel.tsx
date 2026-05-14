import { useDroppable } from "@dnd-kit/react";
import { CaretDown, CaretRight, X } from "@phosphor-icons/react";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initializeSignalStagingHogletStore,
  initializeWildHogletStore,
} from "../service/hogletSubscriptionService";
import { useHedgemonyViewStore } from "../stores/hedgemonyViewStore";
import {
  selectSignalStagingHoglets,
  selectSignalStagingLoaded,
  selectWildHoglets,
  selectWildLoaded,
  useHogletStore,
} from "../stores/hogletStore";
import { SignalHogletCard } from "./SignalHogletCard";
import { WildHogletCard } from "./WildHogletCard";

const PANEL_WIDTH = 320;
const PANEL_INSET = 24;
const PANEL_HEADER_HEIGHT = 36;
const PANEL_MAX_BODY_HEIGHT = 480;

export function HedgemonyHoldingPanel() {
  const wildHoglets = useHogletStore(selectWildHoglets);
  const wildLoaded = useHogletStore(selectWildLoaded);
  const signalHoglets = useHogletStore(selectSignalStagingHoglets);
  const signalLoaded = useHogletStore(selectSignalStagingLoaded);
  const panel = useHedgemonyViewStore((s) => s.holdingPanel);
  const setOpen = useHedgemonyViewStore((s) => s.setHoldingPanelOpen);
  const toggleCollapsed = useHedgemonyViewStore(
    (s) => s.toggleHoldingPanelCollapsed,
  );
  const setPosition = useHedgemonyViewStore((s) => s.setHoldingPanelPosition);

  const [signalSectionOpen, setSignalSectionOpen] = useState(true);
  const [wildSectionOpen, setWildSectionOpen] = useState(true);

  useEffect(() => {
    const disposeWild = initializeWildHogletStore();
    const disposeSignal = initializeSignalStagingHogletStore();
    return () => {
      disposeWild();
      disposeSignal();
    };
  }, []);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const x =
        panel.x < 0 ? window.innerWidth - PANEL_WIDTH - PANEL_INSET : panel.x;
      const y =
        panel.y < 0
          ? window.innerHeight - PANEL_MAX_BODY_HEIGHT - PANEL_INSET
          : panel.y;
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: x,
        originY: y,
      };
    },
    [panel.x, panel.y],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const nextX = drag.originX + (event.clientX - drag.startX);
      const nextY = drag.originY + (event.clientY - drag.startY);
      const clampedX = Math.max(
        0,
        Math.min(window.innerWidth - PANEL_WIDTH, nextX),
      );
      const clampedY = Math.max(
        0,
        Math.min(window.innerHeight - PANEL_HEADER_HEIGHT, nextY),
      );
      setPosition(clampedX, clampedY);
    },
    [setPosition],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
    },
    [],
  );

  const [defaultPos, setDefaultPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (panel.x < 0 || panel.y < 0) {
      setDefaultPos({
        x: window.innerWidth - PANEL_WIDTH - PANEL_INSET,
        y: window.innerHeight - PANEL_MAX_BODY_HEIGHT - PANEL_INSET,
      });
    } else {
      setDefaultPos(null);
    }
  }, [panel.x, panel.y]);

  const sortedWild = useMemo(
    () =>
      [...wildHoglets].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [wildHoglets],
  );
  const sortedSignal = useMemo(
    () =>
      [...signalHoglets].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [signalHoglets],
  );

  if (!panel.open) return null;

  const effectiveX = defaultPos ? defaultPos.x : panel.x;
  const effectiveY = defaultPos ? defaultPos.y : panel.y;

  return (
    <div
      className="fixed z-30 flex flex-col overflow-hidden rounded-(--radius-3) border border-(--gray-5) bg-(--color-panel-solid) shadow-md"
      style={{
        left: `${effectiveX}px`,
        top: `${effectiveY}px`,
        width: `${PANEL_WIDTH}px`,
      }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex h-9 cursor-grab items-center justify-between border-(--gray-5) border-b px-3 active:cursor-grabbing"
      >
        <Flex align="center" gap="2">
          <button
            type="button"
            onClick={toggleCollapsed}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex h-5 w-5 items-center justify-center rounded text-(--gray-10) hover:bg-(--gray-4) hover:text-(--gray-12)"
            title={panel.collapsed ? "Expand" : "Collapse"}
          >
            {panel.collapsed ? (
              <CaretRight size={12} weight="bold" />
            ) : (
              <CaretDown size={12} weight="bold" />
            )}
          </button>
          <Text size="2" weight="medium" className="text-(--gray-12)">
            Holding area
          </Text>
        </Flex>
        <button
          type="button"
          onClick={() => setOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-5 w-5 items-center justify-center rounded text-(--gray-10) hover:bg-(--gray-4) hover:text-(--gray-12)"
          title="Close"
        >
          <X size={12} weight="bold" />
        </button>
      </div>

      {!panel.collapsed && (
        <div
          className="flex flex-col"
          style={{ maxHeight: `${PANEL_MAX_BODY_HEIGHT}px` }}
        >
          <HoldingSection
            kind="signal_staging"
            title="Unnested signals"
            open={signalSectionOpen}
            onToggle={() => setSignalSectionOpen((v) => !v)}
            loaded={signalLoaded}
            emptyMessage="No unnested signals. Signal reports from Inbox will appear here for grouping."
            hogletCount={signalHoglets.length}
          >
            {sortedSignal.map((hoglet, index) => (
              <SignalHogletCard key={hoglet.id} hoglet={hoglet} index={index} />
            ))}
          </HoldingSection>

          <HoldingSection
            kind="wild"
            title="Wild hoglets"
            open={wildSectionOpen}
            onToggle={() => setWildSectionOpen((v) => !v)}
            loaded={wildLoaded}
            emptyMessage='No wild hoglets. Use "Spawn hoglet" to dispatch a one-off agent, or drop an adopted hoglet here to release it.'
            hogletCount={wildHoglets.length}
          >
            {sortedWild.map((hoglet, index) => (
              <WildHogletCard key={hoglet.id} hoglet={hoglet} index={index} />
            ))}
          </HoldingSection>
        </div>
      )}
    </div>
  );
}

interface HoldingSectionProps {
  kind: "wild" | "signal_staging";
  title: string;
  open: boolean;
  onToggle: () => void;
  loaded: boolean;
  emptyMessage: string;
  hogletCount: number;
  children: React.ReactNode;
}

function HoldingSection({
  kind,
  title,
  open,
  onToggle,
  loaded,
  emptyMessage,
  hogletCount,
  children,
}: HoldingSectionProps) {
  const dropZoneId =
    kind === "wild" ? "wild-drop-zone" : "signal-staging-drop-zone";
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: dropZoneId,
    data: { type: kind },
  });
  const dropLabel = kind === "wild" ? "Release to wild" : "Move to staging";

  return (
    <div
      ref={dropRef}
      className={`flex flex-col border-(--gray-5) border-b transition-colors last:border-b-0 ${
        isDropTarget ? "bg-(--accent-3)" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-8 items-center justify-between border-0 bg-transparent px-3 text-left hover:bg-(--gray-3)"
      >
        <Flex align="center" gap="2">
          {open ? (
            <CaretDown size={10} weight="bold" className="text-(--gray-10)" />
          ) : (
            <CaretRight size={10} weight="bold" className="text-(--gray-10)" />
          )}
          <Text size="2" weight="medium" className="text-(--gray-12)">
            {isDropTarget ? dropLabel : title}
          </Text>
          {!isDropTarget && (
            <Text size="1" className="text-(--gray-10)">
              {hogletCount}
            </Text>
          )}
        </Flex>
      </button>
      {open && (
        <div className="flex flex-col">
          {!loaded && (
            <Text size="2" className="px-3 py-3 text-(--gray-10)">
              Loading…
            </Text>
          )}
          {loaded && hogletCount === 0 && (
            <Text size="2" className="px-3 py-3 text-(--gray-10)">
              {emptyMessage}
            </Text>
          )}
          {loaded && hogletCount > 0 && (
            <ScrollArea type="hover" scrollbars="vertical">
              <Flex direction="column" gap="2" p="2">
                {children}
              </Flex>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
