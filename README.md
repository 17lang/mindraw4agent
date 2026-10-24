# Mindraw for Agent

M4C 0.2.0 candidate reads a complete Mindraw Frame URL as scoped text, annotation elements and a PNG image. The existing project-canvas sidebar is a separate feature.

## Requirements and installation

macOS Apple Silicon, Node.js 20+, Codex CLI and a matching Mindraw App. This 0.2.0 prerelease has scoped API image evidence against Mindraw 2.2.8 / Build202610240635. A fresh native Codex Agent successfully invoked read_mindraw_frame for two independently saved Frames and described the returned images and annotations. Obtain the companion App independently; this MIT integration release does not distribute or license the App. Older Apps may expose the API without the required images or revisions and will be rejected.

The 0.2.0 candidate source is distributed through the fixed branch below. Public main is an older version; tag/Release publication and final E2E acceptance are tracked separately. The supplied source archive is an alternative.

```bash
git clone --branch release/frame-reader-0.2.0 --depth 1 https://github.com/17lang/mindraw4agent.git
cd mindraw4agent
./scripts/install-local.sh
```

For a supplied candidate archive, extract it and run the same script from its root. Keep the checkout at that location. Open a new Codex chat and verify `mindraw_mcp` exposes `read_mindraw_frame`; installation status alone is insufficient.

If local plugins are unavailable, use `./scripts/install-mcp.sh` instead. Choose either plugin installation or direct MCP registration to avoid duplicate servers. Direct MCP provides tools but not the bundled skill: explicitly ask the Agent to use `read_mindraw_frame`. Paths are resolved from the actual installation directory; re-register after moving it.

## First read

1. Open the intended document in Mindraw and verify its images display.
2. Copy the full Frame URL including documentId, elementId and optional packageFormat.
3. Ask: “Use read_mindraw_frame to read this link; explain the text, annotations and returned image: <URL>”.
4. Verify a real tool call and the matching image, not a filesystem scan. The result includes revisions, dirty state, image metadata and duration.

The tool reads only already-open documents, never launches/switches/edits/saves/repairs them and never acquires a write lease. Active editor content can include unsaved edits. Non-active-tab content is labeled explicitly. Duplicate open document identities fail rather than selecting an arbitrary copy.

## Errors and limits

APP_DOCUMENT_NOT_OPEN: open the document manually. APP_DOCUMENT_AMBIGUOUS: resolve duplicate open identities. TARGET_NOT_FRAME: copy a Frame link. FRAME_IMAGE_UNAVAILABLE or APP_RESOURCE_ADAPTER_REQUIRED: use a compatible App or fix missing document resources; do not accept an incomplete preview. FRAME_CHANGED_OR_SCOPE_UNPROVEN: retry once after content settles, then report the failure. If the tool is absent, verify configuration and open a new chat; do not scan registries/package internals as a fallback.

Only target Frame data is passed to the Agent. PNGs are controlled scene snapshots rather than OS screenshots; exact fidelity for complex drawing features remains limited. See the [contract](docs/frame-read-contract.md).

## Upgrade, rollback and uninstall

Preserve the previous working plugin version, App and document backups. Update from a published fixed tag/archive and rerun the selected installer from the same directory. Start a new chat and verify the paired versions and tools. This installer does not install/quit the App or migrate documents.

To roll back, restore the prior fixed tag/archive and reinstall with a known-compatible App; never write a newer document format with an older App. Plugin uninstall: `./scripts/uninstall-local.sh`. Direct MCP uninstall: `codex mcp remove mindraw_mcp`. Neither removes canvases.

## Development and license

Runtime uses Node standard modules only. `npm run check` and `npm run test:frame` cover syntax and MCP transport/error boundaries; mock tests do not prove live App or Codex image rendering. Existing project-canvas smoke commands remain available.

[Release candidate checklist](docs/release-candidate.md), [MIT License](LICENSE), [Third-party notices](THIRD_PARTY_NOTICES.md). M4C licensing does not grant rights to the separately distributed Mindraw App binary, brand or App source.


---

## Historical project-canvas reference

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
git clone --branch release/frame-reader-0.2.0 --depth 1 https://github.com/17lang/mindraw4agent.git
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

### Tool discovery troubleshooting

Use `codex plugin marketplace list` and `codex mcp list --json` to check local registration. A full `codex plugin list` may wait on remote catalogs; it is not required for installation. Start a new session after installation; existing sessions may retain their tool inventory ([official plugin guide](https://learn.chatgpt.com/docs/plugins)). A visible skill alone does not prove MCP tool availability. Check Node and the installed source path before considering application restart. Do not restart Codex automatically. The locally exercised lifecycle is uninstall, reinstall and same-version repeat installation; older-version migration and final paired-App verification are separate checks.

An early experimental 0.2.0 cache emitted pretty-printed multiline JSON-RPC and timed out during native Codex handshakes. Reinstall the corrected source; refreshing a chat alone cannot repair the old server. The corrected server was discovered by a fresh controlled Codex app-server process, including `read_mindraw_frame`, with no toolsError. This is inventory proof, not final paired-App image acceptance.


2026-10-24 verification update: installed Mindraw 2.2.8 / Build202610240635, runtime source 669f243 (delivery record 90ae265). Explicitly scoped App reads of isolated copies of both original Frames returned full PNGs with matching revisions. After a normal App Save As created an independent identity, a fresh native Agent called read_mindraw_frame twice and successfully consumed text, images and annotations. Preserve unknown unsaved windows; do not close or save them to unblock testing. Saved-Frame native image integration is verified; in-Frame unsaved edits and real missing-image cases remain untested.
