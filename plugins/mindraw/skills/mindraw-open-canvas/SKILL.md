---
name: mindraw-open-canvas
description: Open the Mindraw canvas for this project. Use when the user asks to open, view, inspect, or edit the Mindraw project canvas from Codex.
---

# Mindraw Project Canvas

Open the project-scoped Mindraw canvas from the active Codex workspace.

## Trigger

Use this skill when the user says:

- `Open the Mindraw canvas for this project.`
- `Open Mindraw in sidebar for this project.`
- `Open Mindraw app for this project.`
- `在侧边栏打开这个项目的 Mindraw`
- `在 Mindraw App 中打开这个项目`
- Open the current project Mindraw canvas.
- Show the project canvas in Mindraw.
- Create a project Mindraw canvas.

## Procedure

1. Treat the active Codex workspace directory as `projectRoot`; do not use the plugin directory as the project root.
2. Prefer the `mindraw_mcp` server tool `inspect_mindraw_project_canvas` to inspect or create `projectRoot/MindrawCanvas/` through Mindraw's approved App API. On macOS, if no canvas exists and the runtime capability file is unavailable, the plugin may cold-launch Mindraw, wait for `createBlankPackage`, and retry the App API.
3. Route the request by explicit open location:

   - Sidebar preview: `Open Mindraw in sidebar for this project.` and `在侧边栏打开这个项目的 Mindraw`.
   - Mindraw desktop app: `Open Mindraw app for this project.` and `在 Mindraw App 中打开这个项目`.
   - Compatibility/default sidebar preview: `Open the Mindraw canvas for this project.`.

4. For sidebar preview and compatibility/default requests, always start the local read-only sidebar preview service and expose its URL. Desktop handoff alone is not a valid result for these triggers.
5. Run `scripts/start-canvas.sh` from this plugin with the project root and keep the service running:

   ```bash
   ./scripts/start-canvas.sh "/absolute/project/root"
   ```

6. Open the printed project-scoped `http://127.0.0.1:<port>/?project=<hash>` URL in the Codex browser/sidebar when available, and include the URL, `projectRoot`, `MindrawCanvas/` directory, status, and any blocker in the response. If browser opening is unavailable, still return the clickable URL and state. If the preferred local port belongs to another Mindraw project service, use the newly printed URL instead of reusing the old port.
7. For Mindraw desktop app requests, call `open_mindraw_project_canvas` after inspect/create. Only an App-confirmed `healthy` canvas may be handed off through `openPackage`. If the state is `ACTION_REQUIRED_CANVAS_RECOVERY`, present the explicit choices `修复此画布 / 打开其他可用画布 / 新建画布` and use `recover_mindraw_project_canvas` only after the user chooses; never infer a choice from timestamps or registry entries. App requests do not need to start or return the sidebar preview URL.
8. Call `open_mindraw_project_canvas` for sidebar requests only when the sidebar's `编辑` button / preview double-click path is invoked, or when the user explicitly asks to edit/open in the Mindraw desktop app.
9. For sidebar preview, expect the page to poll `/api/state`, reload `/api/preview` with a project identity token plus revision cache-buster, and expose a manual refresh control. If Mindraw cannot prove a fresh preview source or the sidebar belongs to another project service, the sidebar must show a visible blocker instead of a stale image.
10. If `编辑` or preview double-click opens Mindraw but focus/frontmost status is not confirmed, tell the user that the package was handed off and they may need to switch to Mindraw or another macOS Space. Treat this as actionable feedback, not a silent no-op.
11. Report blockers exactly. Do not convert them into a generic failure:

   - `PROJECT_ROOT_NOT_FOUND`: The active Codex workspace directory is not reachable.
   - `PROJECT_ROOT_NOT_DIRECTORY`: The active Codex workspace is not a directory.
   - `CANVAS_DIR_NOT_DIRECTORY`: `MindrawCanvas` already exists but is not a directory. Do not delete or overwrite it.
   - `CANVAS_SEQUENCE_EXHAUSTED`: Today's `YY.MMDD-01..99.mindraw` sequence is exhausted. Do not wrap or overwrite.
   - `MINDRAW_CANVAS_CREATE_API_REQUIRED`: Mindraw createBlankPackage capability is unavailable after any supported launch / retry path. Do not handwrite package internals.
	   - `MINDRAW_PREVIEW_SOURCE_REQUIRED`: Mindraw previewSnapshot capability did not return a complete read-only preview artifact.
	   - `MINDRAW_PROJECT_CONTEXT_MISMATCH`: The sidebar URL or API request belongs to another project canvas service. Reopen the sidebar for the active project and use the newly printed URL.
	   - `MINDRAW_OPEN_PACKAGE_API_REQUIRED`: Mindraw openPackage desktop handoff and any supported macOS LaunchServices fallback are unavailable on this platform or environment.
	   - `MINDRAW_CANVAS_HEALTH_API_REQUIRED`: Mindraw has not exposed the required `inspect_legacy_canvas_recovery` read API. Do not use package names, timestamps, the registry, or preview files as a replacement health check.
	   - `ACTION_REQUIRED_CANVAS_RECOVERY`: The preferred canvas is repairable or invalid. Do not silently open another canvas; show the three recovery choices.
   - Registry warnings such as `REGISTRY_JSON_INVALID`, `REGISTRY_ENTRY_STALE`, and `REGISTRY_ENTRY_OUTSIDE_CANVAS_DIR` mean the plugin recovered by trusting only current project-local `MindrawCanvas/` packages.

## Safety Rules

- Do not write `drawing.excalidraw`, `manifest.json`, `.assets/`, or any other `.mindraw` package internals.
- Do not overwrite an existing `.mindraw`.
- Do not silently edit a user project's `.gitignore`.
- Keep project canvas selection project-scoped. Treat the registry only as a preference record; the App `inspect_legacy_canvas_recovery` result is the usability authority.
- Do not reuse a stale sidebar URL from another project. The preview URL must carry the current project identity token, and `编辑` / double-click must fail closed on project mismatch.
- Do not expose bearer tokens, loopback endpoints, runtime capability file paths, raw image bytes, private keys, or `.assets` physical implementation details.
- The preview URL is the only loopback value that may be shown to the user for opening the local sidebar.
- The sidebar preview is read-only. Editing must hand off to Mindraw desktop.
- If Mindraw still lacks the required create, health, or preview API after supported launch / retry, return the blocker and stop; do not fake a working canvas. For open/edit handoff, macOS LaunchServices fallback is allowed only after the App has confirmed the target canvas is healthy.
