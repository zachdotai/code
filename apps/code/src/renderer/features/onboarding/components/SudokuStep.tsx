import { ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { Button, Flex, Text } from "@radix-ui/themes";
import detectiveHog from "@renderer/assets/images/hedgehogs/detective-hog.png";
import {
  cloneBoard,
  findConflicts,
  isBoardComplete,
  isBoardSolved,
  isGivenCell,
  PUZZLE,
  type SudokuBoard,
} from "@renderer/features/onboarding/sudoku";
import { useCallback, useMemo, useRef, useState } from "react";
import { OnboardingHogTip } from "./OnboardingHogTip";
import { StepActions } from "./StepActions";

interface SudokuStepProps {
  onSolved: () => void;
}

const CELL_SIZE = 44;

export function SudokuStep({ onSolved }: SudokuStepProps) {
  const [board, setBoard] = useState<SudokuBoard>(() => cloneBoard(PUZZLE));
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(
    null,
  );
  const [showInvalid, setShowInvalid] = useState(false);
  const cellRefs = useRef<Array<Array<HTMLButtonElement | null>>>(
    Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null)),
  );

  const conflicts = useMemo(() => findConflicts(board), [board]);
  const complete = useMemo(() => isBoardComplete(board), [board]);
  const solved = useMemo(
    () => complete && isBoardSolved(board),
    [board, complete],
  );

  const focusCell = useCallback((r: number, c: number) => {
    const target = cellRefs.current[r]?.[c];
    if (target) target.focus();
    setSelected({ r, c });
  }, []);

  const setCellValue = useCallback(
    (r: number, c: number, value: number | null) => {
      if (isGivenCell(r, c)) return;
      setBoard((prev) => {
        const next = cloneBoard(prev);
        next[r][c] = value;
        return next;
      });
      setShowInvalid(false);
    },
    [],
  );

  const handleCellKeyDown = useCallback(
    (r: number, c: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        setCellValue(r, c, Number.parseInt(e.key, 10));
        return;
      }
      if (
        e.key === "Backspace" ||
        e.key === "Delete" ||
        e.key === "0" ||
        e.key === " "
      ) {
        e.preventDefault();
        setCellValue(r, c, null);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        focusCell((r + 8) % 9, c);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusCell((r + 1) % 9, c);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        focusCell(r, (c + 8) % 9);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        focusCell(r, (c + 1) % 9);
        return;
      }
    },
    [focusCell, setCellValue],
  );

  const handleVerify = useCallback(() => {
    if (solved) {
      onSolved();
    } else {
      setShowInvalid(true);
    }
  }, [solved, onSolved]);

  const selectedValue = selected != null ? board[selected.r][selected.c] : null;

  return (
    <Flex align="center" justify="center" height="100%" px="8">
      <Flex
        direction="column"
        align="center"
        className="h-full w-full pt-[24px] pb-[40px]"
      >
        <Flex
          direction="column"
          align="center"
          className="min-h-0 w-full flex-1 overflow-y-auto"
        >
          <Flex
            direction="column"
            align="center"
            style={{ margin: "auto 0" }}
            className="w-full max-w-[560px] gap-[20px]"
          >
            <Flex direction="column" align="center" gap="1">
              <Text className="font-bold text-(--gray-12) text-2xl">
                A small test of resolve
              </Text>
              <Text className="text-(--gray-11) text-sm">
                Solve this hard sudoku to continue. There is no skip.
              </Text>
            </Flex>

            <div
              className="rounded-(--radius-3) border-(--gray-12) border-2 bg-(--gray-1) p-[6px]"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(9, ${CELL_SIZE}px)`,
                gridTemplateRows: `repeat(9, ${CELL_SIZE}px)`,
              }}
            >
              {board.map((row, r) =>
                row.map((value, c) => {
                  const given = isGivenCell(r, c);
                  const isConflict = conflicts[r][c];
                  const isSelected =
                    selected != null && selected.r === r && selected.c === c;
                  const isPeer =
                    selected != null &&
                    !isSelected &&
                    (selected.r === r ||
                      selected.c === c ||
                      (Math.floor(selected.r / 3) === Math.floor(r / 3) &&
                        Math.floor(selected.c / 3) === Math.floor(c / 3)));
                  const sameValue =
                    selected != null &&
                    !isSelected &&
                    value != null &&
                    selectedValue != null &&
                    value === selectedValue;

                  const borderTop = r % 3 === 0 ? "2px" : "1px";
                  const borderLeft = c % 3 === 0 ? "2px" : "1px";
                  const borderRight = c === 8 ? "2px" : "0";
                  const borderBottom = r === 8 ? "2px" : "0";

                  let background = "var(--gray-1)";
                  if (isConflict) background = "var(--red-a3)";
                  else if (isSelected) background = "var(--accent-a4)";
                  else if (sameValue) background = "var(--accent-a3)";
                  else if (isPeer) background = "var(--gray-3)";

                  const color = given
                    ? "var(--gray-12)"
                    : isConflict
                      ? "var(--red-11)"
                      : "var(--accent-11)";

                  const cellKey = `${r}-${c}`;
                  return (
                    <button
                      key={cellKey}
                      type="button"
                      ref={(el) => {
                        cellRefs.current[r][c] = el;
                      }}
                      onClick={() => focusCell(r, c)}
                      onFocus={() => setSelected({ r, c })}
                      onKeyDown={(e) => handleCellKeyDown(r, c, e)}
                      aria-label={`Row ${r + 1} column ${c + 1}${
                        value != null ? `, ${value}` : ", empty"
                      }${given ? ", given" : ""}`}
                      style={{
                        background,
                        color,
                        borderTopWidth: borderTop,
                        borderLeftWidth: borderLeft,
                        borderRightWidth: borderRight,
                        borderBottomWidth: borderBottom,
                        borderStyle: "solid",
                        borderColor: "var(--gray-8)",
                        fontWeight: given ? 700 : 500,
                        cursor: given ? "default" : "pointer",
                      }}
                      className="flex items-center justify-center font-mono text-[20px] outline-none focus:z-10 focus:ring-(--accent-9) focus:ring-2"
                    >
                      {value ?? ""}
                    </button>
                  );
                }),
              )}
            </div>

            <Flex direction="row" gap="2" wrap="wrap" justify="center">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <Button
                  key={digit}
                  type="button"
                  size="2"
                  variant="soft"
                  color="gray"
                  onClick={() => {
                    if (selected == null) return;
                    setCellValue(selected.r, selected.c, digit);
                  }}
                  disabled={
                    selected == null || isGivenCell(selected.r, selected.c)
                  }
                  className="w-[36px]"
                >
                  {digit}
                </Button>
              ))}
              <Button
                type="button"
                size="2"
                variant="soft"
                color="gray"
                onClick={() => {
                  if (selected == null) return;
                  setCellValue(selected.r, selected.c, null);
                }}
                disabled={
                  selected == null || isGivenCell(selected.r, selected.c)
                }
              >
                Clear
              </Button>
            </Flex>

            <OnboardingHogTip
              hogSrc={detectiveHog}
              message={
                solved
                  ? "Impressive. The path forward is yours."
                  : showInvalid
                    ? "Not quite right. Check rows, columns, and 3x3 boxes."
                    : "Click a cell, then type 1-9. Arrow keys to move."
              }
            />
          </Flex>
        </Flex>

        <StepActions>
          <Button
            size="3"
            onClick={handleVerify}
            disabled={!complete}
            color={solved ? "green" : undefined}
          >
            {solved ? (
              <>
                <CheckCircle size={16} weight="bold" />
                Continue
              </>
            ) : (
              <>
                Verify
                <ArrowRight size={16} weight="bold" />
              </>
            )}
          </Button>
        </StepActions>
      </Flex>
    </Flex>
  );
}
