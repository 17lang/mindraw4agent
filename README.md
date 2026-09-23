# mindraw4agent

Mindraw for Codex agents: a project-scoped Codex plugin, skill, MCP server, and local sidebar preview service for opening a Mindraw canvas from the active Codex workspace.

- Repository: <https://github.com/17lang/mindraw4agent>
- Author and primary maintainer: 张军锋
- Copyright holder: 海南万幸科技有限公司
- License for this repository: MIT
- Companion app requirement: Mindraw `>= 1.2.4`
- First public target: macOS Apple Silicon

Mindraw App source code is not included in this repository. The Mindraw desktop app, DMG, product name, marks, and binary distribution are governed by separate binary and brand terms from the MIT-licensed agent integration in this repository.

## What This Plugin Does

`mindraw4agent` treats the current Codex workspace as a project root, prepares or inspects `MindrawCanvas/`, and exposes a project-scoped Mindraw canvas through:

- a Codex skill: `mindraw-open-canvas`;
- an MCP stdio server: `mindraw_mcp`;
- a local read-only sidebar preview service;
- an explicit handoff path to the Mindraw desktop app.

The plugin keeps project canvas selection local to the active workspace. It does not read or publish unrelated project folders, does not write `.mindraw` package internals, and does not implement arbitrary `mindraw://...documentId...elementId...` target-link entry in this release.

## Compatibility

The first public source candidate is scoped to:

- Mindraw App `>= 1.2.4`;
- For the canvas health check and recovery flow, a Mindraw App that exposes `inspect_legacy_canvas_recovery` (`legacyCanvasRecovery` capability). The lowest App version that provides it is not yet confirmed; it was verified against Mindraw `1.3.5` on this machine.
- macOS on Apple Silicon;
- Codex plugin runtime with local plugin installation support;
- project-local canvas packages under `MindrawCanvas/`.

Windows, Linux, Intel Mac, App Store distribution, automatic updates, and arbitrary target-link sidebar entry are outside this first release scope.

## Install From A Local Clone

Clone the repository when it exists publicly:

```bash
git clone https://github.com/17lang/mindraw4agent.git
cd mindraw4agent
```

Install the local marketplace source and plugin:

```bash
./scripts/install-local.sh
```

The installer uses the current repository directory as a local Codex plugin marketplace source. It does not install or modify the Mindraw desktop app.

## Uninstall

```bash
./scripts/uninstall-local.sh
```

This removes the Codex plugin installation and local marketplace entry for `mindraw4agent`. It does not remove Mindraw App or any project `MindrawCanvas/` files.

## Doctor

```bash
node scripts/doctor.mjs
node scripts/doctor.mjs --json
```

Doctor checks the current repository layout, Node runtime, Codex CLI availability, platform compatibility, and whether `/Applications/Mindraw.app` exists. It is read-only.

## Use

In Codex, ask:

```text
Open the Mindraw canvas for this project.
```

Useful explicit prompts:

```text
Open Mindraw in sidebar for this project.
Open Mindraw app for this project.
Create a new Mindraw project canvas.
Open the latest Mindraw project canvas in the desktop app.
在侧边栏打开这个项目的 Mindraw
在 Mindraw App 中打开这个项目
```

The default route starts a local sidebar preview service and prints a project-scoped URL:

```text
http://127.0.0.1:<port>/?project=<hash>
```

If the preferred port is already owned by another Mindraw project service, the launcher skips that stale service and starts a service for the current project on the next available port.

## Safety Model

- Project canvases are stored under the active workspace's `MindrawCanvas/` directory.
- The plugin never overwrites an existing `.mindraw` package.
- The plugin never handwrites `drawing.excalidraw`, `manifest.json`, `.assets/`, or other `.mindraw` package internals.
- First-run creation uses Mindraw App API `createBlankPackage` when available.
- Sidebar preview uses Mindraw App API `previewSnapshot` when available.
- Desktop handoff uses Mindraw App API `openPackage` when available.
- On macOS, supported LaunchServices fallback is limited to launching Mindraw or the exact latest-created current-project package.
- Sidebar API calls include a project identity hash and fail closed on project mismatch.
- Before a canvas is opened, the Mindraw App judges whether the current project canvas is usable; that result is the only health authority. File names, timestamps, and registry entries are never used as a health substitute.
- Only an App-confirmed `healthy` canvas may be selected automatically. A `repairable` or `invalid` canvas is never silently replaced: the user chooses `修复此画布 / 打开其他可用画布 / 新建画布`, and the chosen action still runs through Mindraw App APIs.

Important blocker codes include:

- `MINDRAW_CANVAS_CREATE_API_REQUIRED`
- `MINDRAW_CANVAS_HEALTH_API_REQUIRED`
- `MINDRAW_CANVAS_HEALTH_RESULT_INVALID`
- `ACTION_REQUIRED_CANVAS_RECOVERY`
- `MINDRAW_PREVIEW_SOURCE_REQUIRED`
- `MINDRAW_PROJECT_CONTEXT_MISMATCH`
- `MINDRAW_PROJECT_CANVAS_SCOPE_MISMATCH`
- `MINDRAW_OPEN_PACKAGE_API_REQUIRED`

## Development Validation

```bash
npm run check
npm run smoke
npm run smoke:http
npm run smoke:lifecycle
npm run smoke:mcp
```

Optional sidebar smoke requires Playwright:

```bash
PLAYWRIGHT_NODE_MODULES=/path/to/node_modules npm run smoke:sidebar
```

Optional plugin validation when the Codex plugin validator is available:

```bash
python3 /path/to/validate_plugin.py plugins/mindraw
```

Optional SkillSpector safety checks:

```bash
skillspector scan plugins/mindraw/skills/mindraw-open-canvas --no-llm --format json --output skillspector-skill.json
skillspector scan plugins/mindraw --no-llm --format json --output skillspector-plugin.json
```

## Release Status

This repository is prepared as a public source candidate. It is not a public release announcement by itself. A public release still requires repository bootstrap, review, QA, binary terms for the Mindraw DMG, release assets, and download smoke evidence.
