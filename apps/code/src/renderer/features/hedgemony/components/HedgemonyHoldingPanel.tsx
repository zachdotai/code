import { CaretDown, CaretRight, X } from "@phosphor-icons/react";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHedgemonyViewStore } from "../stores/hedgemonyViewStore";
import {
  initializeWildHogletStore,
  selectWildHoglets,
  selectWildLoaded,
  useHogletStore,
} from "../stores/hogletStore";
import { WildHogletCard } from "./WildHogletCard";

const PANEL_WIDTH = 320;
const PANEL_INSET = 24;
const PANEL_HEADER_HEIGHT = 36;
const PANEL_MAX_BODY_HEIGHT = 480;

export function HedgemonyHoldingPanel() {
  const hoglets = useHogletStore(selectWildHoglets);
  const loaded = useHogletStore(selectWildLoaded);
  const panel = useHedgemonyViewStore((s) => s.holdingPanel);
  const setOpen = useHedgemonyViewStore((s) => s.setHoldingPanelOpen);
  const toggleCollapsed = useHedgemonyViewStore(
    (s) => s.toggleHoldingPanelCollapsed,
  );
  const setPosition = useHedgemonyViewStore((s) => s.setHoldingPanelPosition);

  useEffect(() => {
    return initializeWildHogletStore();
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

  const sortedHoglets = useMemo(
    () =>
      [...hoglets].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [hoglets],
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
            Wild hoglets
          </Text>
          <Text size="1" className="text-(--gray-10)">
            {hoglets.length}
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
          {!loaded && (
            <Text size="2" className="px-3 py-4 text-(--gray-10)">
              Loading…
            </Text>
          )}
          {loaded && hoglets.length === 0 && (
            <Text size="2" className="px-3 py-4 text-(--gray-10)">
              No wild hoglets. Use “Spawn hoglet” to dispatch a one-off agent.
            </Text>
          )}
          {loaded && hoglets.length > 0 && (
            <ScrollArea type="hover" scrollbars="vertical">
              <Flex direction="column" gap="2" p="2">
                {sortedHoglets.map((hoglet) => (
                  <WildHogletCard key={hoglet.id} hoglet={hoglet} />
                ))}
              </Flex>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
