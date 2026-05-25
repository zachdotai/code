import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AddOnContext, AddOnDefinition } from "./types";

const rtkOptionsSchema = z.object({
  /**
   * Absolute path to the rtk binary. When omitted, the add-on looks on
   * `$PATH` and a small set of known install locations.
   */
  binaryPath: z.string().optional(),
  /**
   * Forwarded to `rtk run --skip-permissions`. Tells rtk to bypass its own
   * approval prompts because Claude's permission model already gates Bash.
   */
  skipPermissions: z.boolean().optional(),
});

export type RtkOptions = z.infer<typeof rtkOptionsSchema>;

function resolveRtkBinary(options: RtkOptions): string {
  if (options.binaryPath) {
    if (!existsSync(options.binaryPath)) {
      throw new Error(
        `rtk add-on: binary not found at configured path "${options.binaryPath}"`,
      );
    }
    return options.binaryPath;
  }

  // $PATH is authoritative — rtk's recommended installs (cargo, homebrew,
  // ~/.local/bin) all land their binaries on a directory the user's shell
  // already exports. If $PATH is empty (sandbox) we surface the missing-
  // binary error rather than guessing system locations.
  const candidates = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of candidates) {
    const candidate = join(dir, "rtk");
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    'rtk add-on: binary "rtk" not found on PATH. Install it from ' +
      "https://github.com/rtk-ai/rtk or set add-on option `binaryPath` to an absolute path.",
  );
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function makeRtkBashHook(
  binaryPath: string,
  options: RtkOptions,
): HookCallback {
  const flag = options.skipPermissions ? " --skip-permissions" : "";
  const escapedBinary = shellEscape(binaryPath);
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    if (input.tool_name !== "Bash") return { continue: true };

    const toolInput = (input.tool_input ?? {}) as { command?: unknown };
    const command = toolInput.command;
    if (typeof command !== "string" || command.length === 0) {
      return { continue: true };
    }

    // Already wrapped — don't double-wrap if the hook runs twice for some reason.
    if (command.startsWith(`${escapedBinary} run`)) {
      return { continue: true };
    }

    const rewritten = `${escapedBinary} run${flag} -- ${command}`;
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          ...(input.tool_input as Record<string, unknown>),
          command: rewritten,
        },
      },
    };
  };
}

export const rtkAddOn: AddOnDefinition<RtkOptions> = {
  name: "rtk",
  supportedAdapters: ["claude"],
  parseOptions(rawOptions) {
    return rtkOptionsSchema.parse(rawOptions ?? {});
  },
  contribute(_ctx: AddOnContext, options: RtkOptions) {
    const binaryPath = resolveRtkBinary(options);
    return {
      preToolUse: [makeRtkBashHook(binaryPath, options)],
    };
  },
};
