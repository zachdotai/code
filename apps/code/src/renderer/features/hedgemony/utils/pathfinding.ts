export type Vec2 = { x: number; y: number };
export type Obstacle = { x: number; y: number; radius: number };

const BUILDER_RADIUS = 36;
const CELL = 32;
const MARGIN = 256;
const EPS = 0.5;
const SQRT2 = Math.SQRT2;
const OCTILE_DIAG_COST = SQRT2 - 1;
const SNAP_MAX_ITERATIONS = 8;

type InflatedObstacle = { x: number; y: number; r2: number; radius: number };

function inflate(obstacles: Obstacle[]): InflatedObstacle[] {
  return obstacles.map((o) => {
    const radius = o.radius + BUILDER_RADIUS;
    return { x: o.x, y: o.y, radius, r2: radius * radius };
  });
}

function pointBlocked(p: Vec2, infl: InflatedObstacle[]): boolean {
  for (const o of infl) {
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    if (dx * dx + dy * dy < o.r2) return true;
  }
  return false;
}

function segmentClear(a: Vec2, b: Vec2, infl: InflatedObstacle[]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segLenSq = dx * dx + dy * dy;
  for (const o of infl) {
    if (segLenSq === 0) {
      const cx = o.x - a.x;
      const cy = o.y - a.y;
      if (cx * cx + cy * cy < o.r2) return false;
      continue;
    }
    let t = ((o.x - a.x) * dx + (o.y - a.y) * dy) / segLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = a.x + t * dx - o.x;
    const py = a.y + t * dy - o.y;
    if (px * px + py * py < o.r2) return false;
  }
  return true;
}

function pushOutOf(p: Vec2, infl: InflatedObstacle[]): Vec2 {
  let current = p;
  for (let i = 0; i < SNAP_MAX_ITERATIONS; i++) {
    let pushed = false;
    for (const o of infl) {
      const dx = current.x - o.x;
      const dy = current.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < o.r2) {
        const d = Math.sqrt(d2);
        if (d === 0) {
          current = { x: o.x + o.radius + EPS, y: o.y };
        } else {
          const t = o.radius + EPS;
          current = { x: o.x + (dx / d) * t, y: o.y + (dy / d) * t };
        }
        pushed = true;
      }
    }
    if (!pushed) return current;
  }
  return current;
}

function nearestFreePointOnLine(
  from: Vec2,
  to: Vec2,
  infl: InflatedObstacle[],
): Vec2 {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return pointBlocked(from, infl) ? from : from;
  const steps = Math.max(1, Math.ceil(dist / (CELL / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const candidate = {
      x: to.x + dx * t,
      y: to.y + dy * t,
    };
    if (!pointBlocked(candidate, infl)) return candidate;
  }
  return from;
}

type HeapEntry = { col: number; row: number; f: number };

class MinHeap {
  private readonly data: HeapEntry[] = [];

  size(): number {
    return this.data.length;
  }

  push(entry: HeapEntry): void {
    this.data.push(entry);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapEntry | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (last !== undefined && this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.data[index].f < this.data[parent].f) {
        [this.data[index], this.data[parent]] = [
          this.data[parent],
          this.data[index],
        ];
        index = parent;
      } else {
        return;
      }
    }
  }

  private sinkDown(index: number): void {
    const n = this.data.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < n && this.data[left].f < this.data[smallest].f)
        smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f)
        smallest = right;
      if (smallest === index) return;
      [this.data[index], this.data[smallest]] = [
        this.data[smallest],
        this.data[index],
      ];
      index = smallest;
    }
  }
}

function octileHeuristic(dCol: number, dRow: number): number {
  const ax = Math.abs(dCol);
  const ay = Math.abs(dRow);
  return Math.max(ax, ay) + OCTILE_DIAG_COST * Math.min(ax, ay);
}

function stringPull(path: Vec2[], infl: InflatedObstacle[]): Vec2[] {
  if (path.length <= 2) return path;
  const result: Vec2[] = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !segmentClear(path[i], path[j], infl)) {
      j--;
    }
    result.push(path[j]);
    i = j;
  }
  return result;
}

export function findPath(from: Vec2, to: Vec2, obstacles: Obstacle[]): Vec2[] {
  const infl = inflate(obstacles);
  const goal = pushOutOf(to, infl);

  if (segmentClear(from, goal, infl)) {
    return [from, goal];
  }

  const minX = Math.min(from.x, goal.x) - MARGIN;
  const minY = Math.min(from.y, goal.y) - MARGIN;
  const maxX = Math.max(from.x, goal.x) + MARGIN;
  const maxY = Math.max(from.y, goal.y) + MARGIN;
  const cols = Math.max(2, Math.ceil((maxX - minX) / CELL) + 1);
  const rows = Math.max(2, Math.ceil((maxY - minY) / CELL) + 1);

  const cellCenter = (col: number, row: number): Vec2 => ({
    x: minX + col * CELL,
    y: minY + row * CELL,
  });

  const toGrid = (p: Vec2) => {
    let col = Math.round((p.x - minX) / CELL);
    let row = Math.round((p.y - minY) / CELL);
    if (col < 0) col = 0;
    else if (col >= cols) col = cols - 1;
    if (row < 0) row = 0;
    else if (row >= rows) row = rows - 1;
    return { col, row };
  };

  const start = toGrid(from);
  const target = toGrid(goal);

  const blockedCache = new Map<number, boolean>();
  const isBlocked = (col: number, row: number): boolean => {
    const key = row * cols + col;
    const cached = blockedCache.get(key);
    if (cached !== undefined) return cached;
    const blocked = pointBlocked(cellCenter(col, row), infl);
    blockedCache.set(key, blocked);
    return blocked;
  };

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  const startKey = start.row * cols + start.col;
  const targetKey = target.row * cols + target.col;

  gScore.set(startKey, 0);
  open.push({
    col: start.col,
    row: start.row,
    f: octileHeuristic(target.col - start.col, target.row - start.row),
  });

  const NEIGHBORS = [
    { dc: 1, dr: 0, cost: 1, diag: false },
    { dc: -1, dr: 0, cost: 1, diag: false },
    { dc: 0, dr: 1, cost: 1, diag: false },
    { dc: 0, dr: -1, cost: 1, diag: false },
    { dc: 1, dr: 1, cost: SQRT2, diag: true },
    { dc: 1, dr: -1, cost: SQRT2, diag: true },
    { dc: -1, dr: 1, cost: SQRT2, diag: true },
    { dc: -1, dr: -1, cost: SQRT2, diag: true },
  ];

  let found = false;
  while (open.size() > 0) {
    const current = open.pop();
    if (!current) break;
    const currentKey = current.row * cols + current.col;
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    if (currentKey === targetKey) {
      found = true;
      break;
    }
    const currentG = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;
    for (const n of NEIGHBORS) {
      const nc = current.col + n.dc;
      const nr = current.row + n.dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const neighborKey = nr * cols + nc;
      if (closed.has(neighborKey)) continue;
      const isStart = neighborKey === startKey;
      const isTarget = neighborKey === targetKey;
      if (!isStart && !isTarget && isBlocked(nc, nr)) continue;
      if (n.diag) {
        const sideA = current.row * cols + (current.col + n.dc);
        const sideB = (current.row + n.dr) * cols + current.col;
        if (
          (sideA !== startKey &&
            sideA !== targetKey &&
            isBlocked(current.col + n.dc, current.row)) ||
          (sideB !== startKey &&
            sideB !== targetKey &&
            isBlocked(current.col, current.row + n.dr))
        ) {
          continue;
        }
      }
      const tentativeG = currentG + n.cost;
      const prevG = gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY;
      if (tentativeG < prevG) {
        gScore.set(neighborKey, tentativeG);
        cameFrom.set(neighborKey, currentKey);
        const h = octileHeuristic(target.col - nc, target.row - nr);
        open.push({ col: nc, row: nr, f: tentativeG + h });
      }
    }
  }

  if (!found) {
    return [nearestFreePointOnLine(from, goal, infl)];
  }

  const gridPath: Vec2[] = [];
  let cursorKey: number | undefined = targetKey;
  while (cursorKey !== undefined) {
    const col = cursorKey % cols;
    const row = (cursorKey - col) / cols;
    gridPath.push(cellCenter(col, row));
    cursorKey = cameFrom.get(cursorKey);
  }
  gridPath.reverse();

  if (gridPath.length === 0) {
    return [nearestFreePointOnLine(from, goal, infl)];
  }

  gridPath[0] = from;
  gridPath[gridPath.length - 1] = goal;

  return stringPull(gridPath, infl);
}
