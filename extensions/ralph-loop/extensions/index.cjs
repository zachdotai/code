/** Command-only Ralph loop extension for PostHog Code. */
const fs = require("node:fs");
const path = require("node:path");

const RALPH_DIR = ".ralph";
const COMPLETE_MARKER = "<promise>COMPLETE</promise>";
const DEFAULT_REFLECT_INSTRUCTIONS = `REFLECTION CHECKPOINT

Pause and reflect on your progress:
1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

Update the task file with your reflection, then continue working.`;

const HELP = `Ralph Loop commands:
/ralph start <name> [task description] [--items-per-iteration N] [--reflect-every N] [--max-iterations N]
/ralph-done [name]
/ralph-resume <name>
/ralph-status
/ralph-stop [name]
/ralph done --complete [name]`;

function tokenize(input) {
  return (
    input
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((token) => token.replace(/^"|"$/g, "")) ?? []
  );
}

function sanitize(name) {
  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!sanitized) throw new Error(`Invalid Ralph loop name: ${name}`);
  return sanitized;
}

function requireRepoPath(ctx) {
  if (!ctx.repoPath || !path.isAbsolute(ctx.repoPath)) {
    throw new Error(
      "Ralph loops require a local repository path. Cloud repositories are not supported yet.",
    );
  }
  return ctx.repoPath;
}

function ralphDir(repoPath) {
  return path.join(repoPath, RALPH_DIR);
}

function statePath(repoPath, name) {
  return path.join(ralphDir(repoPath), `${sanitize(name)}.state.json`);
}

function taskPath(repoPath, state) {
  return path.resolve(repoPath, state.taskFile);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadState(repoPath, name) {
  try {
    const raw = readJson(statePath(repoPath, name));
    return {
      ...raw,
      status: raw.status ?? (raw.active ? "active" : "paused"),
      reflectInstructions:
        raw.reflectInstructions ?? DEFAULT_REFLECT_INSTRUCTIONS,
      lastReflectionAt: raw.lastReflectionAt ?? 0,
    };
  } catch {
    return null;
  }
}

function saveState(repoPath, state) {
  ensureDir(ralphDir(repoPath));
  fs.writeFileSync(
    statePath(repoPath, state.name),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
}

function listLoops(repoPath) {
  try {
    return fs
      .readdirSync(ralphDir(repoPath))
      .filter((entry) => entry.endsWith(".state.json"))
      .map((entry) => loadState(repoPath, entry.replace(/\.state\.json$/, "")))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function mostRecentActiveLoop(repoPath) {
  const active = listLoops(repoPath).filter(
    (state) => state.status === "active",
  );
  active.sort(
    (a, b) =>
      fs.statSync(statePath(repoPath, b.name)).mtimeMs -
      fs.statSync(statePath(repoPath, a.name)).mtimeMs,
  );
  return active[0] ?? null;
}

function targetLoop(repoPath, maybeName) {
  return maybeName
    ? loadState(repoPath, sanitize(maybeName))
    : mostRecentActiveLoop(repoPath);
}

function pauseOtherActiveLoops(repoPath, currentName) {
  for (const loop of listLoops(repoPath)) {
    if (loop.name !== currentName && loop.status === "active") {
      saveState(repoPath, { ...loop, status: "paused", active: false });
    }
  }
}

function parseOptions(tokens) {
  const result = {
    positionals: [],
    itemsPerIteration: 3,
    reflectEvery: 0,
    maxIterations: 50,
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (token === "--items-per-iteration" && next) {
      result.itemsPerIteration = Number.parseInt(next, 10) || 0;
      i += 1;
    } else if (token === "--reflect-every" && next) {
      result.reflectEvery = Number.parseInt(next, 10) || 0;
      i += 1;
    } else if (token === "--max-iterations" && next) {
      result.maxIterations = Number.parseInt(next, 10) || 0;
      i += 1;
    } else {
      result.positionals.push(token);
    }
  }

  return result;
}

function defaultTaskContent(name, description) {
  return `# ${name}

${description || "Describe this Ralph loop task."}

## Goals
- Clarify the desired outcome.

## Checklist
- [ ] Break the task into concrete steps.
- [ ] Implement the next useful change.
- [ ] Record verification evidence.

## Verification
- Not run yet.

## Notes
- Created by the Ralph Loop extension.
`;
}

function buildPrompt(state, taskContent, isReflection) {
  const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
  const header = `───────────────────────────────────────────────────────────────────────
🔄 RALPH LOOP: ${state.name} | Iteration ${state.iteration}${maxStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────`;

  const lines = [header, ""];
  if (isReflection) lines.push(state.reflectInstructions, "\n---\n");

  lines.push(
    `## Current Task (from ${state.taskFile})\n\n${taskContent}\n\n---`,
  );
  lines.push("\n## Instructions\n");
  lines.push(
    "You are in a Ralph loop created by a PostHog Code extension. There is no UI yet; loop state lives in `.ralph/`.",
  );
  lines.push(
    `You are in iteration ${state.iteration}${state.maxIterations > 0 ? ` of ${state.maxIterations}` : ""}.\n`,
  );

  if (state.itemsPerIteration > 0) {
    lines.push(
      `**THIS ITERATION: Process approximately ${state.itemsPerIteration} items.**\n`,
    );
    lines.push(
      `1. Work on the next ~${state.itemsPerIteration} items from the checklist.`,
    );
  } else {
    lines.push("1. Continue working on the task.");
  }
  lines.push(
    `2. Update the task file (${state.taskFile}) with progress and verification evidence.`,
  );
  lines.push(
    `3. When fully complete, call the ralph_done tool with completed=true, then respond with: ${COMPLETE_MARKER}`,
  );
  lines.push(
    "4. Otherwise, call the ralph_done tool after making real progress and updating the task file.",
  );

  return lines.join("\n");
}

function startLoop(args, ctx) {
  const repoPath = requireRepoPath(ctx);
  const parsed = parseOptions(tokenize(args));
  const [rawName, ...descriptionParts] = parsed.positionals;
  if (!rawName)
    return { message: "Usage: /ralph start <name> [task description]" };

  const name = sanitize(rawName);
  pauseOtherActiveLoops(repoPath, name);

  const taskFile = path.join(RALPH_DIR, `${name}.md`);
  const state = {
    name,
    taskFile,
    iteration: 1,
    maxIterations: parsed.maxIterations,
    itemsPerIteration: parsed.itemsPerIteration,
    reflectEvery: parsed.reflectEvery,
    reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
    active: true,
    status: "active",
    startedAt: new Date().toISOString(),
    lastReflectionAt: 0,
  };
  const content = defaultTaskContent(name, descriptionParts.join(" ").trim());
  ensureDir(path.dirname(taskPath(repoPath, state)));
  fs.writeFileSync(taskPath(repoPath, state), content, "utf-8");
  saveState(repoPath, state);

  return {
    message: `Started Ralph loop ${name}`,
    prompt: buildPrompt(state, content, false),
  };
}

function advanceLoop(args, ctx) {
  const repoPath = requireRepoPath(ctx);
  const tokens = tokenize(args);
  const complete = tokens.includes("--complete");
  const name = tokens.find((token) => token !== "--complete");
  const state = targetLoop(repoPath, name);
  if (!state) return { message: "No active Ralph loop found." };

  if (complete) {
    saveState(repoPath, {
      ...state,
      active: false,
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    return { message: `Completed Ralph loop ${state.name}` };
  }

  const next = { ...state, iteration: state.iteration + 1 };
  if (next.maxIterations > 0 && next.iteration > next.maxIterations) {
    saveState(repoPath, {
      ...next,
      active: false,
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    return {
      message: `Ralph loop ${state.name} stopped after ${state.maxIterations} iterations.`,
    };
  }

  const isReflection =
    next.reflectEvery > 0 && (next.iteration - 1) % next.reflectEvery === 0;
  if (isReflection) next.lastReflectionAt = next.iteration;
  saveState(repoPath, next);

  return {
    message: `Advanced Ralph loop ${state.name} to iteration ${next.iteration}`,
    prompt: buildPrompt(
      next,
      fs.readFileSync(taskPath(repoPath, next), "utf-8"),
      isReflection,
    ),
  };
}

function resumeLoop(args, ctx) {
  const repoPath = requireRepoPath(ctx);
  const [rawName] = tokenize(args);
  if (!rawName) return { message: "Usage: /ralph-resume <name>" };
  const state = loadState(repoPath, sanitize(rawName));
  if (!state) return { message: `Ralph loop ${rawName} not found.` };
  if (state.status === "completed")
    return { message: `Ralph loop ${state.name} is already completed.` };

  pauseOtherActiveLoops(repoPath, state.name);
  const next = {
    ...state,
    active: true,
    status: "active",
    iteration: state.iteration + 1,
  };
  saveState(repoPath, next);
  const isReflection =
    next.reflectEvery > 0 && (next.iteration - 1) % next.reflectEvery === 0;
  return {
    message: `Resumed Ralph loop ${state.name}`,
    prompt: buildPrompt(
      next,
      fs.readFileSync(taskPath(repoPath, next), "utf-8"),
      isReflection,
    ),
  };
}

function status(args, ctx) {
  const repoPath = requireRepoPath(ctx);
  const includeCompleted = tokenize(args).includes("--all");
  const loops = listLoops(repoPath).filter(
    (loop) => includeCompleted || loop.status !== "completed",
  );
  if (loops.length === 0) return { message: "No Ralph loops found." };
  const summary = loops
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (loop) =>
        `- ${loop.name}: ${loop.status} (iteration ${loop.iteration}${loop.maxIterations > 0 ? `/${loop.maxIterations}` : ""}, task ${loop.taskFile})`,
    )
    .join("\n");
  return { message: `Ralph loops:\n${summary}` };
}

function stop(args, ctx) {
  const repoPath = requireRepoPath(ctx);
  const [rawName] = tokenize(args);
  const state = targetLoop(repoPath, rawName);
  if (!state) return { message: "No active Ralph loop found." };
  saveState(repoPath, { ...state, active: false, status: "paused" });
  return {
    message: `Paused Ralph loop ${state.name} at iteration ${state.iteration}.`,
  };
}

function runSubcommand(args, ctx) {
  const [subcommand, ...rest] = tokenize(args);
  const restText = rest.join(" ");
  if (subcommand === "start") return startLoop(restText, ctx);
  if (subcommand === "done") return advanceLoop(restText, ctx);
  if (subcommand === "resume") return resumeLoop(restText, ctx);
  if (subcommand === "status") return status(restText, ctx);
  if (subcommand === "stop") return stop(restText, ctx);
  if (!subcommand || subcommand === "help") return { message: HELP };
  return { message: `Unknown Ralph command: ${subcommand}\n${HELP}` };
}

function safe(handler) {
  return (args, ctx) => {
    try {
      return handler(args ?? "", ctx);
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

function startLoopTool(args, ctx) {
  const parts = [args.name];
  if (args.description) parts.push(args.description);
  if (args.itemsPerIteration !== undefined) {
    parts.push("--items-per-iteration", String(args.itemsPerIteration));
  }
  if (args.reflectEvery !== undefined) {
    parts.push("--reflect-every", String(args.reflectEvery));
  }
  if (args.maxIterations !== undefined) {
    parts.push("--max-iterations", String(args.maxIterations));
  }
  return startLoop(parts.join(" "), ctx);
}

function doneLoopTool(args, ctx) {
  const parts = [];
  if (args.completed) parts.push("--complete");
  if (args.name) parts.push(String(args.name));
  return advanceLoop(parts.join(" "), ctx);
}

module.exports = function activate(posthogCode) {
  posthogCode.registerTool("ralph_start", {
    description:
      "Start a Ralph loop for paced iterative development. Creates `.ralph/<name>.md` and returns the first iteration prompt.",
    parameters: {
      name: {
        type: "string",
        description: "Loop name, for example `refactor-auth`.",
      },
      description: {
        type: "string",
        optional: true,
        description: "Short task description for the generated task file.",
      },
      itemsPerIteration: {
        type: "number",
        optional: true,
        description: "Approximate number of checklist items per iteration.",
      },
      reflectEvery: {
        type: "number",
        optional: true,
        description: "Reflect every N iterations. 0 disables reflection.",
      },
      maxIterations: {
        type: "number",
        optional: true,
        description: "Maximum iterations. 0 means no limit.",
      },
    },
    handler: safe(startLoopTool),
  });
  posthogCode.registerTool("ralph_done", {
    description:
      "Advance the active Ralph loop after updating its task file. Returns the next iteration prompt. Set completed=true only when fully done.",
    parameters: {
      name: {
        type: "string",
        optional: true,
        description: "Optional loop name. Defaults to the active loop.",
      },
      completed: {
        type: "boolean",
        optional: true,
        description: "Mark the loop completed instead of advancing.",
      },
    },
    handler: safe(doneLoopTool),
  });

  posthogCode.registerCommand("ralph", {
    description: "Manage Ralph development loops",
    argumentHint: "start|done|resume|status|stop",
    handler: safe(runSubcommand),
  });
  posthogCode.registerCommand("ralph-start", {
    description: "Start a Ralph loop",
    argumentHint: "name task description",
    handler: safe(startLoop),
  });
  posthogCode.registerCommand("ralph-done", {
    description: "Advance the active Ralph loop",
    argumentHint: "optional-name",
    handler: safe(advanceLoop),
  });
  posthogCode.registerCommand("ralph-resume", {
    description: "Resume a paused Ralph loop",
    argumentHint: "name",
    handler: safe(resumeLoop),
  });
  posthogCode.registerCommand("ralph-status", {
    description: "List Ralph loops",
    argumentHint: "--all",
    handler: safe(status),
  });
  posthogCode.registerCommand("ralph-stop", {
    description: "Pause the active Ralph loop",
    argumentHint: "optional-name",
    handler: safe(stop),
  });
};
