# 外部参考源码

拉取日期：2026-10-12。位置：`E:\EDEN\Agent\文档\参考`。

三个仓库均为默认分支的浅克隆，命令使用 `git clone --depth 1 --single-branch`。下表记录本次下载的确定提交，后续更新后应重新登记。

| 项目 | 本地目录 | 上游仓库 | 分支 | 提交 |
|---|---|---|---|---|
| dsh 官方 DeepSeek Harness | [deepseek-harness](deepseek-harness/README.md) | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | `master` | `d743267388641bc76f17c45ce8b4c231aed1d32c` |
| OpenCode | [opencode](opencode/README.md) | [anomalyco/opencode](https://github.com/anomalyco/opencode) | `dev` | `d21b0790a6c146815f28fea604e41e922f009590` |
| pi | [pi](pi/README.md) | [earendil-works/pi](https://github.com/earendil-works/pi) | `main` | `97195ec3c4a40665a9008c3658e67b0782f33b18` |

dsh 使用官方 Harness 仓库；之前 TUI 字标调查引用的 `gxinxing/deepseek-harness-tui` 是另一个社区项目。pi 的原 `badlogic/pi-mono` 地址目前重定向至 `earendil-works/pi`，本次直接使用新地址。

三个仓库均已完成检出，工作树干净，`README.md` 存在；各仓库本地开启 `core.longpaths`。外部源码目录沿用 Eden Agent 已有 Git 忽略规则，只作为本地参考，不登记为项目子模块。未安装依赖、执行上游脚本或修改 Eden 的运行时版本。

既有 [DeepSeek Harness 源码分析](deepseek-harness-分析.md) 对应 2026-09-09 的旧提交；本次下载不自动更新那份分析的结论。

本次三个检出的终端界面范围、核心实现与 Eden 对照见 [dsh、OpenCode 与 pi 的 TUI 源码分析](2026-10-12-dsh-OpenCode-pi-TUI源码分析.md)。其中官方 dsh 当前没有随附交互式 TUI，社区 TUI 不在这三个检出中。
