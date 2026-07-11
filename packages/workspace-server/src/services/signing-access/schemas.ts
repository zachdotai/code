import { z } from "zod";

export const signingAccessStatusSchema = z.object({
  supported: z.boolean(),
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
  error: z.string().nullable(),
});

export const setSigningAccessEnabledInput = z.object({
  enabled: z.boolean(),
});
