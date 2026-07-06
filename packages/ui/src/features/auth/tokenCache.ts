/**
 * Renderer-side access-token cache: cloud API calls no longer pay an Electron
 * IPC round-trip per request. Tokens are short-cached with single-flight
 * fetch/refresh; any auth-state change drops the cache.
 */

interface RawTokenAccessors {
  getValidAccessToken(): Promise<string>;
  refreshAccessToken(): Promise<string>;
}

const TOKEN_TTL_MS = 60_000;

let cached: { token: string; fetchedAt: number } | null = null;
let inflightFetch: Promise<string> | null = null;
let inflightRefresh: Promise<string> | null = null;

export function clearTokenCache(): void {
  cached = null;
}

export function createCachedTokenAccessors(
  raw: RawTokenAccessors,
): RawTokenAccessors {
  return {
    async getValidAccessToken(): Promise<string> {
      if (cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS) {
        return cached.token;
      }
      if (!inflightFetch) {
        inflightFetch = raw
          .getValidAccessToken()
          .then((token) => {
            cached = { token, fetchedAt: Date.now() };
            return token;
          })
          .finally(() => {
            inflightFetch = null;
          });
      }
      return inflightFetch;
    },

    async refreshAccessToken(): Promise<string> {
      // Single-flight: N concurrent 401s cause one refresh, not a storm.
      if (!inflightRefresh) {
        inflightRefresh = raw
          .refreshAccessToken()
          .then((token) => {
            cached = { token, fetchedAt: Date.now() };
            return token;
          })
          .finally(() => {
            inflightRefresh = null;
          });
      }
      return inflightRefresh;
    },
  };
}
