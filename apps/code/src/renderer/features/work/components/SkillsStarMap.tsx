import { Box, Flex, Text } from "@radix-ui/themes";
import { useEffect, useId, useState } from "react";
import {
  AXIS_LABEL,
  AXIS_ORDER,
  type StarAxis,
  type StarMapScores,
} from "../utils/computeStarMap";

const VIEWBOX = 360;
const CENTER = VIEWBOX / 2;
const OUTER_RADIUS = 120;
const LABEL_RADIUS = OUTER_RADIUS + 24;
const RING_STEPS = [0.25, 0.5, 0.75, 1];
const ANIM_DURATION_MS = 600;

const MINI_VIEWBOX = 56;
const MINI_CENTER = MINI_VIEWBOX / 2;
const MINI_RADIUS = 22;

interface SkillsStarMapProps {
  scores: StarMapScores;
  lastComputedAt?: number;
}

function vertexFor(
  axisIndex: number,
  radius: number,
  center = CENTER,
): [number, number] {
  const angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / AXIS_ORDER.length;
  return [center + Math.cos(angle) * radius, center + Math.sin(angle) * radius];
}

function polygonPoints(radii: number[], center = CENTER): string {
  return radii.map((r, i) => vertexFor(i, r, center).join(",")).join(" ");
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function formatRelative(now: number, then: number): string {
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes === 1) return "Updated 1 minute ago";
  if (minutes < 60) return `Updated ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "Updated 1 hour ago";
  return `Updated ${hours} hours ago`;
}

function axisAnchor(axisIndex: number): "start" | "middle" | "end" {
  const angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / AXIS_ORDER.length;
  const cos = Math.cos(angle);
  if (cos > 0.25) return "start";
  if (cos < -0.25) return "end";
  return "middle";
}

function useMountEase(durationMs: number): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setProgress(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);
  return progress;
}

export function SkillsStarMap({ scores, lastComputedAt }: SkillsStarMapProps) {
  const progress = useMountEase(ANIM_DURATION_MS);
  const uid = useId().replace(/:/g, "");
  const fillId = `star-map-fill-${uid}`;
  const bgId = `star-map-bg-${uid}`;

  const maxAxis = scores.max > 0 ? scores.max : 1;
  const dataRadii = AXIS_ORDER.map(
    (axis) => (scores.axes[axis] / maxAxis) * OUTER_RADIUS * progress,
  );

  const founderDisplay = Math.round(scores.founder * 10) / 10;
  const updatedLabel =
    lastComputedAt != null ? formatRelative(Date.now(), lastComputedAt) : null;

  return (
    <Flex direction="column" align="center" gap="3" className="w-full">
      <Box className="relative w-full max-w-[380px]">
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          role="img"
          aria-label="Skill mix star map across Marketing, Operations, Product, Design, HR, Finance, and Legal"
          className="block h-auto w-full overflow-visible"
        >
          <title>Your skill mix star map</title>
          <defs>
            <radialGradient id={fillId} cx="50%" cy="50%" r="65%">
              <stop
                offset="0%"
                stopColor="var(--orange-9)"
                stopOpacity={0.32}
              />
              <stop
                offset="100%"
                stopColor="var(--orange-9)"
                stopOpacity={0.1}
              />
            </radialGradient>
            <radialGradient id={bgId} cx="50%" cy="50%" r="65%">
              <stop offset="0%" stopColor="var(--gray-3)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--gray-2)" stopOpacity={0} />
            </radialGradient>
          </defs>

          <circle
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS}
            fill={`url(#${bgId})`}
          />

          {RING_STEPS.map((step, i) => (
            <polygon
              key={step}
              points={polygonPoints(AXIS_ORDER.map(() => OUTER_RADIUS * step))}
              fill="none"
              stroke={
                i === RING_STEPS.length - 1 ? "var(--gray-6)" : "var(--gray-5)"
              }
              strokeWidth={i === RING_STEPS.length - 1 ? 1 : 0.6}
              strokeDasharray={i === RING_STEPS.length - 1 ? undefined : "2 4"}
            />
          ))}

          {AXIS_ORDER.map((axis, i) => {
            const [x, y] = vertexFor(i, OUTER_RADIUS);
            return (
              <line
                key={`spoke-${axis}`}
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
                stroke="var(--gray-5)"
                strokeWidth={0.6}
              />
            );
          })}

          {AXIS_ORDER.map((axis, i) => {
            const [x, y] = vertexFor(i, OUTER_RADIUS);
            return (
              <circle
                key={`tip-${axis}`}
                cx={x}
                cy={y}
                r={1.5}
                fill="var(--gray-7)"
              />
            );
          })}

          {scores.max > 0 && (
            <polygon
              points={polygonPoints(dataRadii)}
              fill={`url(#${fillId})`}
              stroke="var(--orange-9)"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          )}

          {scores.max > 0 &&
            AXIS_ORDER.map((axis, i) => {
              const [x, y] = vertexFor(i, dataRadii[i]);
              return (
                <circle
                  key={`dot-${axis}`}
                  cx={x}
                  cy={y}
                  r={3}
                  fill="var(--orange-9)"
                  stroke="var(--gray-1)"
                  strokeWidth={1.25}
                />
              );
            })}

          <circle
            cx={CENTER}
            cy={CENTER}
            r={28}
            fill="var(--gray-1)"
            stroke="var(--gray-6)"
            strokeWidth={1}
          />
          <text
            x={CENTER}
            y={CENTER - 5}
            textAnchor="middle"
            fontSize={9}
            fontWeight={500}
            fill="var(--gray-10)"
          >
            Founder
          </text>
          <text
            x={CENTER}
            y={CENTER + 11}
            textAnchor="middle"
            fontSize={15}
            fontWeight={600}
            fill="var(--gray-12)"
          >
            {founderDisplay}
          </text>

          {AXIS_ORDER.map((axis: StarAxis, i) => {
            const [x, y] = vertexFor(i, LABEL_RADIUS);
            return (
              <text
                key={`label-${axis}`}
                x={x}
                y={y}
                textAnchor={axisAnchor(i)}
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={500}
                fill="var(--gray-12)"
              >
                {AXIS_LABEL[axis]}
              </text>
            );
          })}
        </svg>
      </Box>
      {updatedLabel && (
        <Text as="div" className="text-(--gray-10) text-[11px]">
          {updatedLabel}
        </Text>
      )}
    </Flex>
  );
}

interface SkillsStarMapMiniProps {
  scores: StarMapScores;
  size?: number;
}

export function SkillsStarMapMini({
  scores,
  size = 44,
}: SkillsStarMapMiniProps) {
  const progress = useMountEase(ANIM_DURATION_MS);
  const uid = useId().replace(/:/g, "");
  const fillId = `mini-fill-${uid}`;
  const maxAxis = scores.max > 0 ? scores.max : 1;
  const dataRadii = AXIS_ORDER.map(
    (axis) => (scores.axes[axis] / maxAxis) * MINI_RADIUS * progress,
  );

  return (
    <svg
      viewBox={`0 0 ${MINI_VIEWBOX} ${MINI_VIEWBOX}`}
      width={size}
      height={size}
      role="img"
      aria-label="Star map preview"
      className="shrink-0"
    >
      <defs>
        <radialGradient id={fillId} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="var(--orange-9)" stopOpacity={0.45} />
          <stop offset="100%" stopColor="var(--orange-9)" stopOpacity={0.15} />
        </radialGradient>
      </defs>
      <polygon
        points={polygonPoints(
          AXIS_ORDER.map(() => MINI_RADIUS),
          MINI_CENTER,
        )}
        fill="none"
        stroke="var(--gray-6)"
        strokeWidth={0.6}
      />
      {AXIS_ORDER.map((axis, i) => {
        const [x, y] = vertexFor(i, MINI_RADIUS, MINI_CENTER);
        return (
          <line
            key={`mini-spoke-${axis}`}
            x1={MINI_CENTER}
            y1={MINI_CENTER}
            x2={x}
            y2={y}
            stroke="var(--gray-5)"
            strokeWidth={0.4}
          />
        );
      })}
      {scores.max > 0 && (
        <polygon
          points={polygonPoints(dataRadii, MINI_CENTER)}
          fill={`url(#${fillId})`}
          stroke="var(--orange-9)"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
