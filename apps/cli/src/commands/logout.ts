import {
  clearCredentials,
  credentialsPath,
  loadCredentials,
} from "@posthog/core/credentials";
import { printLine } from "../display.ts";

export function runLogout(): void {
  const creds = loadCredentials();

  if (!creds) {
    printLine("Not currently logged in.");
    return;
  }

  clearCredentials();
  printLine(`Logged out. Credentials removed from ${credentialsPath()}.`);
}
