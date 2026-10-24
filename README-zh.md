# Mindraw for Agent

M4C 0.2.0 候选：把 Mindraw Frame 链接直接交给 Agent，读取框内文字、标注与图像。插件也保留原有项目画布侧栏入口；两者是不同能力。

## 安装前

- macOS Apple Silicon；Node.js 20 或更新版本、可用的 Codex CLI。
- 本次0.2.0预发行已对Mindraw 2.2.8 / Build202610240635取得定向接口图文证据；原生Agent已调用专用工具，但成功图像消费仍被重复打开文档身份阻塞，整体验收未完成。
- Mindraw App须独立取得；本MIT插件发行不包含或授予App二进制/品牌的额外许可。旧App可能缺图片或修订证据，工具会拒绝，不能只按版号大小推断兼容。历史试验2.3.0不是最低支持版本。

## 安装插件

0.2.0候选源码使用下列固定分支分发，公开main仍为旧版本；tag/Release及最终图文验收另行记录。也可使用交付源码归档解压安装。

```bash
git clone --branch release/frame-reader-0.2.0 --depth 1 https://github.com/17lang/mindraw4agent.git
cd mindraw4agent
./scripts/install-local.sh
```

使用本地候选时先解压提供的 M4C 源码归档，进入解压后的目录运行同一脚本。保持该目录可用，不将它放进会被自动清空的临时目录。

完成后新建一个 Codex 聊天，确认 `mindraw_mcp` 下可发现 `read_mindraw_frame`；仅显示“插件已安装”不等于工具可调用。Frame 技能和项目画布技能随插件一同提供。

若当前 Codex 不支持本地插件，可改用直接 MCP 注册：

```bash
./scripts/install-mcp.sh
```

直接注册只安装工具，不自动安装技能；请在请求中明确“用 read_mindraw_frame 读取下面的链接”。插件和直接 MCP 二选一，避免重复同名服务。安装脚本按实际解压位置生成配置，没有维护者电脑的固定路径；移动源码目录后需重新注册。

## 第一次读取

1. 在 Mindraw App 中打开目标文档，确认图片正常显示。
2. 复制目标 Frame 链接，保留完整的 documentId、elementId 及 packageFormat。
3. 在新 Codex 聊天中说：`请用 read_mindraw_frame 读取这个 Frame，结合文字、标注和返回图像说明：<完整链接>`。
4. 确认实际调用该工具，并能看到框内标注文字和对应截图。结果包含工作修订、dirty 状态和图像 SHA256；无需手动定位文件包。

工具只读取已经打开的文档，不启动 App、不切换文档、不保存、不申请写租约。非活动标签会标明从标签内存读取；活动编辑器可读取未保存内容。多个已打开副本使用同一 documentId 时明确拒绝，不自动猜选。

## 错误与边界

- APP_DOCUMENT_NOT_OPEN：先在 App 打开目标文档，再重试。
- APP_DOCUMENT_AMBIGUOUS：处理重复打开的同身份副本，不能按路径或修改时间猜选。
- APP_RESOURCE_ADAPTER_REQUIRED / FRAME_IMAGE_UNAVAILABLE：图像不完整；升级配套 App 或检查文档资源，不应接受缺图结果。
- TARGET_NOT_FRAME：链接对象不是 Frame；重新复制正确链接。
- FRAME_CHANGED_OR_SCOPE_UNPROVEN：读取期间画框变化或无法证明范围；内容稳定后重试一次，仍失败则报告错误。
- 工具不可发现：核对安装/注册结果，打开新聊天再检查；不要让 Agent 扫描注册表、revisions 或 .fileassets 兜底。

仅目标 Frame 内容交给 Agent，框外文字/图像不用于回答。PNG 来自 App 受控场景快照，不是操作系统截图；复杂绘图的精确像素保真仍有限。任务涉及严格视觉比对时应保留这一限制。

## 升级、回退与卸载

升级前保留当前可用插件版本、原 App 和文档备份；退出旧 App 的时机由用户自己决定。本插件升级不执行 App 安装、不退出 App、不升级或改写文档。

从正式发布的固定 tag/归档更新源码，在同一目录再次运行所选安装脚本；新聊天确认工具及配套版本。不要把开发分支或尚未发布的候选称为稳定版。

回退时切回上一固定 tag/归档并重新安装插件，配套使用已验证的 App；不要用旧 App 写回新格式文档。插件卸载：`./scripts/uninstall-local.sh`；直接 MCP 卸载：`codex mcp remove mindraw_mcp`。这些操作不删除画布。

## 开发、许可与交付

Node 标准库运行，无 npm 运行时依赖。`npm run check` 与 `npm run test:frame` 验证语法和只读 MCP 运输/错误边界；mock 结果不证明真实 App 或 Codex 图像显示。原项目画布 smoke 入口继续保留。

[Frame 接口合同](docs/frame-read-contract.md)、[发布候选清单](docs/release-candidate.md)、[MIT License](LICENSE)、[第三方说明](THIRD_PARTY_NOTICES.md)。M4C 许可不授予 Mindraw App 二进制、品牌或 App 源码的额外权利；App 许可须独立明确。


---

## Historical project-canvas reference

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

本插件只选择当前项目内的 project canvas。不读取或发布无关项目目录，不手写 `.mindraw` package internals，本版本的 Frame 读取工具与任意 target-link sidebar entry 分开；后者仍不在范围内。

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
git clone --branch release/frame-reader-0.2.0 --depth 1 https://github.com/17lang/mindraw4agent.git
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

## 工具未出现时的分层核对

1. `codex plugin marketplace list` 应列出 mindraw4agent；`codex mcp list --json` 应包含 enabled 的 mindraw_mcp。不要用可能等待远端目录的 `codex plugin list` 作为安装成功的唯一依据。
2. 已运行的聊天可能保留安装前的工具清单。先开启新会话；技能可见不代表 MCP 工具已加载。见[官方插件说明](https://learn.chatgpt.com/docs/plugins)。无需为此主动退出整个 Codex。
3. 若握手报约30秒超时，先更新并重装插件：早期0.2.0试验缓存曾输出多行JSON，已修正为每行一条消息；仅改聊天刷新无法修复旧服务器。若新会话仍无工具，检查 Node 版本及插件路径能否访问。直接 MCP 注册与插件模式二选一；查看启动错误，区分配置、进程启动与聊天清单问题。
4. `read_mindraw_frame` 已实际出现后再粘贴链接；仅配置存在、stdio 单测通过或技能出现均不足以认定真实 App 图文通信成功。当前已测试的安装生命周期是本机卸载、恢复安装及同版本重复安装；不同历史版本升级、其他机器与最终配套 App 需对应证据。


2026-10-24现场复核：已安装Mindraw 2.2.8 / Build202610240635，主开发源669f243（版本记录90ae265）。两个原Frame隔离副本的定向App接口已返回完整图文且修订一致；原生Agent已调用专用工具，但当前重复打开同documentId触发APP_DOCUMENT_AMBIGUOUS，完整聊天图像消费仍未通过。不得关闭或代保存未知未保存窗口。最终兼容验收仍待此场景解除后复验；插件源码可按预发行方式分发并披露该阻断。
