<div align="center">

# Eden Agent

**A place to meet again, with room for words left unfinished.**

Character interaction · Long-term memory · Voice · Tools · Multi-agent collaboration

[![CI](https://github.com/jiang357357357/EdenAgent/actions/workflows/ci.yml/badge.svg)](https://github.com/jiang357357357/EdenAgent/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-host-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22.23.1-339933?logo=nodedotjs&logoColor=white)

[简体中文](README.md) · **English**

[Quick start](#quick-start) · [What you can do together](#what-you-can-do-together) · [Documentation](文档/README.en.md)

</div>

> “And they shall make an ark of shittim wood…”<br>
> “And there I will meet with thee…”
>
> — [Exodus 25:10, 25:22](https://en.wikisource.org/wiki/Bible_(King_James)/Exodus), King James Version, excerpts.

A desktop is a small world. When the screen lights up, a few lines of text, a voice, and a familiar figure can meet there.

Eden Agent draws inspiration from the Shittim Chest in *Blue Archive*. The scripture's image of a meeting gives this project its opening: keeping memories worth carrying, giving shape to ideas, and sharing the work still ahead.

May you find a way to continue yesterday's conversation when you open this window again, with tomorrow's plans still within reach.

<p align="center">
  <img src="docs/assets/eden-agent-runtime.png" alt="Eden Agent desktop with sessions, character replies, voice playback and character artwork" width="100%">
  <br>
  <sub>Desktop example from October 2, 2026. Characters and visual assets are configurable; the interface changes between versions.</sub>
</p>

Eden Agent is a local-first desktop agent built with TypeScript, React and Electron. Characters can talk with you, read files in a selected workspace, use tools and work on tasks. The local host persists conversations and memory; models can use cloud or local services.

## What you can do together

### Keep a page for what came before

A preference mentioned in passing. An experience you talked about together. Small lines in a story worth keeping.

Configure a character's profile, artwork and voice, and save what matters in long-term memory. Static and Spine artwork, speech synthesis and voice input give the conversation a face and a voice. Familiarity has room to grow with each meeting.

### Walk through unfinished work together

“Read this project and tell me what needs to change.”

A stack of notes, a document waiting for its first sentence, an error waiting to be understood. There is often a stretch of road between an idea and its completion.

Choose a workspace for the session. The agent can read, search, edit and run commands alongside you. Child agents can share a complex task; you can see how far the work has come, and what remains, in the conversation.

### Leave tomorrow a note

“Remember this and remind me when it is time.”

Some words are for this moment. Others are left for tomorrow.

Keep to-do items in memos, and use reminders and self-awake scheduling to bring a written plan back into view. Scheduling and notifications require their corresponding services and channels to be configured; voice features also need their services.

## Capabilities

| Capability | What it provides |
| --- | --- |
| Characters and voice | Character profiles, static/Spine artwork, speech synthesis and voice input |
| Sessions and memory | Streaming replies, session recovery, long-term memory and context compaction |
| Files and workspaces | Per-session directories, file browsing/search/editing and system commands |
| Multiple agents | Task delegation, progress inspection and result collection |
| Skills and extensions | On-demand tool discovery/loading, skills, plugins, MCP and connectors |
| Memos and self-awake | To-do items, reminders and scheduling through a configured service |
| Two realms | Eden connects to Mon Core; Local uses independent local configuration and models |

Local-first describes the host and persistent data. Cloud models and external services still make network requests. The project is under active development; see the [implementation tracker](文档/技术/Eden%20Agent%20TS%20迁移实施跟踪.md) for verification evidence and remaining work.

## Quick start

Use **Node.js 22.23.1, npm and Git**. Clone all submodules: Server and Frontend depend on shared packages and scripts in the main project.

```sh
git clone --recurse-submodules https://github.com/jiang357357357/EdenAgent.git
cd EdenAgent
npm ci
npm --prefix frontend ci
```

On a fresh checkout, create the local `.monconfig` from `.monconfig.example`:

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

Configure the local services, then start:

```sh
npm run dev
```

The development web client defaults to `http://127.0.0.1:40091`. Local uses local model configuration; Eden requires an available Mon Core service and its authentication configuration. Configure models, voices and character resources for your setup. See [development and runtime notes](文档/开发与运行.md) (Chinese) for details.

## Documentation

- [Development and runtime notes](文档/开发与运行.md) (Chinese): architecture, models, data, scripts, extensions and execution policy.
- [Documentation index](文档/README.en.md): designs, operations and historical references.
- [Implementation tracker](文档/技术/Eden%20Agent%20TS%20迁移实施跟踪.md): verification results and remaining work.
- [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md).

## Use and licensing

Terminals, plugins, skills, MCP and connectors currently execute with the OS account's permissions. OS sandboxing is paused; tool approval, timeouts and cancellation remain active. The realms have separate processes and data, but host execution does not provide OS-level file or network isolation between them.

Source is available for noncommercial use under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires [separate written authorization](COMMERCIAL-LICENSE.md). This is a source-available project, not an OSI-approved open-source license. See [LICENSING.md](LICENSING.md) for licensing history.

The project is unaffiliated with *Blue Archive* or its publishers. Third-party characters, Spine assets, voices and models are not covered by the software license. The code repository does not include character binaries. See [third-party notices](THIRD-PARTY-NOTICES.md).

---

This small Eden is still taking shape. Leave a Star, share an Issue, or help us write the next page.
