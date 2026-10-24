# M4C 0.3.0

读取Mindraw Frame文字、标注与图像，并将用户批准的生成PNG写回原框右侧。配套Mindraw2.3.0 / Build202610241046，新结果框只显示图片，原需求完整保留。

[中文入门教程](docs/new-user-guide.zh-CN.md)｜[读取合同](docs/frame-read-contract.md)｜[写回合同](docs/frame-image-writeback-contract.md)｜[验收范围](docs/image-writeback-acceptance.md)

需要Apple芯片Mac、Node.js至少20、支持本地插件的Codex及CLI、独立安装的Mindraw。图片生成需聊天另有图片生成能力；插件不附带App二进制。

```bash
git clone --branch release/frame-image-writeback-0.3.0 --depth 1 https://github.com/17lang/mindraw4agent.git
cd mindraw4agent
bash scripts/install-local.sh
```

长期保留安装目录，新建聊天确认read_mindraw_frame和write_mindraw_frame_image均可用。先读取需求、生成图片供确认，再明确授权写回。成功须App返回saved=true。

本机已验证真实原生Agent写回、正式App正常退出冷重开、图片字节一致、单图零文字、原文及几何不变。其他机器/平台与普通ChatGPT网页连接未在本轮验证。工具PNG不是原生窗口截图。MIT仅适用本插件，不授予App二进制和品牌许可。
