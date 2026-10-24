# M4C 新用户入门教程

修订1｜2026-10-24｜适用：macOS Apple Silicon + Codex 本地插件。

## 当前发布状态

M4C0.3.0通过release/frame-image-writeback-0.3.0分支提供，支持读取Frame和批准后的图片写回。已与Mindraw2.3.0 / Build202610241046完成本机集成及正常退出冷重开验证。main仍是旧版本。源码不包含Mindraw安装包。

## 一、需要安装什么

1. Mindraw 桌面 App：负责打开画布、管理图片和保存文档。由 Mindraw 提供方取得安装包。图片写回本轮验证版本为2.3.0 / Build202610241046，不能仅凭版本号推断任意旧构建兼容。
2. Codex：负责理解你的要求和调用工具。按官方指引安装并登录能使用 Codex 的账号。此教程不等同于普通 ChatGPT 网页版连接教程。
3. Node.js：安装仍受支持的 LTS，版本至少20；插件运行需要它。
4. M4C 插件：让 Codex 调用你本机的 Mindraw。
5. 若使用下面的源码安装方式，还需要 Git。Mac 首次运行 git 可能提示安装 Apple 命令行工具，按系统提示完成。

只有文生图才另外需要当前聊天具备可用的图片生成能力；M4C 本身不生成图片，也不附送图片生成额度。读取 Frame 不需要额外图片生成服务，也无需给 M4C 配置独立 API Key。

## 二、先装好基础软件

安装 Mindraw 后打开它，确认能创建、保存并重开一个文档。文件夹访问提示出现时，为你选定的工作目录允许访问。

按官方 Codex 文档安装 Codex 并登录。若电脑已有 npm，可在“终端”中输入：

```bash
npm install -g @openai/codex
```

检查基础命令：

```bash
node --version
codex --version
git --version
```

这三条都应显示版本号；Node 主版本至少20。出现“command not found”表示对应软件尚未装好。

官方安装说明：https://learn.chatgpt.com/docs/codex/cli

## 三、安装 M4C 0.3.0

在终端逐行输入。目录应长期保留，不放在临时目录中；如果已存在同名文件夹，不要覆盖，先确认旧安装位置。

```bash
mkdir -p ~/M4C
cd ~/M4C
git clone --branch release/frame-image-writeback-0.3.0 --depth 1 https://github.com/17lang/mindraw4agent.git
cd mindraw4agent
bash scripts/install-local.sh
```

脚本会注册本地插件来源并安装插件，不安装 Mindraw App。完成后新建 Codex 聊天，输入：

> 请检查 M4C 的 read_mindraw_frame 工具是否实际可用。先不要修改文档。

成功标准是聊天中实际能发现该工具，仅看到“已安装”还不够。暂不支持本地插件的 Codex 可用 `bash scripts/install-mcp.sh` 注册直接 MCP；两种方式二选一，避免重复注册。直接 MCP 不附带技能指引，使用时明确工具名。

## 四、第一次读取画框

1. 在 Mindraw 中新建文档，放一个 Frame，在框内输入几行文字，也可以放图片。
2. 保存文档，保持文档在 App 中打开。
3. 复制这个 Frame 的完整链接。链接形如 `mindraw://localhost?...`，包含 documentId、elementId 和 packageFormat；不要自己改链接。
4. 在 Codex 粘贴链接并说：

> 请用 read_mindraw_frame 读取下面这个 Frame，结合文字和返回图片说明框内内容。先不要改动文档：
> （粘贴完整 Frame 链接）

成功应看到真实工具调用，并得到框内文字和图像的说明。只说明了链接字符串不算成功。不要让 Agent 自己寻找 .fileassets 或扫描文档包来代替工具。

## 五、图片生成和写回

确认安装0.3.0，新聊天内read_mindraw_frame和write_mindraw_frame_image均出现，并使用配套Mindraw2.3.0（已验证Build202610241046）。旧0.2.0只能读取。聊天还需具备图片生成能力。

操作顺序：

1. 在原 Frame 写下要求并保存，例如“红色小机器人、浅蓝背景、手拿黄色星星、正方形、卡通、不要文字”。
2. 把完整 Frame 链接发给具备图片生成能力的 Codex 聊天：

> 请先读取这个 Frame，再按要求生成一张图片给我确认。暂时不要写回：
> （完整链接）

3. 看图满意后说：

> 图片符合要求，请把刚才这张生成图片放进原 Frame 右侧的新结果 Frame。新框内只放图片，原框和需求文字完整保留，并保存。

4. Agent 应读取最新修订并调用 `write_mindraw_frame_image`。图片路径、修订号和稳定写入编号由 Agent 处理，你无需手填。
5. 成功应有 App 的 `saved=true` 回执。回到 Mindraw 检查原框未变，右侧新框内只有图片。
6. 确认其他文档也已妥善保存后，正常退出并重开同一文件，检查图片仍在。

如果聊天没有图片生成工具，可以先由其他工具生成 PNG，再明确提供这张图片并授权写回；这属于替代流程，本轮已验证的是内置生成图片后的写回。

## 六、遇到问题怎么处理

| 现象 | 怎么办 |
|---|---|
| 工具没出现 | 检查安装是否成功；新建聊天。插件和直接MCP不要重复安装 |
| 提示文档未打开 | 在同一台电脑的 Mindraw 打开对应文档 |
| 提示同身份文档不明确 | 检查是否打开了多个同身份副本，自己确认并处理，不让Agent猜选 |
| 提示文档未保存或正在保存 | 先在App检查并自行保存，完成后重新读取再试 |
| 提示缺图或App不兼容 | 检查App能否显示原图及是否配套，不接受缺图的“成功” |
| 写回结果未知 | 不要换个编号盲目重试；先检查App是否已出现结果，避免重复创建 |
| 系统出现文件夹访问提示 | 对你准备使用的目录完成允许；若没有提示仍卡住，保留现场反馈 |

首次体验建议用测试文档。读取、生成图片、写回是三个独立步骤：你可以只读取，也可以先生成确认，满意后再授权写回。

## 七、卸载

在当初安装插件的源码目录运行：

```bash
bash scripts/uninstall-local.sh
```

若选择的是直接 MCP 注册，则用 `codex mcp remove mindraw_mcp`。卸载插件不会删除 Mindraw App 或你的画布文件。
