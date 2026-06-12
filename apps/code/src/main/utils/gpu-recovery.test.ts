import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for electron-store, keyed by store name so each
// construction sees the same backing data within a test.
const backing = new Map<string, Record<string, unknown>>();

vi.mock("electron-store", () => ({
  default: class {
    private name: string;
    private defaults: Record<string, unknown>;
    constructor(opts: { name: string; defaults?: Record<string, unknown> }) {
      this.name = opts.name;
      this.defaults = opts.defaults ?? {};
      if (!backing.has(this.name)) backing.set(this.name, { ...this.defaults });
    }
    get(key: string, fallback?: unknown) {
      const data = backing.get(this.name) ?? {};
      return key in data ? data[key] : fallback;
    }
    set(key: string, value: unknown) {
      const data = backing.get(this.name) ?? {};
      data[key] = value;
      backing.set(this.name, data);
    }
  },
}));

vi.mock("./env", () => ({
  getUserDataDir: () => "/tmp/posthog-code-test",
}));

import {
  isHardwareAccelerationDisabled,
  persistDisableHardwareAcceleration,
} from "./gpu-recovery";

describe("gpu-recovery", () => {
  beforeEach(() => {
    backing.clear();
  });

  it("defaults to hardware acceleration enabled", () => {
    expect(isHardwareAccelerationDisabled()).toBe(false);
  });

  it("persists the software-rendering fallback across store instances", () => {
    persistDisableHardwareAcceleration();
    expect(isHardwareAccelerationDisabled()).toBe(true);
  });
});
