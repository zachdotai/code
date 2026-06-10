export {
  BILLING_FLAG,
  DISCOVERY_RUN_FLAG,
  EXPERIMENT_SUGGESTIONS_FLAG,
  HOME_TAB_FLAG,
  INBOX_GATED_DUE_TO_SCALE_FLAG,
  RTS_FINOPS_FLAG,
  RTS_FLAG,
  SYNC_CLOUD_TASKS_FLAG,
} from "./flags";

export const SELF_DRIVING_SETUP_TASK_FLAG =
  "posthog-code-self-driving-setup-task";
export const BRANCH_PREFIX = "posthog-code/";

// Base URL for RTS-mode static assets (voice mp3s, bgm). Served from a
// Cloudflare R2 bucket (`ph-code-rts`) behind `code-rts.posthog.com`.
// Overridable at build time via `VITE_CODE_RTS_ASSETS_BASE_URL`.
//
// Ownership: Stephen Schmidt provisioned the bucket + custom domain (see
// #hackathon-hedgemony, 2026-05-21). Cert + DNS managed via Cloudflare
// dashboard since the Terraform provider doesn't cover R2 custom-domain
// bindings yet (PostHog/posthog-cloud-infra#8245). Asset uploads happen
// via `cloudflare/wrangler-action` from a separate `code-rts-assets`
// repo. The app degrades silently if the CDN is unreachable (audio
// elements `.catch()` play failures; `voice.ts`/`BgmPlayer.tsx` log
// the failure via `logger.scope("rts-...")` but never throw).
export const CODE_RTS_ASSETS_BASE_URL =
  "https://code-rts.posthog.com/static/code-rts";
