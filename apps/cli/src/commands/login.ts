import { buildCredentials, saveCredentials } from "@posthog/core/credentials";
import {
  buildAuthorizeUrl,
  type CloudRegion,
  exchangeCodeForToken,
  findFreePort,
  getCloudUrl,
  waitForOAuthCallback,
} from "@posthog/core/oauth";
import { printError, printLine } from "../display.ts";

export interface LoginOptions {
  region: CloudRegion;
}

export async function runLogin(options: LoginOptions): Promise<void> {
  const { region } = options;

  printLine(`\nLogging in to PostHog (${region.toUpperCase()} region)...`);
  printLine("Opening your browser for authentication.\n");

  let port: number;
  try {
    port = await findFreePort();
  } catch {
    printError("Could not find a free port for the callback server.");
    process.exit(1);
  }

  const redirectUri = `http://localhost:${port}/callback`;
  const codeVerifier = (
    await import("@posthog/core/oauth")
  ).generateCodeVerifier();
  const authorizeUrl = buildAuthorizeUrl(region, codeVerifier, redirectUri);

  let code: string;
  try {
    code = await waitForOAuthCallback(authorizeUrl, port);
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  printLine("Authorization received. Exchanging code for tokens...");

  let tokenResponse: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    tokenResponse = await exchangeCodeForToken(
      code,
      codeVerifier,
      region,
      redirectUri,
    );
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const scopedTeams = tokenResponse.scoped_teams ?? [];

  if (scopedTeams.length === 0) {
    printError(
      "Your account has no projects available. Make sure you have access to PostHog Code.",
    );
    process.exit(1);
  }

  let projectId: number;

  if (scopedTeams.length === 1) {
    projectId = scopedTeams[0];
    printLine(`Using project: ${projectId}`);
  } else {
    projectId = await selectProject(scopedTeams, region);
  }

  const credentials = buildCredentials(region, projectId, tokenResponse);
  saveCredentials(credentials);

  printLine(`\nLogged in successfully.`);
  printLine(`  Region:  ${region.toUpperCase()}`);
  printLine(`  Project: ${projectId}`);
  printLine(`  Host:    ${getCloudUrl(region)}\n`);
}

async function selectProject(
  teams: number[],
  region: CloudRegion,
): Promise<number> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    process.stdout.write(`\nAvailable projects in ${getCloudUrl(region)}:\n`);
    teams.forEach((id, i) => {
      process.stdout.write(`  [${i + 1}] Project ${id}\n`);
    });
    process.stdout.write(`\nSelect a project [1-${teams.length}]: `);

    rl.once("line", (line) => {
      rl.close();
      const index = Number.parseInt(line.trim(), 10) - 1;
      const selected = teams[index] ?? teams[0];
      resolve(selected);
    });
  });
}
