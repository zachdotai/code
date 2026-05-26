import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionService } from "./service";

const warnMock = vi.hoisted(() => vi.fn());

vi.mock("../../utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: warnMock,
      debug: vi.fn(),
    }),
  },
}));

let tempDir: string;
let zipPath: string;
let appDataPath: string;

function zipEntries(entries: Record<string, string>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([name, content]) => [
          name,
          [new Uint8Array(Buffer.from(content)), { level: 0 }],
        ]),
      ),
    ),
  );
}

async function writeZip(entries: Record<string, string>): Promise<void> {
  await writeFile(zipPath, zipEntries(entries));
}

function createService(): ExtensionService {
  return new ExtensionService({ appDataPath, logsPath: join(tempDir, "logs") });
}

describe("ExtensionService runtime commands", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "posthog-code-extension-test-"));
    zipPath = join(tempDir, "extension.zip");
    appDataPath = join(tempDir, "appData");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads JavaScript extension runtimes and executes registered commands", async () => {
    await writeZip({
      "package.json": JSON.stringify({
        name: "runtime-command-extension",
        posthogCode: { extensions: ["extensions/index.cjs"] },
      }),
      "extensions/index.cjs": `
        module.exports = function (posthogCode) {
          posthogCode.registerCommand("hello", {
            description: "Say hello",
            argumentHint: "name",
            handler(args, ctx) {
              return { message: "Hello " + (args || "world") + " from " + ctx.extensionId + " in " + ctx.repoPath }
            },
          })
          posthogCode.registerView("dashboard", {
            location: "sidebar",
            title: "Runtime Dashboard",
            icon: "sparkle",
            html: "<h1>Runtime Dashboard</h1>",
          })
        }
      `,
    });
    const service = createService();

    await service.installFromZip(zipPath);
    expect(
      existsSync(
        join(
          appDataPath,
          "extensions/runtime-command-extension/extensions/index.cjs",
        ),
      ),
    ).toBe(true);
    expect(warnMock).not.toHaveBeenCalled();

    await expect(service.listCommands()).resolves.toEqual([
      {
        extensionId: "runtime-command-extension",
        name: "hello",
        description: "Say hello",
        input: { hint: "name" },
      },
    ]);
    await expect(service.listSidebar()).resolves.toEqual([
      {
        extensionId: "runtime-command-extension",
        id: "runtime-command-extension.dashboard",
        title: "Runtime Dashboard",
        icon: "sparkle",
        entry: undefined,
        url: undefined,
        html: "<h1>Runtime Dashboard</h1>",
      },
    ]);
    await expect(
      service.executeCommand({
        name: "hello",
        args: "Max",
        taskId: "task-1",
        repoPath: "/repo",
      }),
    ).resolves.toEqual({
      handled: true,
      message: "Hello Max from runtime-command-extension in /repo",
    });
  });
});
