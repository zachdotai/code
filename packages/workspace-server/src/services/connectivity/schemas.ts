import { z } from "zod";

export const connectivityStatusOutput = z.object({
  isOnline: z.boolean(),
});

export type ConnectivityStatusOutput = z.infer<typeof connectivityStatusOutput>;
