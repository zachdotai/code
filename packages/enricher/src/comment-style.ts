// Shared by the enricher's inline-comment formatters (event/flag + APM) so the
// `#`-vs-`//` rule lives in one place.

const HASH_COMMENT_LANGS = new Set(["python", "ruby"]);

export function commentPrefix(languageId: string): string {
  return HASH_COMMENT_LANGS.has(languageId) ? "#" : "//";
}
