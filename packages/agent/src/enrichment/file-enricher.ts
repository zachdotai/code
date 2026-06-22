import * as path from "node:path";
import {
  type EnricherApiConfig,
  EXT_TO_LANG_ID,
  formatApmInlineComments,
  type ImportEdge,
  type LocalWrapper,
  type ParseContext,
  PostHogApi,
  PostHogEnricher,
} from "@posthog/enricher";
import {
  APM_STATS_WINDOW,
  apmLangForFile,
  type SpanLineStat,
} from "@posthog/shared";
import type { PostHogAPIConfig } from "../types";
import type { Logger } from "../utils/logger";

interface ApmStatsCacheEntry {
  expiresAt: number;
  stats: SpanLineStat[];
}

export interface FileEnrichmentDeps {
  enricher: PostHogEnricher;
  apiConfig: PostHogAPIConfig;
  logger?: Logger;
  // Path-keyed, best-effort: stats carry production line numbers, so within the
  // TTL an edit can shift a comment off its line (we don't re-map).
  apmStatsCache: Map<string, ApmStatsCacheEntry>;
  fetchApmLineStats: (
    config: EnricherApiConfig,
    filePath: string,
  ) => Promise<SpanLineStat[]>;
}

export interface Enrichment {
  deps: FileEnrichmentDeps;
  dispose(): void;
}

export function createEnrichment(
  apiConfig: PostHogAPIConfig | undefined,
  logger?: Logger,
): Enrichment | undefined {
  if (!apiConfig) return undefined;
  const enricher = new PostHogEnricher();
  const apmStatsCache = new Map<string, ApmStatsCacheEntry>();
  return {
    deps: {
      enricher,
      apiConfig,
      logger,
      apmStatsCache,
      fetchApmLineStats: (config, filePath) =>
        new PostHogApi(config).getApmLineStats(filePath, {
          dateFrom: APM_STATS_WINDOW.dateFrom,
        }),
    },
    dispose: () => {
      enricher.dispose();
      apmStatsCache.clear();
    },
  };
}

const MAX_ENRICHMENT_BYTES = 1_000_000;
const APM_STATS_TTL_MS = 5 * 60_000;
// 24h query is ~8s on the hottest traced file; a lower budget silently drops it.
const APM_QUERY_TIMEOUT_MS = 15_000;
const MAX_RELATIVE_IMPORTS = 64;
const RELATIVE_IMPORT_REGEX =
  /(?:^|\n)\s*(?:import\b[^\n]*['"]\.{1,2}\/|from\s+\.)/;
const POSTHOG_LITERAL_REGEX = /posthog/i;

export async function enrichFileForAgent(
  deps: FileEnrichmentDeps,
  filePath: string,
  content: string,
): Promise<string | null> {
  if (!content || content.length > MAX_ENRICHMENT_BYTES) return null;

  // Resolve the API key once per read; the event and APM paths run in parallel
  // and would otherwise race two token refreshes on a dual-enrichable file.
  let apiKeyPromise: Promise<string> | undefined;
  const getApiKey: ApiKeyGetter = () => {
    apiKeyPromise ??= Promise.resolve(deps.apiConfig.getApiKey());
    return apiKeyPromise;
  };

  const apmLang = apmLangForFile(filePath);
  const [eventAnnotated, apmStats] = await Promise.all([
    enrichEventsForAgent(deps, filePath, content, getApiKey),
    apmLang
      ? getApmLineStats(deps, filePath, getApiKey)
      : Promise.resolve(null),
  ]);

  if (apmLang) {
    deps.logger?.debug("[apm] agent enrich", {
      filePath,
      lines: apmStats?.length ?? null,
    });
  }

  let result = eventAnnotated ?? content;
  if (apmLang && apmStats && apmStats.length > 0) {
    try {
      result = formatApmInlineComments(result, apmLang, apmStats, filePath);
    } catch (err) {
      // A formatter edge case must degrade to the event-annotated content, not
      // reject the whole read (result is unchanged on throw).
      deps.logger?.debug("APM comment formatting failed", {
        filePath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result === content ? null : result;
}

type ApiKeyGetter = () => Promise<string>;

async function resolveEnricherConfig(
  deps: FileEnrichmentDeps,
  timeoutMs: number,
  getApiKey: ApiKeyGetter,
): Promise<EnricherApiConfig | null> {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  return {
    apiKey,
    host: deps.apiConfig.apiUrl,
    projectId: deps.apiConfig.projectId,
    timeoutMs,
  };
}

async function getApmLineStats(
  deps: FileEnrichmentDeps,
  filePath: string,
  getApiKey: ApiKeyGetter,
): Promise<SpanLineStat[] | null> {
  const cached = deps.apmStatsCache.get(filePath);
  if (cached && cached.expiresAt > Date.now()) return cached.stats;

  try {
    const config = await resolveEnricherConfig(
      deps,
      APM_QUERY_TIMEOUT_MS,
      getApiKey,
    );
    if (!config) return null;

    const stats = await deps.fetchApmLineStats(config, filePath);
    deps.apmStatsCache.set(filePath, {
      stats,
      expiresAt: Date.now() + APM_STATS_TTL_MS,
    });
    return stats;
  } catch (err) {
    deps.logger?.debug("APM enrichment failed", {
      filePath,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function enrichEventsForAgent(
  deps: FileEnrichmentDeps,
  filePath: string,
  content: string,
  getApiKey: ApiKeyGetter,
): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  const langId = EXT_TO_LANG_ID[ext];
  if (!langId || !deps.enricher.isSupported(langId)) return null;

  const hasPostHogLiteral = POSTHOG_LITERAL_REGEX.test(content);
  const hasRelativeImport = RELATIVE_IMPORT_REGEX.test(content);
  let parseContext: ParseContext | undefined;

  if (hasRelativeImport) {
    const absPath = path.resolve(filePath);
    const ctx = await buildWrapperContext(deps, content, langId, absPath);
    if (ctx) parseContext = ctx;
  }

  if (!hasPostHogLiteral && !parseContext) return null;

  try {
    const parsed = await deps.enricher.parse(content, langId, parseContext);
    if (parsed.calls.length === 0 && parsed.initCalls.length === 0) {
      return null;
    }

    const config = await resolveEnricherConfig(deps, 5_000, getApiKey);
    if (!config) return null;

    const enriched = await parsed.enrichFromApi(config);

    const annotated = enriched.toInlineComments();
    if (annotated === content) {
      deps.logger?.debug("File enrichment produced no changes", {
        filePath,
        calls: parsed.calls.length,
      });
      return null;
    }
    deps.logger?.debug("File enriched", {
      filePath,
      calls: parsed.calls.length,
      viaWrappers: parsed.calls.filter((c) => c.viaWrapper).length,
    });
    return annotated;
  } catch (err) {
    const detail =
      err instanceof Error
        ? { message: err.message, name: err.name, stack: err.stack }
        : { value: String(err) };
    deps.logger?.debug("File enrichment failed", { filePath, ...detail });
    return null;
  }
}

async function buildWrapperContext(
  deps: FileEnrichmentDeps,
  content: string,
  langId: string,
  absPath: string,
): Promise<ParseContext | null> {
  let edges: ImportEdge[];
  try {
    edges = await deps.enricher.findImportsInSource(content, langId, absPath);
  } catch (err) {
    deps.logger?.debug("Import resolution failed", {
      absPath,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!edges.length) return null;
  const bounded = edges.slice(0, MAX_RELATIVE_IMPORTS);

  const wrappersByLocalName = new Map<string, LocalWrapper>();
  const namespaceWrappers = new Map<string, Map<string, LocalWrapper>>();

  const resolutions = await Promise.all(
    bounded.map(async (edge) => {
      if (!edge.resolvedAbsPath) return null;
      try {
        const wrappers = await deps.enricher.getWrappersForFile(
          edge.resolvedAbsPath,
        );
        if (!wrappers.length) return null;
        return { edge, wrappers };
      } catch {
        // A failed import resolution must not reject the whole read.
        return null;
      }
    }),
  );

  for (const entry of resolutions) {
    if (!entry) continue;
    const { edge, wrappers } = entry;

    if (edge.isNamespace) {
      const nsMap = new Map<string, LocalWrapper>();
      for (const w of wrappers) {
        if (w.isNamedExport || w.isDefaultExport) {
          nsMap.set(w.name, w);
        }
      }
      if (nsMap.size) namespaceWrappers.set(edge.localName, nsMap);
      continue;
    }

    if (edge.isDefault) {
      const target = wrappers.find((w) => w.isDefaultExport);
      if (target) wrappersByLocalName.set(edge.localName, target);
      continue;
    }

    const target = wrappers.find(
      (w) => w.name === edge.importedName && w.isNamedExport,
    );
    if (target) wrappersByLocalName.set(edge.localName, target);
  }

  if (!wrappersByLocalName.size && !namespaceWrappers.size) return null;

  return { wrappersByLocalName, namespaceWrappers };
}
