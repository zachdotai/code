import {
  ACCESSORIES_BY_FUN_MODE,
  FILTER_BY_FUN_MODE,
} from "@features/fun-mode/accessories";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import spritesData from "@renderer/assets/hedgehog-mode/sprites.json";
import spritesImage from "@renderer/assets/hedgehog-mode/sprites.png";
import { useEffect, useMemo, useRef, useState } from "react";
import { sceneTicker } from "../runtime/SceneTicker";

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

/**
 * Animations we explicitly consume from the hedgehog-mode atlas. Limits the
 * surface area we depend on so a typo at a call site fails type-checking
 * instead of silently rendering nothing.
 */
export const HEDGEHOG_ANIMATIONS = {
  idle: "skins/default/idle/tile",
  walk: "skins/default/walk/tile",
  action: "skins/default/action/tile",
  wave: "skins/default/wave/tile",
  sign: "skins/default/sign/tile",
  jump: "skins/default/jump/tile",
  fall: "skins/default/fall/tile",
  death: "skins/default/death/tile",
  ghost: "skins/ghost/idle/tile",
  fire: "overlays/fire/tile",
  idleRobo: "skins/robohog/idle/tile",
  walkRobo: "skins/robohog/walk/tile",
  waveRobo: "skins/robohog/wave/tile",
  fallRobo: "skins/robohog/fall/tile",
} as const;

export type HedgehogAnimation = keyof typeof HEDGEHOG_ANIMATIONS;

for (const [name, key] of Object.entries(HEDGEHOG_ANIMATIONS)) {
  if (!atlas.animations[key]) {
    throw new Error(
      `Hedgehog atlas missing animation "${name}" (key "${key}"). Re-vendor sprites.{png,json} from @posthog/hedgehog-mode.`,
    );
  }
}

const FUN_MODE_ACCESSORIES = ["chef", "eyepatch", "cowboy", "parrot"] as const;
for (const name of FUN_MODE_ACCESSORIES) {
  if (!atlas.frames[`accessories/${name}.png`]) {
    throw new Error(
      `Hedgehog atlas missing accessory "${name}". Re-vendor sprites.{png,json} from @posthog/hedgehog-mode.`,
    );
  }
}

function getFrames(animation: HedgehogAnimation): Frame[] {
  const names = atlas.animations[HEDGEHOG_ANIMATIONS[animation]];
  return names.map((name) => atlas.frames[name].frame);
}

function getAccessoryFrame(name: string): Frame {
  return atlas.frames[`accessories/${name}.png`].frame;
}

interface AnimatedHedgehogProps {
  animation: HedgehogAnimation;
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
  const funMode = useSettingsStore((s) => s.funMode);
  const accessories = ACCESSORIES_BY_FUN_MODE[funMode];
  const filter = FILTER_BY_FUN_MODE[funMode];

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on animation change
  useEffect(() => {
    setFrameIndex(0);
    completedRef.current = false;
  }, [animation]);

  useEffect(() => {
    if (frames.length === 0) return;
    const frameDurationMs = 1000 / fps;
    let acc = 0;

    return sceneTicker.on((deltaMs) => {
      acc += deltaMs;
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
    });
  }, [frames, fps, loop, onComplete]);

  if (frames.length === 0) return null;

  const frame = frames[Math.min(frameIndex, frames.length - 1)];
  const scale = size / NATIVE_FRAME_SIZE;
  const atlasBgSize = `${ATLAS_W * scale}px ${ATLAS_H * scale}px`;

  return (
    <div
      aria-hidden
      className="relative"
      style={{
        width: size,
        height: size,
        transform: facing === "left" ? "scaleX(-1)" : undefined,
        filter,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${spritesImage})`,
          backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
          backgroundSize: atlasBgSize,
        }}
      />
      {accessories.map((name) => {
        const af = getAccessoryFrame(name);
        return (
          <div
            key={name}
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${spritesImage})`,
              backgroundPosition: `-${af.x * scale}px -${af.y * scale}px`,
              backgroundSize: atlasBgSize,
            }}
          />
        );
      })}
    </div>
  );
}
