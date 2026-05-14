import { describe, expect, it } from "vitest";
import type { TaskStatus } from "../components/hogletStatus";
import { selectHogletAnimation } from "./selectHogletAnimation";

const NON_NULL_STATUSES: NonNullable<TaskStatus>[] = [
  "not_started",
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
];

describe("selectHogletAnimation", () => {
  describe("non-robo, not walking", () => {
    it("returns idle for not_started", () => {
      expect(selectHogletAnimation("not_started", false, false)).toBe("idle");
    });
    it("returns idle for queued", () => {
      expect(selectHogletAnimation("queued", false, false)).toBe("idle");
    });
    it("returns action for in_progress", () => {
      expect(selectHogletAnimation("in_progress", false, false)).toBe("action");
    });
    it("returns wave for completed", () => {
      expect(selectHogletAnimation("completed", false, false)).toBe("wave");
    });
    it("returns fall for failed", () => {
      expect(selectHogletAnimation("failed", false, false)).toBe("fall");
    });
    it("returns idle for cancelled", () => {
      expect(selectHogletAnimation("cancelled", false, false)).toBe("idle");
    });
  });

  describe("robo, not walking", () => {
    it("returns idleRobo for not_started", () => {
      expect(selectHogletAnimation("not_started", false, true)).toBe(
        "idleRobo",
      );
    });
    it("returns idleRobo for queued", () => {
      expect(selectHogletAnimation("queued", false, true)).toBe("idleRobo");
    });
    it("returns walkRobo for in_progress", () => {
      expect(selectHogletAnimation("in_progress", false, true)).toBe(
        "walkRobo",
      );
    });
    it("returns waveRobo for completed", () => {
      expect(selectHogletAnimation("completed", false, true)).toBe("waveRobo");
    });
    it("returns fallRobo for failed", () => {
      expect(selectHogletAnimation("failed", false, true)).toBe("fallRobo");
    });
    it("returns idleRobo for cancelled", () => {
      expect(selectHogletAnimation("cancelled", false, true)).toBe("idleRobo");
    });
  });

  describe("walking overrides status", () => {
    it.each(NON_NULL_STATUSES)(
      "returns walk for %s when walking, non-robo",
      (status) => {
        expect(selectHogletAnimation(status, true, false)).toBe("walk");
      },
    );
    it.each(NON_NULL_STATUSES)(
      "returns walkRobo for %s when walking, robo",
      (status) => {
        expect(selectHogletAnimation(status, true, true)).toBe("walkRobo");
      },
    );
  });

  describe("null/undefined status falls back to not_started", () => {
    it("null status, non-robo, not walking", () => {
      expect(selectHogletAnimation(null, false, false)).toBe("idle");
    });
    it("null status, robo, not walking", () => {
      expect(selectHogletAnimation(null, false, true)).toBe("idleRobo");
    });
    it("undefined status, non-robo, not walking", () => {
      expect(selectHogletAnimation(undefined, false, false)).toBe("idle");
    });
    it("undefined status, robo, not walking", () => {
      expect(selectHogletAnimation(undefined, false, true)).toBe("idleRobo");
    });
    it("null status, non-robo, walking", () => {
      expect(selectHogletAnimation(null, true, false)).toBe("walk");
    });
    it("null status, robo, walking", () => {
      expect(selectHogletAnimation(null, true, true)).toBe("walkRobo");
    });
  });
});
