import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, createCachedTokenAccessors } from "./tokenCache";

describe("createCachedTokenAccessors", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  it("fetches once and serves from cache within the TTL", async () => {
    const fetchToken = vi.fn().mockResolvedValue("tok-1");
    const accessors = createCachedTokenAccessors({
      getValidAccessToken: fetchToken,
      refreshAccessToken: vi.fn(),
    });

    expect(await accessors.getValidAccessToken()).toBe("tok-1");
    expect(await accessors.getValidAccessToken()).toBe("tok-1");
    expect(await accessors.getValidAccessToken()).toBe("tok-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent fetches", async () => {
    let resolve: (v: string) => void = () => {};
    const fetchToken = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const accessors = createCachedTokenAccessors({
      getValidAccessToken: fetchToken,
      refreshAccessToken: vi.fn(),
    });

    const a = accessors.getValidAccessToken();
    const b = accessors.getValidAccessToken();
    resolve("tok-1");

    expect(await a).toBe("tok-1");
    expect(await b).toBe("tok-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent refreshes and updates the cache", async () => {
    const refresh = vi.fn().mockResolvedValue("tok-2");
    const fetchToken = vi.fn().mockResolvedValue("tok-1");
    const accessors = createCachedTokenAccessors({
      getValidAccessToken: fetchToken,
      refreshAccessToken: refresh,
    });

    const [a, b] = await Promise.all([
      accessors.refreshAccessToken(),
      accessors.refreshAccessToken(),
    ]);
    expect(a).toBe("tok-2");
    expect(b).toBe("tok-2");
    expect(refresh).toHaveBeenCalledTimes(1);

    // Refreshed token is served from cache without another IPC fetch.
    expect(await accessors.getValidAccessToken()).toBe("tok-2");
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("clearTokenCache forces a re-fetch", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce("tok-1")
      .mockResolvedValueOnce("tok-2");
    const accessors = createCachedTokenAccessors({
      getValidAccessToken: fetchToken,
      refreshAccessToken: vi.fn(),
    });

    expect(await accessors.getValidAccessToken()).toBe("tok-1");
    clearTokenCache();
    expect(await accessors.getValidAccessToken()).toBe("tok-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});
