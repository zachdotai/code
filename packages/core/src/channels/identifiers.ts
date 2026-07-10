// DI tokens for the channels feature. They live in @posthog/core so both the
// host-router routers and the host DI container can reference them without
// depending on the desktop app's main process (where the concrete services are
// bound).

// Files/threads a task is filed under a channel folder on the desktop file
// system. The seam that later absorbs channel-identity unification.
export const CHANNELS_SERVICE = Symbol.for("posthog.core.channels.service");

// Handles `<scheme>://channel/...` deep links. Host-bound (deep-link registry +
// main window), bound by the desktop app container like the other link services.
export const CHANNEL_LINK_SERVICE = Symbol.for(
  "posthog.core.channels.linkService",
);
