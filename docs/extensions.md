# PostHog Code extensions

PostHog Code can install extension packages from a `.zip` file. Extensions are inspired by Pi packages and VS Code contribution manifests: a package has a root-level `package.json` and declares what it contributes to the app.

> Extensions are local code/content packages. Extension runtime files execute in the main process with local system access. Only install extensions from sources you trust.

## Package layout

```text
my-extension.zip
├── package.json
├── plugin.json                 # optional; generated if omitted
├── extensions/
│   └── index.js                # optional Pi-style runtime commands
├── frontend/
│   └── index.html              # optional custom sidebar view
├── prompts/
│   └── investigate.md          # optional slash prompt template
└── skills/
    └── my-skill/
        └── SKILL.md            # optional Claude/PostHog Code skill
```

The zip should contain `package.json` at its root. A single wrapper directory containing `package.json` is also accepted for convenience.

## Manifest

Add a `posthogCode` section to `package.json` when you need non-conventional paths or sidebar views:

```json
{
  "name": "@acme/posthog-code-demo",
  "displayName": "Demo Extension",
  "version": "1.0.0",
  "description": "Adds a demo sidebar view, command, prompt, and skill",
  "posthogCode": {
    "extensions": ["extensions/index.js"],
    "sidebar": [
      {
        "id": "dashboard",
        "title": "Demo Dashboard",
        "icon": "sparkle",
        "entry": "frontend/index.html"
      }
    ],
    "prompts": ["prompts"],
    "skills": ["skills"]
  }
}
```

Discovery matches the common Pi package behavior: if a `posthogCode.*` or `pi.*` resource array is present, it is the explicit allow-list. If neither is present, conventional `extensions/`, `prompts/`, and `skills/` directories are auto-discovered when they exist.

Current package subset:

- Resource arrays must contain exact relative paths. Pi glob, exclusion (`!path`), and force-include (`+path`) patterns are not supported yet.
- Zip installs do not run `npm install`. Bundle runtime dependencies inside the zip and reference them with normal relative imports.
- Runtime extensions must be prebuilt JavaScript (`.js`, `.mjs`, or `.cjs`). TypeScript source is not loaded directly.

## Contributions

### Runtime extension API

Runtime extensions can use the optional `@posthog/code-extension-api` package for types and bridge helpers:

```ts
import type { PostHogCodeExtensionApi } from "@posthog/code-extension-api"

export default function activate(posthogCode: PostHogCodeExtensionApi) {
  posthogCode.registerCommand("hello", {
    description: "Say hello",
    argumentHint: "name",
    async handler(args, ctx) {
      return { message: `Hello ${args || "world"} from ${ctx.extensionId}` }
    },
  })

  posthogCode.registerView("dashboard", {
    location: "sidebar",
    title: "Dashboard",
    icon: "sparkle",
    entry: "frontend/index.html",
  })
}
```

`posthogCode.extensions` / `pi.extensions` point to JavaScript runtime files. Conventional `extensions/` is auto-discovered when no explicit extension list is present. Runtime files should export a default factory function or `activate` function.

### Sidebar views

Static `sidebar` manifest contributions add menu items to the PostHog Code sidebar. `entry` points to a local HTML file inside the extension package. Runtime extensions can also call `registerView(id, { location: "sidebar", title, icon, entry?, html? })`. `entry` renders a packaged HTML file; `html` renders inline HTML via iframe `srcDoc`.

Views are rendered in sandboxed iframes, so bundled frontend JavaScript does not receive Electron or Node.js privileges.

Supported icon names: `puzzle` (default), `sparkle`, `browser`, and `terminal`.

### Webview postMessage bridge

Iframe views can use `window.postMessage` directly or the optional bridge helper:

```ts
import { createPostHogCodeBridge } from "@posthog/code-extension-api"

const bridge = createPostHogCodeBridge()
bridge.ready()
bridge.notify("Dashboard loaded")
bridge.log("Dashboard rendered", { rows: 10 })
```

Supported view-to-host messages:

- `posthogCode.ready` — host replies with `posthogCode.hostReady` including `extensionId`, `viewId`, API `version`, and `theme`.
- `posthogCode.notify` — show an info/warning/error toast.
- `posthogCode.log` — write a renderer log scoped to the extension view.

Messages are accepted only from the iframe window for the active extension view. There is no direct tRPC, Electron, filesystem, navigation, or storage bridge yet.

### Pi-style extension commands

Runtime extensions register commands with `posthogCode.registerCommand(...)`.

Extension commands appear in the `/` picker and are handled before built-in commands, prompt templates, and skills. Duplicate slash names are resolved by first-match priority: extension commands, built-in commands, prompt templates, then skills/session commands. For duplicate names within the same priority, the first deterministic extension/resource order wins.

Supported command handler context is intentionally small for now:

- `args`: the text after the command name.
- `ctx.commandName`: the command being executed.
- `ctx.extensionId`: the installed extension id.
- `ctx.taskId`: present when the command runs inside an existing task.
- `ctx.repoPath`: the active local repository path when known.

Handlers can return a string or `{ "message": "..." }` to show a notification. Pi APIs such as `ctx.ui.notify`, `ctx.ui.select`, lifecycle events, session replacement helpers, custom tools, and input interception are not supported yet.

### Prompt templates

`posthogCode.prompts` / `pi.prompts` point to markdown files or directories containing markdown files. Conventional `prompts/` is auto-discovered when no explicit prompt list is present. Prompt templates appear in the `/` picker and are materialized into the Claude-compatible runtime plugin as slash commands for new local agent sessions.

Prompt markdown files can include frontmatter:

```markdown
---
name: demo-investigate
description: Investigate a demo topic
---

Use the topic provided by the user and produce a concise investigation plan.
```

### Skills

`posthogCode.skills` / `pi.skills` point to directories containing skills. Skill directories can contain `SKILL.md` with the usual skill frontmatter. Matching Pi's conventional package behavior, top-level markdown files inside a contributed skills directory are also loaded as skills. Extension skills appear in the Skills view under the Extensions section, appear in the `/` picker, and are included in new local agent sessions.

Use `"skills": []` to explicitly expose no skills even if the package contains a conventional `skills/` directory.

## Installing and removing

1. Open **Settings → Extensions**.
2. Click **Install .zip** and choose the extension package.
3. New sidebar views appear immediately. Commands, prompt templates, and skills are available in the `/` picker. Prompt templates and skills are available to new local agent sessions.
4. Use the trash button in **Settings → Extensions** to uninstall an extension.

Installed extensions live under the app data directory in `extensions/`. Runtime Claude-compatible plugin shims are generated under `plugins/extensions/`.

Extensions are currently either installed or uninstalled; per-extension enable/disable is intentionally deferred until there is a broader sandboxing/signing/permission model.
