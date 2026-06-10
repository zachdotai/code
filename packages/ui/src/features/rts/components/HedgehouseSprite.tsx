import { Tooltip } from "@radix-ui/themes";
import { motion } from "framer-motion";
import { HEDGEHOUSE_MAP_X, HEDGEHOUSE_MAP_Y } from "../constants/map";

const HEDGEHOUSE_SIZE = 220;
const SELECTION_RING_SIZE = 232;

interface HedgehouseSpriteProps {
  selected?: boolean;
  onSelect?: () => void;
}

export function HedgehouseSprite({
  selected,
  onSelect,
}: HedgehouseSpriteProps) {
  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onSelect?.();
  };

  return (
    <div
      className="absolute top-1/2 left-1/2"
      style={{
        transform: `translate(${HEDGEHOUSE_MAP_X}px, ${HEDGEHOUSE_MAP_Y}px)`,
      }}
    >
      <Tooltip
        content={
          <div className="flex flex-col gap-1">
            <span className="font-medium">Hedgehouse</span>
            <span className="text-[11px] opacity-80">
              Dispatches wild hoglets — short-lived agents for tasks, questions,
              or PR work. No nest, no goal.
            </span>
          </div>
        }
      >
        <motion.button
          type="button"
          data-rts-hedgehouse
          aria-label="Hedgehouse"
          className="-translate-x-1/2 -translate-y-1/2 relative flex cursor-pointer flex-col items-center border-0 bg-transparent p-0"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={handleClick}
        >
          {selected && (
            <motion.span
              className="-translate-x-1/2 pointer-events-none absolute top-0 left-1/2 rounded-full border-(--accent-9) border-2"
              style={{
                width: SELECTION_RING_SIZE,
                height: SELECTION_RING_SIZE,
              }}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            />
          )}
          <svg
            width={HEDGEHOUSE_SIZE}
            height={HEDGEHOUSE_SIZE}
            viewBox="-100 -100 200 200"
            xmlns="http://www.w3.org/2000/svg"
            className="select-none drop-shadow-md"
            aria-hidden="true"
          >
            <title>Hedgehouse</title>
            <ellipse
              cx="6"
              cy="74"
              rx="92"
              ry="14"
              fill="#000"
              opacity="0.32"
            />

            <rect x="-66" y="64" width="132" height="14" fill="#5b3a22" />
            <rect
              x="-66"
              y="64"
              width="132"
              height="3"
              fill="#7d5230"
              opacity="0.8"
            />

            <rect x="-58" y="-4" width="116" height="70" fill="#a98a64" />
            <rect
              x="-58"
              y="-4"
              width="116"
              height="6"
              fill="#c4a37a"
              opacity="0.85"
            />
            <rect
              x="50"
              y="-4"
              width="8"
              height="70"
              fill="#6b4f33"
              opacity="0.55"
            />
            <path
              d="M-58 -4 L-58 66 L-54 66 L-54 -4 Z M58 -4 L58 66 L54 66 L54 -4 Z"
              fill="#5b3a22"
            />
            <path
              d="M-58 26 L58 26 L58 30 L-58 30 Z M-58 -4 L58 -4 L58 -1 L-58 -1 Z M-58 62 L58 62 L58 66 L-58 66 Z"
              fill="#5b3a22"
            />
            <path
              d="M-32 -4 L-32 66 L-28 66 L-28 -4 Z M0 -4 L0 66 L4 66 L4 -4 Z M32 -4 L32 66 L28 66 L28 -4 Z"
              fill="#5b3a22"
            />

            <rect x="-18" y="20" width="36" height="46" fill="#3a2614" />
            <rect
              x="-18"
              y="20"
              width="36"
              height="46"
              fill="none"
              stroke="#5b3a22"
              strokeWidth="3"
            />
            <rect x="-14" y="24" width="28" height="38" fill="#4a2f17" />
            <path
              d="M-14 24 L0 30 L14 24 L14 62 L0 56 L-14 62 Z"
              fill="#623c1c"
              opacity="0.7"
            />
            <circle cx="11" cy="44" r="1.6" fill="#f3c84a" />

            <g>
              <rect x="-48" y="6" width="20" height="18" fill="#7fb9d4" />
              <rect
                x="-48"
                y="6"
                width="20"
                height="18"
                fill="none"
                stroke="#5b3a22"
                strokeWidth="2.5"
              />
              <path
                d="M-48 15 L-28 15 M-38 6 L-38 24"
                stroke="#5b3a22"
                strokeWidth="2"
              />
              <path d="M-46 8 L-32 8 L-46 18 Z" fill="#fff" opacity="0.35" />
            </g>
            <g>
              <rect x="28" y="6" width="20" height="18" fill="#7fb9d4" />
              <rect
                x="28"
                y="6"
                width="20"
                height="18"
                fill="none"
                stroke="#5b3a22"
                strokeWidth="2.5"
              />
              <path
                d="M28 15 L48 15 M38 6 L38 24"
                stroke="#5b3a22"
                strokeWidth="2"
              />
              <path d="M30 8 L44 8 L30 18 Z" fill="#fff" opacity="0.35" />
            </g>
            <g>
              <rect x="-9" y="36" width="18" height="14" fill="#7fb9d4" />
              <rect
                x="-9"
                y="36"
                width="18"
                height="14"
                fill="none"
                stroke="#5b3a22"
                strokeWidth="2"
              />
              <path
                d="M-9 43 L9 43 M0 36 L0 50"
                stroke="#5b3a22"
                strokeWidth="1.6"
              />
            </g>

            <path
              d="M-72 -4 L0 -64 L72 -4 L60 -4 L0 -54 L-60 -4 Z"
              fill="#2a4a30"
            />
            <path d="M-72 -4 L72 -4 L72 4 L-72 4 Z" fill="#22422a" />
            <path
              d="M-66 -8 Q-60 -12 -54 -8 Q-48 -12 -42 -8 Q-36 -12 -30 -8 Q-24 -12 -18 -8 Q-12 -12 -6 -8 Q0 -12 6 -8 Q12 -12 18 -8 Q24 -12 30 -8 Q36 -12 42 -8 Q48 -12 54 -8 Q60 -12 66 -8 L72 -4 L-72 -4 Z"
              fill="#3a6638"
            />
            <path
              d="M-58 -16 Q-52 -20 -46 -16 Q-40 -20 -34 -16 Q-28 -20 -22 -16 Q-16 -20 -10 -16 Q-4 -20 2 -16 Q8 -20 14 -16 Q20 -20 26 -16 Q32 -20 38 -16 Q44 -20 50 -16 Q56 -20 60 -16 L66 -10 L-66 -10 Z"
              fill="#477a47"
            />
            <path
              d="M-44 -32 Q-38 -36 -32 -32 Q-26 -36 -20 -32 Q-14 -36 -8 -32 Q-2 -36 4 -32 Q10 -36 16 -32 Q22 -36 28 -32 Q34 -36 40 -32 Q46 -36 50 -32 L54 -26 L-50 -26 Z"
              fill="#588a4f"
            />
            <path
              d="M-28 -48 Q-22 -52 -16 -48 Q-10 -52 -4 -48 Q2 -52 8 -48 Q14 -52 20 -48 Q26 -52 32 -48 L36 -40 L-32 -40 Z"
              fill="#6fa05a"
            />
            <path d="M-72 -4 L0 -64 L-60 -4 Z" fill="#000" opacity="0.18" />
            <ellipse
              cx="-30"
              cy="-32"
              rx="10"
              ry="4"
              fill="#fff"
              opacity="0.18"
            />

            <rect x="22" y="-58" width="10" height="22" fill="#7d5230" />
            <rect x="22" y="-58" width="10" height="6" fill="#5b3a22" />
            <ellipse
              cx="27"
              cy="-62"
              rx="9"
              ry="4"
              fill="#2c1d10"
              opacity="0.45"
            />

            <g transform="translate(0 -72)">
              <ellipse cx="0" cy="0" rx="14" ry="10" fill="#5b3a22" />
              <ellipse cx="-2" cy="-1" rx="9" ry="6" fill="#a98a64" />
              <circle cx="6" cy="-2" r="1.6" fill="#fff" />
              <circle cx="6" cy="-2" r="0.7" fill="#222" />
              <path
                d="M-10 -2 L-4 -8 M-4 -2 L2 -10 M2 -2 L8 -10 M8 -2 L13 -8"
                stroke="#3a2614"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <ellipse cx="13" cy="-1" rx="2" ry="1.2" fill="#3a2614" />
            </g>
            <path
              d="M0 -64 L0 -82"
              stroke="#3a2614"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          <div className="mt-1 max-w-45 truncate rounded-(--radius-2) border border-(--gray-5) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-12) text-[12px] shadow-sm">
            Hedgehouse
          </div>
        </motion.button>
      </Tooltip>
    </div>
  );
}
