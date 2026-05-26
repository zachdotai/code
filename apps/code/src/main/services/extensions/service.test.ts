import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { ...fs, default: fs };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

vi.mock("node:os", () => ({
  tmpdir: () => "/mock/tmp",
  default: { tmpdir: () => "/mock/tmp" },
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { zipSync } from "fflate";
import { ExtensionService } from "./service";

const APP_DATA_PATH = "/mock/appData";
const ZIP_PATH = "/mock/package.zip";

function createService(): ExtensionService {
  return new ExtensionService({
    appDataPath: APP_DATA_PATH,
    logsPath: "/logs",
  });
}

function writeZip(entries: Record<string, string>): void {
  vol.mkdirSync("/mock", { recursive: true });
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, content]) => [
        name,
        [new Uint8Array(Buffer.from(content)), { level: 0 }],
      ]),
    ),
  );
  vol.writeFileSync(ZIP_PATH, Buffer.from(zipped));
}

function writeExampleExtensionZip(): void {
  writeZip({
    "package.json": JSON.stringify({
      name: "@acme/demo-extension",
      displayName: "Demo Extension",
      version: "1.2.3",
      description: "Adds demo UI",
      posthogCode: {
        sidebar: [
          {
            id: "dashboard",
            title: "Demo Dashboard",
            icon: "sparkle",
            entry: "frontend/index.html",
          },
        ],
        prompts: ["prompts"],
        skills: ["skills"],
      },
    }),
    "frontend/index.html": "<h1>Demo</h1>",
    "prompts/demo-prompt.md":
      "---\nname: demo-prompt\ndescription: Run demo prompt\n---\nDo the thing.",
    "skills/demo-skill/SKILL.md":
      "---\nname: demo-skill\ndescription: Demo skill\n---\n# Demo skill",
  });
}

describe("ExtensionService", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/mock/tmp", { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs a zipped extension and lists manifest contributions", async () => {
    writeExampleExtensionZip();
    const service = createService();

    const installed = await service.installFromZip(ZIP_PATH);

    expect(installed).toMatchObject({
      id: "acme-demo-extension",
      name: "@acme/demo-extension",
      displayName: "Demo Extension",
      version: "1.2.3",
      skillCount: 1,
    });
    expect(installed.sidebar[0]).toMatchObject({
      extensionId: "acme-demo-extension",
      id: "acme-demo-extension.dashboard",
      title: "Demo Dashboard",
      icon: "sparkle",
      entry: "frontend/index.html",
    });
    expect(installed.sidebar[0].url).toBe(
      "file:///mock/appData/extensions/acme-demo-extension/frontend/index.html",
    );
    expect(installed.prompts).toEqual([
      {
        extensionId: "acme-demo-extension",
        name: "demo-prompt",
        description: "Run demo prompt",
        input: undefined,
      },
    ]);
    expect(
      vol.existsSync(
        "/mock/appData/extensions/acme-demo-extension/plugin.json",
      ),
    ).toBe(true);
  });

  it("materializes extension prompts and skills as Claude plugin paths", async () => {
    writeExampleExtensionZip();
    const service = createService();
    await service.installFromZip(ZIP_PATH);

    const plugins = await service.getAgentPluginPaths();

    expect(plugins).toEqual([
      {
        type: "local",
        path: "/mock/appData/plugins/extensions/acme-demo-extension",
      },
    ]);
    expect(
      vol.existsSync(
        "/mock/appData/plugins/extensions/acme-demo-extension/commands/demo-prompt.md",
      ),
    ).toBe(true);
    expect(
      vol.existsSync(
        "/mock/appData/plugins/extensions/acme-demo-extension/skills/demo-skill/SKILL.md",
      ),
    ).toBe(true);
  });

  it("lists extension skills with extension source metadata", async () => {
    writeExampleExtensionZip();
    const service = createService();
    await service.installFromZip(ZIP_PATH);

    const skills = await service.listSkills();

    expect(skills).toEqual([
      {
        name: "demo-skill",
        description: "Demo skill",
        source: "extension",
        path: "/mock/appData/extensions/acme-demo-extension/skills/demo-skill",
        repoName: "Demo Extension",
      },
    ]);
  });

  it("auto-discovers conventional skills only when no explicit skill list exists", async () => {
    writeZip({
      "package.json": JSON.stringify({ name: "conventional-skills" }),
      "skills/auto-skill/SKILL.md":
        "---\nname: auto-skill\ndescription: Auto skill\n---\n# Auto skill",
      "skills/top-level.md":
        "---\nname: top-level\ndescription: Top level skill\n---\n# Top level skill",
      "skills/nested/nested-skill/SKILL.md":
        "---\nname: nested-skill\ndescription: Nested skill\n---\n# Nested skill",
    });
    const service = createService();

    const installed = await service.installFromZip(ZIP_PATH);
    expect(installed.skillCount).toBe(3);
    expect(await service.listSkills()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "top-level",
          path: "/mock/appData/extensions/conventional-skills/skills/top-level.md",
        }),
        expect.objectContaining({ name: "nested-skill" }),
      ]),
    );
    expect(
      (await service.getAgentPluginPaths()).some((plugin) =>
        vol.existsSync(`${plugin.path}/skills/top-level/SKILL.md`),
      ),
    ).toBe(true);

    writeZip({
      "package.json": JSON.stringify({
        name: "disabled-skills",
        posthogCode: { skills: [] },
      }),
      "skills/hidden-skill/SKILL.md":
        "---\nname: hidden-skill\ndescription: Hidden skill\n---\n# Hidden skill",
    });

    const disabled = await service.installFromZip(ZIP_PATH);
    expect(disabled.skillCount).toBe(0);
  });

  it("rejects unsupported Pi glob and exclusion resource patterns", async () => {
    writeZip({
      "package.json": JSON.stringify({
        name: "glob-extension",
        posthogCode: { prompts: ["prompts/*.md", "!prompts/draft.md"] },
      }),
      "prompts/demo.md": "# Demo",
    });
    const service = createService();

    await expect(service.installFromZip(ZIP_PATH)).rejects.toThrow(
      "glob, exclusion, and force-include patterns are not supported yet",
    );
  });

  it("rejects zip entries that escape the extraction directory", async () => {
    writeZip({
      "package.json": JSON.stringify({ name: "safe" }),
      "../evil.txt": "nope",
    });
    const service = createService();

    await expect(service.installFromZip(ZIP_PATH)).rejects.toThrow(
      "Unsafe zip entry path",
    );
  });
});
