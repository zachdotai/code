import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IStoragePaths } from "@posthog/platform/storage-paths";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { DashboardQuery } from "../dashboard-query/schemas";
import type { DashboardQueryService } from "../dashboard-query/service";
import {
  type DashboardRecord,
  type DashboardSummary,
  dashboardRecordSchema,
} from "./schemas";

const log = logger.scope("dashboards");

// File-backed dashboard store (MVP): each dashboard is a JSON file holding a
// json-render spec under <appData>/dashboards/<id>.json.
@injectable()
export class DashboardsService {
  constructor(
    @inject(MAIN_TOKENS.StoragePaths)
    private readonly storagePaths: IStoragePaths,
    @inject(MAIN_TOKENS.DashboardQueryService)
    private readonly dashboardQuery: DashboardQueryService,
  ) {}

  private get dir(): string {
    return join(this.storagePaths.appDataPath, "dashboards");
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(channelId: string): Promise<DashboardSummary[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir);
    const records: DashboardRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const record = await this.readFileRecord(join(this.dir, entry));
      if (record && record.channelId === channelId) records.push(record);
    }
    return records
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, channelId: cid, name, updatedAt }) => ({
        id,
        channelId: cid,
        name,
        updatedAt,
      }));
  }

  async get(id: string): Promise<DashboardRecord | null> {
    return this.readFileRecord(this.filePath(id));
  }

  // One-time backfill: assign any channel-less dashboard (saved before channel
  // scoping) to the given default channel. Idempotent — returns how many were
  // adopted, 0 once none remain.
  async adoptOrphans(channelId: string): Promise<number> {
    await this.ensureDir();
    const entries = await readdir(this.dir);
    let adopted = 0;
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const record = await this.readFileRecord(join(this.dir, entry));
      if (record && !record.channelId) {
        await this.write({ ...record, channelId, updatedAt: Date.now() });
        adopted++;
      }
    }
    return adopted;
  }

  async create(input: {
    channelId: string;
    name: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord> {
    const now = Date.now();
    const record: DashboardRecord = {
      id: randomUUID(),
      channelId: input.channelId,
      name: input.name,
      spec: input.spec,
      createdAt: now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  async update(input: {
    id: string;
    name?: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord> {
    const existing = await this.get(input.id);
    const now = Date.now();
    const record: DashboardRecord = {
      id: input.id,
      // Preserve channel ownership; only spec/name change on update.
      channelId: existing?.channelId ?? "",
      name: input.name ?? existing?.name ?? "Untitled dashboard",
      spec: input.spec,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.filePath(id));
    } catch (err) {
      // Already gone is a successful delete; surface anything else.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // Re-run the HogQL queries stored at spec.state.queries and write the fresh
  // values back into the spec props. `elementKeys` (a card's element) limits the
  // refresh to that card's subtree. Failures keep their prior literal.
  async refresh(input: {
    id: string;
    elementKeys?: string[];
    touchUpdatedAt?: boolean;
  }): Promise<{
    updated: number;
    failures: { elementKey: string; error: string }[];
  }> {
    const record = await this.get(input.id);
    if (!record || !record.spec) return { updated: 0, failures: [] };

    const spec = record.spec;
    const queries = collectQueries(spec, input.elementKeys);
    if (queries.length === 0) return { updated: 0, failures: [] };

    const results = await this.dashboardQuery.run({ queries });

    let nextSpec = spec;
    let updated = 0;
    const failures: { elementKey: string; error: string }[] = [];
    for (const r of results) {
      if (r.ok) {
        const patched = patchProp(nextSpec, r.elementKey, r.propPath, r.value);
        if (patched !== nextSpec) {
          nextSpec = patched;
          updated++;
        }
      } else {
        failures.push({ elementKey: r.elementKey, error: r.error });
      }
    }

    if (updated > 0) {
      await this.write({
        ...record,
        spec: nextSpec,
        updatedAt:
          input.touchUpdatedAt === false ? record.updatedAt : Date.now(),
      });
    }
    return { updated, failures };
  }

  private async write(record: DashboardRecord): Promise<void> {
    await this.ensureDir();
    await writeFile(this.filePath(record.id), JSON.stringify(record, null, 2));
  }

  private async readFileRecord(path: string): Promise<DashboardRecord | null> {
    try {
      const parsed = dashboardRecordSchema.safeParse(
        JSON.parse(await readFile(path, "utf8")),
      );
      return parsed.success ? parsed.data : null;
    } catch (err) {
      log.warn("Failed to read dashboard file", { path, err });
      return null;
    }
  }
}

type SpecElements = Record<string, { children?: string[]; props?: unknown }>;
type StoredQuery = { query?: unknown; column?: unknown };

// Collect refreshable queries from spec.state.queries, optionally limited to the
// subtree(s) of `elementKeys` and skipping queries whose element no longer exists.
function collectQueries(
  spec: Record<string, unknown>,
  elementKeys?: string[],
): DashboardQuery[] {
  const state = spec.state as Record<string, unknown> | undefined;
  const queriesMap = state?.queries as
    | Record<string, Record<string, StoredQuery>>
    | undefined;
  if (!queriesMap) return [];

  const elements = spec.elements as SpecElements | undefined;
  const allowed =
    elementKeys && elements ? descendantKeys(elements, elementKeys) : null;

  const out: DashboardQuery[] = [];
  for (const [elementKey, props] of Object.entries(queriesMap)) {
    if (allowed && !allowed.has(elementKey)) continue;
    if (elements && !elements[elementKey]) continue; // stale key
    for (const [propPath, stored] of Object.entries(props)) {
      if (stored && typeof stored.query === "string") {
        out.push({
          elementKey,
          propPath,
          query: stored.query,
          column: typeof stored.column === "string" ? stored.column : undefined,
        });
      }
    }
  }
  return out;
}

// Keys reachable from any of `roots` via `children` (inclusive of the roots).
function descendantKeys(elements: SpecElements, roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const key = stack.pop();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const children = elements[key]?.children;
    if (children) stack.push(...children);
  }
  return seen;
}

// Immutably set spec.elements[elementKey].props[<propPath>]; no-op (same ref)
// when the element is absent.
function patchProp(
  spec: Record<string, unknown>,
  elementKey: string,
  propPath: string,
  value: string | number,
): Record<string, unknown> {
  const elements = spec.elements as
    | Record<string, { props?: Record<string, unknown> }>
    | undefined;
  const el = elements?.[elementKey];
  if (!elements || !el) return spec;
  const propName = propPath.replace(/^\//, "");
  return {
    ...spec,
    elements: {
      ...elements,
      [elementKey]: {
        ...el,
        props: { ...(el.props ?? {}), [propName]: value },
      },
    },
  };
}
