// Dashboard schemas live in @posthog/core so the renderer (packages/ui) can
// import the shared types without depending on the desktop app's main process.
export * from "@posthog/core/canvas/dashboardSchemas";
