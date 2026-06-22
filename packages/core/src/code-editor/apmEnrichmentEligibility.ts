import { apmLangForFile } from "@posthog/shared";

/**
 * Whether a file is eligible for APM line enrichment, decided purely by its
 * extension. Derives from {@link APM_LANG_BY_EXT} (in `@posthog/shared`) so the
 * editor and agent paths share one supported-language list.
 */
export function isApmEnrichmentEligible(filePath: string): boolean {
  return apmLangForFile(filePath) !== null;
}
