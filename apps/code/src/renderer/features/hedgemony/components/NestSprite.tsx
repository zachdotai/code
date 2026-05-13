import type { Nest } from "@main/services/hedgemony/schemas";
import { Tooltip } from "@radix-ui/themes";
import builderHog from "@renderer/assets/images/hedgehogs/builder-hog-03.png";

const SPRITE_SIZE = 96;

interface NestSpriteProps {
  nest: Nest;
}

export function NestSprite({ nest }: NestSpriteProps) {
  return (
    <Tooltip content={nest.goalPrompt} side="bottom">
      <div
        className="-translate-x-1/2 -translate-y-1/2 absolute flex flex-col items-center"
        style={{
          left: `calc(50% + ${nest.mapX}px)`,
          top: `calc(50% + ${nest.mapY}px)`,
        }}
      >
        <div
          className="flex items-center justify-center rounded-full bg-(--gray-2) shadow-md ring-(--accent-7) ring-2"
          style={{ width: SPRITE_SIZE, height: SPRITE_SIZE }}
        >
          <img
            src={builderHog}
            alt=""
            className="pointer-events-none select-none"
            style={{ width: SPRITE_SIZE * 0.8, height: SPRITE_SIZE * 0.8 }}
            draggable={false}
          />
        </div>
        <div className="mt-1 max-w-[160px] truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-12) text-[12px] shadow-sm">
          {nest.name}
        </div>
      </div>
    </Tooltip>
  );
}
