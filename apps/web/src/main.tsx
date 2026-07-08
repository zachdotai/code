import "reflect-metadata";
// Side effect: registers the web persistence backend for @posthog/ui stores
// before any of the imports below create them.
import "./web-storage";
import "@posthog/ui/styles/globals.css";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import { boot } from "@posthog/di/contribution";
import { ServiceProvider } from "@posthog/di/react";
import App from "@posthog/ui/shell/App";
import React from "react";
import ReactDOM from "react-dom/client";
import { Providers } from "./Providers";
import { container } from "./web-container";
import {
  completeOAuthCallbackPage,
  OAUTH_CALLBACK_PATH,
} from "./web-oauth-flow";

if (window.location.pathname === OAUTH_CALLBACK_PATH) {
  // OAuth popup landing: relay code+state to the opener tab and close.
  // Nothing else may run here — restoring a session in the popup could
  // rotate the refresh token out from under the main tab.
  completeOAuthCallbackPage();
} else {
  // Restore any persisted session (desktop does this in main-process
  // bootstrap); flips authState.bootstrapComplete when done.
  void container.get(AUTH_SERVICE).initialize();
  void boot(container);

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ServiceProvider container={container}>
        <Providers>
          <App />
        </Providers>
      </ServiceProvider>
    </React.StrictMode>,
  );
}
