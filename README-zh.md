# mindraw4agent

Mindraw for Codex agents：用于从当前 Codex 工作区打开 Mindraw 项目画布的 Codex plugin、skill、MCP server 和本地 sidebar preview service。

- 仓库：<https://github.com/17lang/mindraw4agent>
- 作者与主要维护者：张军锋
- 版权持有人：海南万幸科技有限公司
- 本仓库许可证：MIT
- 配套 App 要求：Mindraw `>= 1.2.4`
- 首个公开目标平台：macOS Apple Silicon

本仓库不包含 Mindraw App 源码。Mindraw 桌面 App、DMG、产品名称、商标和二进制分发使用独立的 binary / brand terms；这些条款不等同于本仓库内 agent integration 代码的 MIT License。

## 功能范围

`mindraw4agent` 会把当前 Codex workspace 当作项目根目录，准备或读取 `MindrawCanvas/`，并通过以下入口提供项目级 Mindraw 画布：

- Codex skill：`mindraw-open-canvas`
- MCP stdio server：`mindraw_mcp`
- 本地只读 sidebar preview service
- 显式打开 Mindraw desktop app 的 handoff 路径
- 画布健康检查与故障恢复选择

本插件只选择当前项目内的 project canvas。不读取或发布无关项目目录，不手写 `.mindraw` package internals，本版本也不实现任意 `mindraw://...documentId...elementId...` target-link sidebar entry。

## 兼容性

首个公开源码候选范围：

- Mindraw App `>= 1.2.4`
- 画布健康检查与故障恢复需要 Mindraw App 暴露 `inspect_legacy_canvas_recovery`（`legacyCanvasRecovery` capability）。提供该能力的最低 App 版本尚未核实；本机在 Mindraw `1.3.5` 上已确认存在。
- macOS Apple Silicon
- 支持本地 plugin 安装的 Codex runtime
- 当前项目 `MindrawCanvas/` 下的 project-local canvas package

Windows、Linux、Intel Mac、App Store 分发、自动更新和任意 target-link sidebar entry 不在首发范围。

## 本地安装

公开仓库创建后：

```bash
git clone https://github.com/17lang/mindraw4agent.git
cd mindraw4agent
```

安装本地 marketplace source 和 plugin：

```bash
./scripts/install-local.sh
```

安装脚本只把当前仓库作为 Codex local plugin marketplace source，不安装或修改 Mindraw desktop app。

## 卸载

```bash
./scripts/uninstall-local.sh
```

该命令移除 `mindraw4agent` 对应的 Codex plugin installation 和 local marketplace entry，不删除 Mindraw App，也不删除任何项目里的 `MindrawCanvas/` 文件。

## Doctor

```bash
node scripts/doctor.mjs
node scripts/doctor.mjs --json
```

Doctor 是只读检查：仓库结构、Node runtime、Codex CLI、平台兼容性和 `/Applications/Mindraw.app` 是否存在。

## 使用

在 Codex 中输入：

```text
Open the Mindraw canvas for this project.
```

也可以使用：

```text
Open Mindraw in sidebar for this project.
Open Mindraw app for this project.
Create a new Mindraw project canvas.
Open the latest Mindraw project canvas in the desktop app.
在侧边栏打开这个项目的 Mindraw
在 Mindraw App 中打开这个项目
```

默认路径会启动本地 sidebar preview service，并打印当前项目绑定的 URL：

```text
http://127.0.0.1:<port>/?project=<hash>
```

如果首选端口已被另一个 Mindraw 项目服务占用，launcher 会跳过旧服务，为当前项目启动新的可用端口。

## 安全边界

- 项目画布只放在当前 workspace 的 `MindrawCanvas/` 下。
- 插件不会覆盖已有 `.mindraw` package。
- 插件不会手写 `drawing.excalidraw`、`manifest.json`、`.assets/` 或其他 `.mindraw` package internals。
- 首次创建只通过 Mindraw App API `createBlankPackage`。
- Sidebar preview 只通过 Mindraw App API `previewSnapshot`。
- Desktop handoff 优先通过 Mindraw App API `openPackage`。
- macOS LaunchServices fallback 只允许启动 Mindraw 或当前项目 latest-created package。
- Sidebar API 带 project identity hash；项目不匹配时 fail closed。
- 打开画布前先由 Mindraw App 判断当前项目画布是否可用，该结果是唯一健康权威；文件名、时间戳、registry 记录都不能替代它。
- 只有 App 确认 `healthy` 的画布才会被自动选中。`repairable` 或 `invalid` 时不会悄悄切换，而是让用户在 `修复此画布 / 打开其他可用画布 / 新建画布` 中选择，选定的恢复动作仍走 Mindraw App API。

常见 blocker code：

- `MINDRAW_CANVAS_CREATE_API_REQUIRED`
- `MINDRAW_CANVAS_HEALTH_API_REQUIRED`
- `MINDRAW_CANVAS_HEALTH_RESULT_INVALID`
- `ACTION_REQUIRED_CANVAS_RECOVERY`
- `MINDRAW_PREVIEW_SOURCE_REQUIRED`
- `MINDRAW_PROJECT_CONTEXT_MISMATCH`
- `MINDRAW_PROJECT_CANVAS_SCOPE_MISMATCH`
- `MINDRAW_OPEN_PACKAGE_API_REQUIRED`

## 开发验证

```bash
npm run check
npm run smoke
npm run smoke:http
npm run smoke:lifecycle
npm run smoke:mcp
```

可选 sidebar smoke 需要 Playwright：

```bash
PLAYWRIGHT_NODE_MODULES=/path/to/node_modules npm run smoke:sidebar
```

如本机有 Codex plugin validator：

```bash
python3 /path/to/validate_plugin.py plugins/mindraw
```

如本机有 SkillSpector：

```bash
skillspector scan plugins/mindraw/skills/mindraw-open-canvas --no-llm --format json --output skillspector-skill.json
skillspector scan plugins/mindraw --no-llm --format json --output skillspector-plugin.json
```

## 发布状态

本仓库当前准备为 public source candidate。它本身不是正式公开发布公告。正式公开发布仍需要 GitHub repo bootstrap、review、QA、Mindraw DMG binary terms、release assets 和 download smoke evidence。
