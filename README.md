<div align="center">

# Eden Agent

**为未说完的话，留一处相会的地方。**

角色互动 · 长期记忆 · 语音交流 · 工具执行 · 多智能体协作

[![CI](https://github.com/jiang357357357/EdenAgent/actions/workflows/ci.yml/badge.svg)](https://github.com/jiang357357357/EdenAgent/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-host-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22.23.1-339933?logo=nodedotjs&logoColor=white)

**简体中文** · [English](README.en.md)

[快速开始](#快速开始) · [可以一起做什么](#可以一起做什么) · [项目文档](文档/README.md)

</div>

> “要用皂荚木作一柜。”<br>
> “我要在那里与你相会。”
>
> ——[《出埃及记》25:10、25:22](https://zh.wikisource.org/zh-hans/聖經_(和合本)/出埃及記#第二十五章)，和合本节选。

桌面是一方很小的天地。屏幕亮起时，几行文字、一个声音、一个熟悉的身影，都在这里相逢。

Eden Agent 的设计灵感来自《蔚蓝档案》中的“什亭之匣”。我们借经文里的“相会”写下它的开篇：把值得记住的往事留下，把尚未成形的念头写出来，把未竟的事一同做完。

愿你再次打开这扇窗口时，昨日的话仍有地方接续，明日的约定仍有迹可循。

<p align="center">
  <img src="docs/assets/eden-agent-runtime.png" alt="Eden Agent 桌面界面：会话列表、角色回复、语音播放和立绘" width="100%">
  <br>
  <sub>桌面界面示例（2026-10-02）。角色和视觉资源可自行配置，具体界面随版本更新。</sub>
</p>

Eden Agent 是一个本地优先的桌面智能体项目，使用 TypeScript、React 和 Electron。角色可以与你交流，也能在所选工作区里读取文件、调用工具、处理任务。会话与记忆由本地宿主持久保存；模型可接云端服务或本地服务。

## 可以一起做什么

### 为往事留一页

一句随口说出的偏好，一段共同谈起的经历，都是故事里细小的一笔。

设置角色资料、立绘和声线，用长期记忆保存值得留下的内容。静态与 Spine 立绘、语音合成和语音输入，让这段对话有了面容与声音，也让熟悉从一次次相逢里慢慢生长。

### 与你走过未竟之事

“读一下这个项目，告诉我哪里需要修改。”

一叠资料，一份尚未落笔的文档，一个等着排查的错误。从念头到完成，往往要走一段路。

为会话选择工作区，让智能体与你一起阅读、搜索、编辑与执行。复杂任务可以交给多个子智能体分担；走到了哪里、还剩下什么，都能在会话中查看。

### 把约定写进明天

“记下这件事，到了时间提醒我。”

有些话说给此刻，有些话留给明天。

用备忘保存待办，用提醒和自醒安排下一次唤醒，让写下的计划有机会回到眼前。自醒与通知需要配置调度服务和对应渠道；语音功能也需要配置相应服务。

## 核心能力

| 能力 | 你可以做什么 |
| --- | --- |
| 角色与语音 | 配置角色资料、静态/Spine 立绘、语音合成及语音输入 |
| 会话与记忆 | 流式回复、会话恢复、长期记忆、上下文压缩 |
| 文件与工作区 | 为会话选择目录，浏览、搜索、读取和编辑文件，执行系统命令 |
| 多智能体 | 拆分任务、派发子任务、查看进度并汇总结果 |
| 技能与扩展 | 按需发现和加载工具，安装技能、插件、MCP 与连接器 |
| 备忘与自醒 | 保存待办与提醒，在已配置的调度服务下安排自醒 |
| 双世界 | 伊甸园接入 Mon Core；尘世使用独立的本地配置与模型 |

“本地优先”指宿主和持久数据由本地管理。使用云端模型或外部服务时，对应请求仍会联网。项目持续开发中，完成状态、验证证据和未完成项见[实施跟踪](文档/技术/Eden%20Agent%20TS%20迁移实施跟踪.md)。

## 快速开始

源码运行需要 **Node.js 22.23.1、npm 和 Git**。请完整克隆子模块；Server 与 Frontend 都依赖主项目的共享包和脚本。

```sh
git clone --recurse-submodules https://github.com/jiang357357357/EdenAgent.git
cd EdenAgent
npm ci
npm --prefix frontend ci
```

首次克隆后，从 `.monconfig.example` 创建本机 `.monconfig`：

<details>
<summary>Windows PowerShell</summary>

```powershell
Copy-Item .monconfig.example .monconfig
```

</details>

<details>
<summary>Linux / macOS shell</summary>

```sh
cp .monconfig.example .monconfig
```

</details>

配置本机服务后启动：

```sh
npm run dev
```

开发 Web 默认在 `http://127.0.0.1:40091`。尘世使用本地模型配置；伊甸园需要可用的 Mon Core 和对应认证配置。模型、声线与角色资源按实际服务配置，详细入口见[开发与运行](文档/开发与运行.md)。

## 项目文档

- [开发与运行](文档/开发与运行.md)：运行结构、模型与数据、脚本、扩展和执行策略。
- [文档目录](文档/README.md)：设计说明、操作手册与历史参考。
- [实施跟踪](文档/技术/Eden%20Agent%20TS%20迁移实施跟踪.md)：实际验证结果与未完成项。
- [贡献指南](CONTRIBUTING.md) · [版本记录](CHANGELOG.md) · [安全策略](SECURITY.md)。

## 使用与授权

终端、插件、技能、MCP 和连接器当前使用系统账户权限本机执行，OS 沙箱处于暂停状态；工具审批、超时和取消仍然生效。双世界分别保存进程与数据，本机执行不提供两个世界之间的 OS 文件或网络隔离。

源码依据 [PolyForm Noncommercial 1.0.0](LICENSE) 提供非商业使用，商业使用须取得[单独书面授权](COMMERCIAL-LICENSE.md)。这是一项源代码公开项目，并非 OSI 定义的开源许可。许可历史见 [LICENSING.md](LICENSING.md)。

本项目与《蔚蓝档案》官方无关联。截图中的第三方角色，以及 Spine、声线、模型等资源不包含在本项目软件授权中；代码仓库不附带角色二进制资源。资源说明见[第三方声明](THIRD-PARTY-NOTICES.md)。

---

这方小小的伊甸仍在生长。欢迎留下 Star、问题与改进，和我们一起续写下一页。
