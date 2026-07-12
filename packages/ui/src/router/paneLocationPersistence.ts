/**
 * Per-pane location persistence. Pane routers use in-memory history, so a full
 * reload (Cmd+R, HMR, renderer crash-restore) would otherwise lose every
 * pane's location. Each navigation writes `paneId → href` here; boot prefers
 * the persisted href over the pane's identity-derived one.
 *
 * sessionStorage on purpose: it survives reloads of this window but not an
 * app relaunch — across launches the durable tabs snapshot (each pane's
 * identity) is the source of truth, exactly like the old hash history
 * (production loads carried no hash).
 */
const KEY = "posthog.paneLocations";

function read(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function write(map: Record<string, string>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota/unavailable — location restore degrades to the identity href.
  }
}

export function readPaneLocation(paneId: string): string | null {
  return read()[paneId] ?? null;
}

export function writePaneLocation(paneId: string, href: string): void {
  const map = read();
  if (map[paneId] === href) return;
  map[paneId] = href;
  write(map);
}

export function removePaneLocation(paneId: string): void {
  const map = read();
  if (!(paneId in map)) return;
  delete map[paneId];
  write(map);
}
