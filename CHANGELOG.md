# Changelog

All notable changes to `mindraw4agent` will be documented in this file.

## 0.1.4 - 2026-09-24

- Added canvas health checking: before a canvas is opened, the Mindraw App decides whether the project canvas is `healthy`, `repairable`, or `invalid`, and only a `healthy` canvas may be selected automatically.
- Added explicit failure recovery: when the preferred canvas is `repairable` or `invalid`, the plugin offers `修复此画布 / 打开其他可用画布 / 新建画布` instead of silently switching to another canvas.
- Added the `recover_mindraw_project_canvas` MCP tool, the matching sidebar recovery route, and the corresponding open-canvas skill instructions and lifecycle checks.
- Added health and recovery blocker codes: `MINDRAW_CANVAS_HEALTH_API_REQUIRED`, `MINDRAW_CANVAS_HEALTH_RESULT_INVALID`, `MINDRAW_CANVAS_HEALTH_CONFIRMATION_REQUIRED`, `MINDRAW_CANVAS_REPAIR_API_REQUIRED`, `MINDRAW_CANVAS_REPAIR_FAILED`, `ACTION_REQUIRED_CANVAS_RECOVERY`, `CANVAS_HEALTHY_SELECTION_REQUIRED`, `CANVAS_RECOVERY_ACTION_INVALID`, `CANVAS_RECOVERY_NOT_REQUIRED`, `CANVAS_RECOVERY_FAILED`, `CANVAS_REPAIR_NOT_AVAILABLE`.
- Kept `scripts/doctor.mjs`, the install-environment self-check, from 0.1.3 in both the repository root and `plugins/mindraw/`, still wired into `npm run check`.
- Kept `PLAYWRIGHT_NODE_MODULES` as the only external Playwright lookup path, so no machine-local absolute path ships in plugin source.

## 0.1.3 - 2026-07-11

- Prepared the first GitHub-ready public source candidate for `17lang/mindraw4agent`.
- Preserved the reviewed M4C `0.1.3+codex.20260708220005` behavior.
- Added project-scoped sidebar service isolation to prevent stale fixed-port cross-project canvas reuse.
- Added first-run Mindraw App launch / create retry behavior from the prior reviewed candidate line.
- Added public README, Chinese README, MIT license, security policy, contributing guide, third-party notices, local install/uninstall scripts, doctor script, and CI validation.
- Fixed the local Codex marketplace layout so the public repository root exposes `mindraw` from `./plugins/mindraw`.

This changelog covers the MIT-licensed agent integration source only. Mindraw App binaries and DMG distribution use separate release notes and terms.
