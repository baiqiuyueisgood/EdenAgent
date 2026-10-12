# dsh、OpenCode 与 pi 的 TUI 源码分析

分析日期：2026-10-12。范围是本次拉取的三个确定提交，以及 Eden 当前 `Server/tui` 的对应实现。本轮阅读源码和文档，没有安装上游依赖、运行 TUI、构建或执行测试。下文的行为来自静态代码，设计取舍是据此作出的判断，不代表性能基准或实际终端验收。

同日后续：用户要求开始优化后，已落实输入失败恢复、有界断线重连、工具结果与本轮状态展示，并完成专项测试和独立构建。下文“Eden 当前”描述保留分析时的基线；最新实现和验收范围以 [TUI 优化实施记录](../技术/ts-migration/实施记录/2026-10-12-TUI交互恢复与状态展示优化.md) 为准。主题、审批格式、持久化历史及 Markdown / 长历史增强尚未完成。

## 版本与范围

| 项目 | 检出版本 | 分支与提交 | 实际分析入口 |
|---|---|---|---|
| 官方 dsh | CLI `0.2.1-alpha.2` | `master` / `d743267388641bc76f17c45ce8b4c231aed1d32c` | `apps/cli`、profile 模板、客户端包目录；当前没有随附交互式 TUI |
| OpenCode | TUI `2.0.26` | `dev` / `d21b0790a6c146815f28fea604e41e922f009590` | `packages/tui`，主要分析完整界面；另有 `mini` 入口 |
| pi | TUI、coding-agent `1.1.0` | `main` / `97195ec3c4a40665a9008c3658e67b0782f33b18` | `packages/tui` 与 coding-agent 的 interactive 组件 |

仓库来源与检出方式见 [参考源码记录](README-参考源码.md)。Eden 当前 `packages/runtime-pi` 的 pi-agent-core / pi-ai 仍固定为 `0.82.0`，不能把本次参考的 `1.1.0` 接口当作现有依赖接口。本轮没有升级依赖。

## 官方 dsh：当前是启动器与可组合宿主，没有随附 TUI

`apps/cli/src/bin.ts` 负责分派 profile 启动、插件管理、配置导出和 schema 导出。它没有对话布局、交互编辑器或终端消息组件。`PROFILE_TEMPLATES` 随附的是 `acp`、`web`、`headless`、`sdk`、`sdk-minimal`；按需官方 bundle 清单也没有 TUI。`packages/client` 明确是 Web GUI 的浏览器侧实现。

CLI 文档中的 `dsh --profile tui --resume <id>` 明确以“已安装 tui profile”为前提，是外部应用参数透传的例子。`headless` 的一次任务、打印最终答案和退出，也不能等同于完整交互式 TUI。目录中的 terminal / bash 包提供终端执行能力，不能因为名称中有 terminal 就把它们当作聊天界面。

此前字标调查涉及的 `gxinxing/deepseek-harness-tui` 是独立社区仓库，没有包含在本次三个检出中。这份报告不评价它的界面或实现，也不把历史文档中被移除的 TUI 记录当作当前实现。

dsh 可供 Eden 参考的是宿主和表现层的组合方式：启动器选择配置，客户端连接、状态、快捷键、主题和界面 slot 分别由包提供。这个结构有利于添加新的客户端，但不是可直接采用的终端组件库。对于 Eden，保留 TUI 的独立客户端身份比复制 dsh 的整套 Cordis 装配更有价值。

证据：[CLI 入口](deepseek-harness/apps/cli/src/bin.ts)、[CLI 说明](deepseek-harness/apps/cli/README.zh.md)、[profile 模板](deepseek-harness/packages/boot/app-boot/src/profile.ts)、[按需 bundle 清单](deepseek-harness/packages/boot/app-boot/src/official-bundle-packages.ts)、[浏览器客户端目录](deepseek-harness/packages/client/README.zh.md)。

## OpenCode：带会话导航和分栏的终端工作台

### 入口、布局与状态

当前完整 TUI 已独立到 `packages/tui`，不是旧版 `packages/opencode/src/cli/cmd/tui` 目录。入口导出 `app.tsx` 的 `run`，使用 OpenTUI 渲染器、Solid 组件和响应式状态。`run` 创建 API 客户端、终端渲染器及各类 Provider，并在退出时清理资源。渲染配置的目标帧率为 60；这只是配置，不是本轮测得的刷新性能。

首页把 Logo 和最大宽度 75 列的输入区居中。会话页则由 `SessionFrame` 协调聊天、侧栏、终端和插件面板；右侧区域有焦点切换、鼠标拖动调宽和布局持久化。会话标签支持不同宽度下的布局，聊天区和辅助区有最小宽度约束。它适合同时查看对话、终端和辅助信息，界面状态也比单一对话栏复杂。

`ClientProvider` 管理客户端连接和事件，`DataProvider` 使用共享 `@opencode/client/solid` 数据层，再由组件读取会话、模型、审批和消息。服务端状态、局部展开状态和输入草稿分别管理，避免把全部状态堆进一个终端循环。

### 输入框是值得重点参考的部分

输入内容不仅是字符串，还包括文件、角色、技能和粘贴文本的结构化引用。补全组件提供命令和引用选择；编辑器的 extmark 与引用数据保持关联。主输入支持普通对话和 shell 模式，并区分 steer 与 queue 提交。

提交前先读取编辑器实际文本，处理 IME 的最后一次组合输入，再同步引用。真正发起异步请求前先保存输入快照并清空编辑器；请求期间新输入不会被旧请求覆盖，失败时只在当前编辑器仍为空的情况下恢复旧内容。这类细节比增加更多快捷键更能改善日常使用。

草稿有两个不同层次，不能混为一谈：

- `draft-stash.ts` 的每标签页即时草稿保存在内存，解决输入组件重新挂载时的恢复，不等于重启后自动恢复。
- `prompt/history.tsx` 和 `prompt/stash.tsx` 分别持久化历史输入与显式暂存，使用 JSONL、去重或容错解析、50 条保留上限。

Eden 可以借鉴这些生命周期设计，同时按账号与世界划分存储，避免伊甸园和尘世共用敏感输入历史。

### 消息、工具和审批

回答文本使用流式 Markdown 组件，支持代码样式和表格布局。思考块在隐藏模式下维持紧凑的一行，用户展开后查看正文，并在完成时显示思考耗时。工具按 shell、read、edit、subagent 等类型选择专门展示，未知工具仍有通用展示。

审批会从请求及其来源工具取得命令、文件、差异等展示信息。修改文件时可以显示 diff；“总是允许”只有请求提供可保存范围时才出现，切换到它时展示授权范围。拒绝子会话请求还可填写反馈。这种展示把用户需要判断的操作和授权范围放到前面，比直接展示参数 JSON 更容易理解。

### 长会话、连接、主题与扩展

长会话先挂载末尾内容，向上滚动再补挂载或加载历史，并补偿滚动位置。它不是每次打开会话就把所有消息组件全部挂载，也不能把这点描述成已经实测的无限列表性能。

共享连接层持续订阅事件，约 10 ms 合并投递；断开后进入 reconnecting，通常以 1 秒间隔重试，并用 45 秒无字节活动超时识别挂起连接。重新连接后，会话页重新同步会话、审批和表单。这是事件流恢复机制，不是每隔几秒重新建立健康连接。

主题支持 dark / light、语义颜色和语法样式，区分普通文字、反馈、控件和操作状态。插件通过命名 slot 和 route 扩展界面，渲染异常由 ErrorBoundary 限制在插件区域；这只能防止界面异常扩散，不代表权限或进程隔离。Storybook 中有实际组件夹具，可作为后续宽窄终端和交互验收的组织方式参考；本轮没有运行这些夹具。

证据：[入口](opencode/packages/tui/src/app.tsx)、[首页](opencode/packages/tui/src/routes/home.tsx)、[分栏](opencode/packages/tui/src/component/session-frame.tsx)、[布局约束](opencode/packages/tui/src/ui/layout.ts)、[客户端](opencode/packages/tui/src/context/client.tsx)、[数据适配](opencode/packages/tui/src/context/data.tsx)、[输入](opencode/packages/tui/src/component/prompt/index.tsx)、[内存草稿](opencode/packages/tui/src/component/prompt/draft-stash.ts)、[历史](opencode/packages/tui/src/prompt/history.tsx)、[暂存](opencode/packages/tui/src/prompt/stash.tsx)、[消息块](opencode/packages/tui/src/routes/session/message-parts.tsx)、[审批](opencode/packages/tui/src/routes/session/permission.tsx)、[会话滚动](opencode/packages/tui/src/routes/session/index.tsx)、[连接恢复](opencode/packages/client/src/solid/connection.ts)、[主题](opencode/packages/tui/src/context/theme.tsx)、[扩展边界](opencode/packages/tui/src/plugin/render.tsx)。

## pi：可组合终端组件与紧凑的对话界面

### 终端库和智能体应用分开

`packages/tui` 提供渲染、输入、布局、焦点、滚动和组件；`packages/coding-agent` 再提供回答、工具、模型选择、状态栏等应用组件。组件契约很小：按终端宽度返回字符串行数组，提供缓存失效方法，并可选处理键盘和鼠标。宽度按可见终端列计算，不按字符串长度计算。

当前有共享 `TUI` 接口下的两种实现：

| 模式 | 屏幕与滚动归属 | 交互特点 |
|---|---|---|
| `regular` / `TuiMainScreen` | 普通终端屏幕和终端滚动历史 | 鼠标主要交给终端；内容变化时刷新发生变化的行段 |
| `fullscreen` / `TuiAltScreen` | 应用自己的备用屏幕视口 | 应用处理滚动、选择、搜索、鼠标和覆盖层，更新发生变化的视口行 |

coding-agent 的 `SETTINGS_DEFAULTS.tuiMode` 当前为 `fullscreen`。库 README 的快速示例创建 `TuiMainScreen`，不能据此推断应用默认仍为 regular。全屏默认退出输出配置为 transcript；退出备用屏幕后，可将最终文档输出到普通终端历史。

### 增量渲染与缓存

渲染请求合并，普通更新使用约 16 ms 的最小间隔，强制更新可抢占等待。两个渲染器使用 CSI 2026 同步输出；主屏幕寻找首尾变化行，全屏比较视口行，同时处理终端尺寸、光标和图片区域。

Markdown 使用词法 token 和终端行布局，不仅靠一组正则处理 Markdown。输出按内容和宽度缓存，解析 token 用 WeakRef 暂存；主题变化时需要使带颜色的布局失效。流式代码围栏还会处理未完成的闭合标记。可参考这些分层与失效规则，但没有证据可以把它们直接换算成 Eden 的性能提升比例。

### 输入、焦点与组件扩展

`CustomEditor` 基于通用 Editor 增加应用动作，快捷键通过 KeybindingsManager 分派。中断键在补全打开时先交给补全取消，退出键在输入为空时才退出；普通编辑动作继续由基础编辑器处理。这个输入所有权顺序可以避免菜单、编辑器和应用同时响应同一个按键。

焦点与光标标记一起传递，文档明确要求包裹输入框的组件继续传递 focused，否则中日韩 IME 候选窗可能出现在错误位置。覆盖层还拥有明确的焦点、隐藏、关闭和销毁生命周期。

应用扩展可选择标准对话框、通知、状态、输入区附近的 widget，或者自定义 header / footer / editor / overlay。组件应使用现有 TUI，不应启动第二个终端渲染器争用 stdin/stdout。

### 回答、工具与状态栏

回答组件按文本和思考块顺序显示，支持思考展开，以及截断、取消和错误提示。工具组件区分参数是否完整、是否已开始执行、部分结果与最终结果，并向自定义 renderCall / renderResult 传递这些状态；自定义渲染失败会退回通用展示。已渲染的组件可以通过 lastComponent 复用，而不是每个增量都重新创建全部内容。

不要把 `FALLBACK_PREVIEW_LINES = 10` 理解为所有工具输出都限制十行：它用于特定的结果回退路径，没有 renderer 的通用工具路径另有直接格式化逻辑。图片能力也取决于终端和模式，不能描述为所有终端都支持。

Footer 展示工作目录、Git 分支、会话名称、累计 token / 成本、上下文占用、模型与思考级别、扩展状态，并根据宽度截断。统计按会话、叶节点、条目数和模型缓存，避免每帧反复扫描整个会话。可借鉴的是信息优先级、计算缓存与宽度退化规则，不是把所有统计都挤进固定一行。

主 interactive 应用组件直接使用 AgentSession，例如 footer 通过 session 获取统计。另有 `experimental/client-tui.ts`，它属于实验路径。本轮没有完整分析该实验协议，不能用它证明主 interactive 已完全变成服务端分离客户端。Eden 的 TUI 应继续从自己的 RPC 接收这些数据，不应因采用 pi 的界面思路而在 TUI 中创建 AgentSession 或执行工具。

证据：[组件与 TUI 契约](pi/packages/tui/src/tui.ts)、[主屏幕](pi/packages/tui/src/tui-main-screen.ts)、[备用屏幕](pi/packages/tui/src/tui-alt-screen.ts)、[模式组装](pi/packages/coding-agent/src/modes/interactive/tui-renderer.ts)、[应用默认值](pi/packages/coding-agent/src/core/settings-defaults.ts)、[Markdown](pi/packages/tui/src/components/markdown.ts)、[应用编辑器](pi/packages/coding-agent/src/modes/interactive/components/custom-editor.ts)、[回答组件](pi/packages/coding-agent/src/modes/interactive/components/assistant-message.ts)、[工具组件](pi/packages/coding-agent/src/modes/interactive/components/tool-execution.ts)、[Footer](pi/packages/coding-agent/src/modes/interactive/components/footer.ts)、[UI 扩展文档](pi/packages/coding-agent/docs/tui.md)、[实验客户端入口](pi/packages/coding-agent/src/experimental/client-tui.ts)。

## 与 Eden 对照

| 方面 | OpenCode | pi | Eden 当前与可借鉴方向 |
|---|---|---|---|
| 布局 | 标签、聊天、侧栏、终端、面板 | 对话、编辑器、状态栏与覆盖层 | 已有居中主列和可选侧栏；以此继续完善，不急于扩成多窗格工作台 |
| 输入 | 引用、补全、异步快照、历史和显式暂存 | 通用 Editor + 应用动作、明确焦点所有权 | 已有多行、粘贴和补全；优先完善输入生命周期、历史恢复与快捷键配置 |
| 消息 | 专门工具展示、流式 Markdown、分段挂载 | 独立回答和工具组件、渲染缓存 | 现有 Markdown 是有限子集；适合逐步建立更明确的消息与工具视图接口 |
| 状态 | 服务端事件数据和局部响应式状态 | AgentSession + footer 数据提供方 | TUI 已是独立 RPC 客户端；继续保持服务端负责业务事实 |
| 主题 | 语义主题、明暗模式、语法样式 | 主题接口与失效规则 | 当前固定 ANSI 配色；应先建立语义配色和明暗适配 |
| 审批 | 操作展示、diff、可保存授权范围 | 本轮重点不在其权限机制 | 当前列出 capability / resource / JSON；可增加面向具体操作的展示 |
| 刷新 | OpenTUI 渲染器与批量事件投递 | 合并请求、差异行或视口刷新 | 已有 16 ms 合并与变化行输出，不能把“首次引入增量刷新”列为下一步 |

Eden 当前主列最大 96 列，侧栏在可见且宽度至少 110 列时出现；状态底栏以模型、角色、世界依次回退，而不是同时显示它们。草稿按会话保存在内存。固定颜色和用户消息背景主要按深色终端设计。审批菜单已有允许一次、总是允许二次确认和拒绝，但操作说明仍偏技术参数。

对应源码：[布局和底栏](../../Server/tui/terminal-frame.ts)、[草稿与刷新](../../Server/tui/terminal.ts)、[配色](../../Server/tui/terminal-style.ts)、[Markdown 子集](../../Server/tui/markdown-lines.ts)、[审批交互](../../Server/tui/app.ts)、[RPC 边界](../../Server/tui/rpc-client.ts)。

## 同日补充：Eden 当前需要优先处理的交互问题

用户进一步询问 Eden TUI 的优化重点后，重新对照当前输入、连接和事件展示代码，确认以下静态问题，应先于一般布局增强处理：

- **发送失败恢复。** `terminal.ts` 的 submit 先清空编辑器，再调用 onLine；`app.ts` 的 enqueue 在失败时报告错误，没有恢复该次输入。普通消息已经进入内存历史，不等于完全丢失，但需要手动找回，且历史没有重启持久化。应保存提交快照，明确失败时提供恢复入口，并避免覆盖用户新输入；执行结果不确定时不自动重发。
- **断线时的草稿和会话恢复。** 当前断线进入 server_error，提示手动 `/retry`；该流程调用 setInputMode，会清空正在编辑的输入。应先保存非密码草稿，再进行有上限、可取消的断线重连，恢复原会话并重新同步事件、审批和提问。健康连接不应周期重建，认证失效应转登录，不盲目重试副作用请求。
- **工具结果与失败原因。** `event-view.ts` 的 operation.started 保存最多 400 字符参数摘要，operation.completed 主要更新完成或失败文字；`transcript-view.ts` 的展开主要展示这些参数，没有专门的结果摘要或失败原因视图。应通过协议允许的展示数据补充结果、耗时和失败原因；如现有事件数据不足，先扩展服务端公开协议，不能由 TUI 绕过宿主读内部运行时状态。

证据：[发送与输入模式](../../Server/tui/terminal.ts)、[队列错误处理与连接](../../Server/tui/app.ts)、[认证及断线流程](../../Server/tui/auth-flow.ts)、[事件映射](../../Server/tui/event-view.ts)、[工具详情](../../Server/tui/transcript-view.ts)。以上只做源码核对，没有运行复现或修改实现。

## 后续界面完善顺序

1. **先完善状态和主题。** 状态区稳定显示世界、角色、模型、工作区和执行状态，窄窗口按优先级退化；颜色改为语义 token，提供明暗适配。运行状态和耗时以服务端事实或明确的本轮计时定义为准。
2. **完善输入生命周期。** 将编辑器、补全、菜单与应用动作的焦点归属写清楚；异步发送使用输入快照，失败不覆盖新输入。历史与显式暂存分开，按账号、世界隔离保存；不要把内存草稿误称为重启恢复。
3. **改进审批与工具展示。** 对命令、文件写入和外部通信分别展示操作对象、主要内容和授权范围，保留原始详情入口；工具视图支持部分结果、完成、失败和展开。展示层隐藏信息不等于模型接收不到信息，模型输出边界仍由宿主负责，正常业务 ID 不应被全局删除。
4. **再增强 Markdown 和长历史。** 参考解析、布局、着色缓存分开和主题失效规则，增加表格与复杂列表支持；长历史按需要加载，并保持阅读位置。先保留现有增量输出，再依据实际验收定位瓶颈。
5. **最后评估更丰富的布局和 UI 扩展。** 只有实际任务需要时，再加入终端分栏、标签或有限的 UI slot。参考仓库和演示夹具不作为运行时依赖；新组件库如需引入，只承担表现层职责，继续遵守 Eden 工程约束和依赖边界。

本报告只给出设计建议，没有修改 Eden TUI 实现。后续若进入实现，再按工程约束分拆模块；真实验收应覆盖 Windows 常用终端、窄窗口、中文与 emoji、IME、粘贴、窗口缩放、主题切换、输入焦点、审批与断线恢复。本轮没有执行这些验收。
