import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import {
  getUseCodexSubscription,
  setUseCodexSubscription,
} from "../../services/settingsStore";
import { logger } from "../../utils/logger";
import { publicProcedure, router } from "../trpc";

const log = logger.scope("codex-subscription-router");

const statusOutput = z.object({
  signedIn: z.boolean(),
  accountEmail: z.string().nullable(),
});

/** Best-effort decode of the `email` claim from a JWT id_token (no verification). */
function readEmailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

export async function readCodexStatus(): Promise<z.infer<typeof statusOutput>> {
  const credPath = path.join(os.homedir(), ".codex", "auth.json");
  try {
    const raw = await readFile(credPath, "utf8");
    const parsed = JSON.parse(raw) as {
      OPENAI_API_KEY?: string | null;
      tokens?: { id_token?: string };
    };
    const signedIn = Boolean(parsed.tokens) || Boolean(parsed.OPENAI_API_KEY);
    if (!signedIn) {
      return { signedIn: false, accountEmail: null };
    }
    return {
      signedIn: true,
      accountEmail: readEmailFromIdToken(parsed.tokens?.id_token),
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      return { signedIn: false, accountEmail: null };
    }
    log.warn("Failed to read ~/.codex/auth.json", { error: err });
    return { signedIn: false, accountEmail: null };
  }
}

export const codexSubscriptionRouter = router({
  getEnabled: publicProcedure
    .output(z.boolean())
    .query(() => getUseCodexSubscription()),

  setEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      setUseCodexSubscription(input.enabled);
    }),

  getStatus: publicProcedure
    .output(statusOutput)
    .query(() => readCodexStatus()),
});
