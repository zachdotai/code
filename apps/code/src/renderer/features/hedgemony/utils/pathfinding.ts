export type Vec2 = { x: number; y: number };
export type Obstacle = { x: number; y: number; radius: number };

const DEFAULT_AGENT_RADIUS = 36;
const CELL = 32;
const MARGIN = 256;
const EPS = 0.5;
const SQRT2 = Math.SQRT2;
const OCTILE_DIAG_COST = SQRT2 - 1;
const SNAP_MAX_ITERATIONS = 8;

type InflatedObstacle = { x: number; y: number; r2: number; radius: number };

function inflate(
  obstacles: Obstacle[],
  agentRadius: number,
): InflatedObstacle[] {
  return obstacles.map((o) => {
    const radius = o.radius + agentRadius;
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

export function snapPointOutsideObstacles(
  point: Vec2,
  obstacles: Obstacle[],
  agentRadius: number = DEFAULT_AGENT_RADIUS,
): Vec2 {
  return pushOutOf(point, inflate(obstacles, agentRadius));
}

// Walks from `to` toward `from`, returning the first point that's outside
// every inflated obstacle. Used so a click that lands inside a building snaps
// to the perimeter on the side the builder is approaching from — instead of
// being shoved radially to a random direction.
function nearestFreePointOnLine(
  from: Vec2,
  to: Vec2,
  infl: InflatedObstacle[],
): Vec2 {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return pushOutOf(from, infl);
  const steps = Math.max(1, Math.ceil(dist / (CELL / 4)));
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

export function snapGoal(
  from: Vec2,
  to: Vec2,
  obstacles: Obstacle[],
  agentRadius: number = DEFAULT_AGENT_RADIUS,
): Vec2 {
  const infl = inflate(obstacles, agentRadius);
  if (!pointBlocked(to, infl)) return to;
  return nearestFreePointOnLine(from, to, infl);
}

// Pushes a point out of every inflated obstacle it's inside, iteratively, so
// the result sits on (or just outside) the nearest perimeter. Used by callers
// to self-heal a unit's "current position" before passing it to findPath:
// without this, a stale or HMR-preserved position inside an obstacle would
// flow into findPath, which prepends the blocked `from` as path[0] — making
// the sprite visibly snap to the inside-obstacle position before the escape
// segment plays.
export function clampOutsideObstacles(
  point: Vec2,
  obstacles: Obstacle[],
  agentRadius: number = DEFAULT_AGENT_RADIUS,
): Vec2 {
  const infl = inflate(obstacles, agentRadius);
  return pushOutOf(point, infl);
}

// Returns a nearby free perimeter point when a plan starts inside an
// inflated obstacle. This happens naturally with rapid re-orders: a sprite can
// be close enough to a unit/building that its center is inside the avoidance
// buffer even though the art does not visibly overlap. The escape must be a
// local push-out, not a walk toward the new goal, otherwise a target on the far
// side makes the first segment cut straight through the blocker before A* gets
// to route around it.
function firstFreePointTowards(
  from: Vec2,
  to: Vec2,
  infl: InflatedObstacle[],
): Vec2 | null {
  if (!pointBlocked(from, infl)) return from;

  const pushed = pushOutOf(from, infl);
  if (!pointBlocked(pushed, infl)) return pushed;

  // Last-resort radial sweep — used for pathological overlapping obstacle
  // clusters where iterative push-out still cannot find a free point. Start
  // near the goal direction for determinism, but keep the sweep local.
  const goalAngle = Math.atan2(to.y - from.y, to.x - from.x);
  for (let r = CELL; r < 4096; r += CELL) {
    for (let step = 0; step < 16; step++) {
      const theta = goalAngle + step * (Math.PI / 8);
      const c = {
        x: from.x + Math.cos(theta) * r,
        y: from.y + Math.sin(theta) * r,
      };
      if (!pointBlocked(c, infl)) return c;
    }
  }
  return null;
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

export function findPath(
  from: Vec2,
  to: Vec2,
  obstacles: Obstacle[],
  agentRadius: number = DEFAULT_AGENT_RADIUS,
): Vec2[] {
  const infl = inflate(obstacles, agentRadius);

  // If we start inside an obstacle, the A* grid neighbors of `from` will all
  // be blocked and the planner can't escape. Find a free perimeter point in
  // the direction of the goal, run A* from there, and prepend the original
  // `from` so the sprite walks out visually instead of teleporting.
  const escaped = pointBlocked(from, infl)
    ? firstFreePointTowards(from, to, infl)
    : null;
  const planFrom: Vec2 = escaped ?? from;

  const goal = pointBlocked(to, infl)
    ? nearestFreePointOnLine(planFrom, to, infl)
    : to;

  if (segmentClear(planFrom, goal, infl)) {
    return escaped ? [from, escaped, goal] : [planFrom, goal];
  }

  const minX = Math.min(planFrom.x, goal.x) - MARGIN;
  const minY = Math.min(planFrom.y, goal.y) - MARGIN;
  const maxX = Math.max(planFrom.x, goal.x) + MARGIN;
  const maxY = Math.max(planFrom.y, goal.y) + MARGIN;
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

  const start = toGrid(planFrom);
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
    const fallback = nearestFreePointOnLine(planFrom, goal, infl);
    return escaped ? [from, fallback] : [fallback];
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
    const fallback = nearestFreePointOnLine(planFrom, goal, infl);
    return escaped ? [from, fallback] : [fallback];
  }

  gridPath[0] = planFrom;
  gridPath[gridPath.length - 1] = goal;

  const pulled = stringPull(gridPath, infl);
  return escaped ? [from, ...pulled] : pulled;
}
