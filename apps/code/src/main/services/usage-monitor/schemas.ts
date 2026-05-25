import { z } from "zod";

export const USAGE_THRESHOLDS = [50, 75, 90, 100] as const;
export type UsageThreshold = (typeof USAGE_THRESHOLDS)[number];

export const thresholdCrossedEvent = z.object({
  bucket: z.enum(["burst", "sustained"]),
  threshold: z.union([
    z.literal(50),
    z.literal(75),
    z.literal(90),
    z.literal(100),
  ]),
  usedPercent: z.number(),
  resetAt: z.string().datetime().nullable(),
  resetsInSeconds: z.number(),
  isPro: z.boolean(),
});

export type ThresholdCrossedEvent = z.infer<typeof thresholdCrossedEvent>;

export const UsageMonitorEvent = {
  ThresholdCrossed: "threshold-crossed",
} as const;

export interface UsageMonitorEvents {
  [UsageMonitorEvent.ThresholdCrossed]: ThresholdCrossedEvent;
}
