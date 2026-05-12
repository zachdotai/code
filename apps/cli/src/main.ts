import type { CloudRegion } from "@posthog/core/oauth";
import { Command } from "commander";
import { runLogin } from "./commands/login.ts";
import { runLogout } from "./commands/logout.ts";
import { runStart } from "./commands/start.ts";
import { runStatus } from "./commands/status.ts";

const program = new Command();

program
  .name("posthog-code")
  .description("Trigger and monitor PostHog Code cloud tasks")
  .version("1.0.0");

program
  .command("login")
  .description("Log in to PostHog via browser-based OAuth")
  .option("-r, --region <region>", "PostHog cloud region: us, eu, dev", "us")
  .action(async (options: { region: string }) => {
    const region = options.region as CloudRegion;
    if (!["us", "eu", "dev"].includes(region)) {
      process.stderr.write(`Invalid region "${region}". Use: us, eu, dev\n`);
      process.exit(1);
    }
    await runLogin({ region });
  });

program
  .command("logout")
  .description("Log out and remove stored credentials")
  .action(() => {
    runLogout();
  });

program
  .command("start <prompt>")
  .description("Create and launch a new cloud task")
  .option("-r, --repo <owner/repo>", "GitHub repository (e.g. org/repo)")
  .option("-w, --watch", "Stream live output after starting", false)
  .action(
    async (prompt: string, options: { repo?: string; watch: boolean }) => {
      await runStart(prompt, { repo: options.repo, watch: options.watch });
    },
  );

program
  .command("status <task-id>")
  .description(
    "Check on a task, stream its output, or answer pending questions",
  )
  .option("--run-id <run-id>", "Specific run ID (defaults to latest)")
  .option("-w, --watch", "Stream live output until the run finishes", false)
  .option(
    "-i, --interactive",
    "Watch and interactively respond to permission requests and questions",
    false,
  )
  .action(
    async (
      taskId: string,
      options: { runId?: string; watch: boolean; interactive: boolean },
    ) => {
      await runStatus(taskId, {
        runId: options.runId,
        watch: options.watch || options.interactive,
        interactive: options.interactive,
      });
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
