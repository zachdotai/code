import spritesData from "@renderer/assets/hedgehog-mode/sprites.json";
import spritesImage from "@renderer/assets/hedgehog-mode/sprites.png";
import { useEffect, useMemo, useRef, useState } from "react";

type Frame = { x: number; y: number; w: number; h: number };

type SpritesAtlas = {
  frames: Record<string, { frame: Frame }>;
  animations: Record<string, string[]>;
  meta: { size: { w: number; h: number } };
};

const atlas = spritesData as unknown as SpritesAtlas;
const ATLAS_W = atlas.meta.size.w;
const ATLAS_H = atlas.meta.size.h;
const NATIVE_FRAME_SIZE = 80;

function getFrames(animation: string): Frame[] {
  const names = atlas.animations[animation];
  if (!names) return [];
  return names.map((name) => atlas.frames[name].frame);
}

interface AnimatedHedgehogProps {
  /** Animation key like `"skins/default/walk/tile"`. */
  animation: string;
  facing?: "left" | "right";
  size?: number;
  fps?: number;
  loop?: boolean;
  onComplete?: () => void;
}

export function AnimatedHedgehog({
  animation,
  facing = "right",
  size = 64,
  fps = 12,
  loop = true,
  onComplete,
}: AnimatedHedgehogProps) {
  const frames = useMemo(() => getFrames(animation), [animation]);
  const [frameIndex, setFrameIndex] = useState(0);
  const completedRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on animation change
  useEffect(() => {
    setFrameIndex(0);
    completedRef.current = false;
  }, [animation]);

  useEffect(() => {
    if (frames.length === 0) return;
    const frameDurationMs = 1000 / fps;
    let last = performance.now();
    let acc = 0;
    let raf = 0;

    const tick = (now: number) => {
      acc += now - last;
      last = now;
      while (acc >= frameDurationMs) {
        acc -= frameDurationMs;
        setFrameIndex((idx) => {
          const next = idx + 1;
          if (next >= frames.length) {
            if (loop) return 0;
            if (!completedRef.current) {
              completedRef.current = true;
              onComplete?.();
            }
            return frames.length - 1;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames, fps, loop, onComplete]);

  if (frames.length === 0) return null;

  const frame = frames[Math.min(frameIndex, frames.length - 1)];
  const scale = size / NATIVE_FRAME_SIZE;

  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${spritesImage})`,
        backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
        backgroundSize: `${ATLAS_W * scale}px ${ATLAS_H * scale}px`,
        transform: facing === "left" ? "scaleX(-1)" : undefined,
      }}
    />
  );
}
