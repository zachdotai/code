export type SudokuCell = number | null;
export type SudokuBoard = SudokuCell[][];

// Arto Inkala's "hardest sudoku" (2012). 21 clues, unique solution.
const RAW_PUZZLE: ReadonlyArray<ReadonlyArray<number>> = [
  [8, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 3, 6, 0, 0, 0, 0, 0],
  [0, 7, 0, 0, 9, 0, 2, 0, 0],
  [0, 5, 0, 0, 0, 7, 0, 0, 0],
  [0, 0, 0, 0, 4, 5, 7, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 3, 0],
  [0, 0, 1, 0, 0, 0, 0, 6, 8],
  [0, 0, 8, 5, 0, 0, 0, 1, 0],
  [0, 9, 0, 0, 0, 0, 4, 0, 0],
];

export const PUZZLE: SudokuBoard = RAW_PUZZLE.map((row) =>
  row.map((cell) => (cell === 0 ? null : cell)),
);

export function isGivenCell(row: number, col: number): boolean {
  return RAW_PUZZLE[row][col] !== 0;
}

export function cloneBoard(board: SudokuBoard): SudokuBoard {
  return board.map((row) => row.slice());
}

function isUnitValid(values: SudokuCell[]): boolean {
  const seen = new Set<number>();
  for (const value of values) {
    if (value == null) return false;
    if (value < 1 || value > 9) return false;
    if (seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

export function isBoardComplete(board: SudokuBoard): boolean {
  return board.every((row) => row.every((cell) => cell != null));
}

export function isBoardSolved(board: SudokuBoard): boolean {
  for (let r = 0; r < 9; r++) {
    if (!isUnitValid(board[r])) return false;
  }
  for (let c = 0; c < 9; c++) {
    const col = board.map((row) => row[c]);
    if (!isUnitValid(col)) return false;
  }
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const box: SudokuCell[] = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          box.push(board[br * 3 + r][bc * 3 + c]);
        }
      }
      if (!isUnitValid(box)) return false;
    }
  }
  return true;
}

export function findConflicts(board: SudokuBoard): boolean[][] {
  const conflicts: boolean[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => false),
  );

  const markDuplicates = (cells: Array<{ r: number; c: number }>) => {
    const map = new Map<number, Array<{ r: number; c: number }>>();
    for (const { r, c } of cells) {
      const value = board[r][c];
      if (value == null) continue;
      const list = map.get(value);
      if (list) {
        list.push({ r, c });
      } else {
        map.set(value, [{ r, c }]);
      }
    }
    for (const list of map.values()) {
      if (list.length > 1) {
        for (const { r, c } of list) conflicts[r][c] = true;
      }
    }
  };

  for (let r = 0; r < 9; r++) {
    markDuplicates(Array.from({ length: 9 }, (_, c) => ({ r, c })));
  }
  for (let c = 0; c < 9; c++) {
    markDuplicates(Array.from({ length: 9 }, (_, r) => ({ r, c })));
  }
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const cells: Array<{ r: number; c: number }> = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells.push({ r: br * 3 + r, c: bc * 3 + c });
        }
      }
      markDuplicates(cells);
    }
  }

  return conflicts;
}
