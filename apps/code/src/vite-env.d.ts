/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;

  // PostHog Analytics
  readonly VITE_POSTHOG_API_KEY?: string;
  readonly VITE_POSTHOG_API_HOST?: string;
  readonly VITE_POSTHOG_UI_HOST?: string;

  // Hogcraft audio CDN overrides
  readonly VITE_HOGCRAFT_VOICE_BASE_URL?: string;
  readonly VITE_HOGCRAFT_BGM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
