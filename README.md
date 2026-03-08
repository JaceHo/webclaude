<div align="center">

# CtrlNect

**Maximum Control · Maximum Connection · Maximum Usage**

Self-hosted web control plane for autonomous AI coding agents.<br/>
Multi-session · Real-time streaming · Cron automation · iTerm2 · WeChat · Feishu · Service manager<br/>
Works with **Anthropic** and any **OpenAI-compatible API** — bring your own base URL and secret key.

[Quick Start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Configuration](#configuration) · [API Reference](#api-reference)

</div>

---

## Why CtrlNect?

AI coding agents are powerful — but a single CLI terminal is a bottleneck. CtrlNect gives you the **full control plane** in a browser, from any device, with everything wired together:

| | |
|---|---|
| **Multi-session agents** | Run many concurrent agent sessions, each with its own working dir, model, and history |
| **Real-time streaming** | Token-by-token output — thinking blocks, tool calls, sub-agent events, all live |
| **Full agentic toolset** | Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch, Agent (sub-agents), NotebookEdit |
| **Sub-agent management** | Spawn and observe parallel sub-agents from the UI in real time |
| **iTerm2 integration** | View and control all live iTerm2 terminal sessions directly from the sidebar |
| **WeChat Web panel** | Embedded WeChat Web — no popup, preserves login, soft-reload support |
| **Feishu / Lark bridge** | DM integration: send prompts and receive agent replies inside Feishu chat |
| **Cron scheduler** | Schedule AI prompt runs or shell commands with standard cron expressions |
| **Service manager** | Start, stop, restart and monitor background services from the sidebar |
| **Dual API support** | Anthropic (native) **and** any OpenAI-compatible API with custom base URL + secret key |
| **Persistent history** | Sessions, messages and logs survive page refreshes and server restarts |
| **Remote access** | Control your agents from any device on your network |

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) v1.1+

```bash
# Clone
git clone https://github.com/JaceHo/ctrlnect.git
cd ctrlnect

# Install
bun install

# Set your API key (or use existing ANTHROPIC_AUTH_TOKEN from ~/.zshrc)
export ANTHROPIC_API_KEY=sk-ant-...

# Run
bun run dev
```

Open **http://localhost:5173** — create a session and start chatting.

> **Corporate VPN / proxy:** The dev server automatically sets `NODE_TLS_REJECT_UNAUTHORIZED=0` to handle self-signed certificates.

## Features

### Multi-Session Agent Management

Create, switch between, and manage multiple concurrent Claude agent sessions. Each session maintains its own conversation history, working directory, and model selection. Sessions persist across server restarts.

> **Shared agent memory across sessions:** Use [AgentMem](https://github.com/JaceHo/AgentMem) — a persistent, cross-session memory layer that lets your agents remember context, decisions, and knowledge across different sessions and restarts.

### Full Agentic Toolset + Sub-agent Management

Every session has access to the complete Claude Code toolset. The `Agent` tool spawns parallel sub-agents — CtrlNect streams their events to the UI in real time so you can observe every sub-task as it executes.

| Tool | Description |
|------|-------------|
| `Read` | Read files from the filesystem |
| `Write` | Create new files |
| `Edit` | Make targeted edits to existing files |
| `Bash` | Execute shell commands |
| `Grep` | Search file contents with regex |
| `Glob` | Find files by pattern |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch and process web pages |
| `Agent` | Spawn sub-agents for parallel work (streamed live) |
| `NotebookEdit` | Edit Jupyter notebooks |

### iTerm2 Session Panel

All live iTerm2 terminal sessions appear in the sidebar with AI-generated titles and working directory. Click any session to view its output and send commands — without leaving the browser.

### WeChat Web Panel

Embedded WeChat Web (`wx.qq.com`) in the right panel — no popup windows. Supports soft reload (preserves login) and opens in a standalone browser tab as fallback.

### Real-time Streaming

Messages stream token-by-token as Claude generates them. Thinking blocks, tool invocations, and tool results all render in real time.

### Cron Scheduler

Schedule agent runs with standard cron expressions. The built-in scheduler:
- Supports both **prompt-type** crons (send a message to a session) and **command-type** crons (run a shell command)
- Auto-imports entries from the system crontab on startup (idempotent)
- Shows next scheduled run time for each job
- Can be triggered manually from the UI

### Feishu / Lark Integration (OpenClaw)

Connect Claude sessions to Feishu DMs. Configure in `~/.openclaw/config.json`:

```json
{
  "feishu": {
    "app_id": "cli_...",
    "app_secret": "...",
    "poll_interval_ms": 5000,
    "sessions": [
      { "feishu_user_id": "ou_...", "session_id": "session-name" }
    ]
  }
}
```

Once configured, messages sent to the bot in Feishu DM are forwarded to the mapped Claude session. Agent replies stream back to the Feishu chat in real time.

### Service Manager

Monitor and control background services from the sidebar. View status, start/stop services, and see live output — without leaving the browser.

### Model Switching

Switch between Claude models per session:
- **Sonnet 4.6** — Fast and capable (default)
- **Opus 4.6** — Most capable
- **Haiku 4.5** — Fastest

### Rich Message Rendering

- Markdown with GitHub-flavored extensions
- Syntax-highlighted code blocks (150+ languages)
- Collapsible thinking blocks
- Tool invocation & result visualization
- Inline image display
- Cost tracking per session

### Image Input

Paste images from clipboard, drag-and-drop files, or use the file picker. Images are sent to Claude for visual analysis and coding tasks.

### Resilient Agent Runner

If the Claude Code subprocess crashes, CtrlNect automatically retries with exponential backoff. Each retry uses a fresh SDK session. Non-retryable errors (auth, permissions) fail immediately. Sessions auto-recover to idle after errors.

### Draggable Sidebar

The sidebar has two sections — sessions (top) and panels (bottom: crons, services). The divider is draggable; the bottom panel overlays the session list when expanded. Height is persisted across refreshes.

## Architecture

```
Browser (React + Vite)            Server (Bun + Hono)           Claude Agent SDK
┌──────────────────────┐   WS    ┌───────────────────┐  stdio  ┌──────────────┐
│  Session Manager      │◄──────►│  WS Handler        │        │  Claude Code  │
│  Chat UI (streaming)  │        │  Connection Mgr    │◄──────►│  Subprocess   │
│  Tool Visualization   │  REST  │  Agent Runner      │        │  (per query)  │
│  Cron Scheduler UI    │◄──────►│  Session Store     │        └──────────────┘
│  Service Manager UI   │        │  Message Store     │              │
│  Feishu Status        │        │  Cron Store        │              ▼ ANTHROPIC_BASE_URL
│  WeChat Embed         │        │  Cron Scheduler    │        Anthropic API
└──────────────────────┘        │  Service Store     │           ── or ──
                                  │  Feishu Bridge     │◄──────► Feishu API
                                  │  iTerm2 Bridge     │◄──────► iTerm2
                                  │  OpenAI Proxy      │◄──────► OpenAI-compatible API
                                  └───────────────────┘         (gpt-4o, Groq, Azure…)
```

**Monorepo structure:**

```
ctrlnect/
├── client/          # React 19 + Vite 6 + Tailwind CSS 4
├── server/          # Bun + Hono + Claude Agent SDK
├── packages/
│   └── shared/      # TypeScript types shared between client & server
└── data/            # Session & message persistence (gitignored)
    ├── sessions.json
    ├── crons.json
    ├── services.json
    ├── feishu-state.json
    └── messages/    # Per-session message files
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Frontend | React 19, Vite 6, Tailwind CSS 4, TypeScript |
| Backend | [Hono](https://hono.dev) (REST + WebSocket) |
| Agent | [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| Rendering | react-markdown, remark-gfm, highlight.js |
| Storage | JSON files (no database required) |

### How It Works

1. **User sends a message** via the browser
2. **WebSocket** carries it to the Hono server
3. **Agent Runner** calls `query()` from the Claude Agent SDK, spawning a Claude Code subprocess
4. **SDK events stream** back through WebSocket to the browser in real-time
5. **Messages are persisted** to JSON files on disk
6. **Session state** is broadcast to all connected clients
7. **Cron Scheduler** independently triggers sessions on schedule, reusing the same WS handler
8. **Feishu Bridge** polls for DMs and injects them as chat messages, forwarding replies back

The Agent SDK manages the full Claude Code subprocess lifecycle — tool execution, multi-turn conversation, permission handling — so CtrlNect just needs to relay events.

## Configuration

### API Provider

CtrlNect supports both Anthropic and any OpenAI-compatible API, auto-detected from your environment:

**Priority chain:**
1. **Anthropic** (default) — if `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set
2. **OpenAI-compatible** (fallback) — if only `OPENAI_API_KEY` is set

### OpenAI-compatible API Support

CtrlNect includes a built-in inline proxy that transparently translates between the Anthropic Messages API format (used by the Claude Agent SDK internally) and the OpenAI Chat Completions format. **No external proxy (LiteLLM, etc.) needed.**

```bash
# Use OpenAI directly
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-4o"           # default: gpt-4o

# Use any OpenAI-compatible endpoint (Azure, Groq, Together, Ollama, etc.)
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://api.groq.com/openai/v1"
export OPENAI_MODEL="llama-3.3-70b-versatile"
```

When `OPENAI_API_KEY` is set (and no Anthropic key), CtrlNect starts a local translation proxy on `127.0.0.1:19876` that:
- Receives Anthropic-format requests from the Claude Agent SDK
- Translates messages, tools, and streaming SSE format to OpenAI format
- Forwards to your configured OpenAI endpoint
- Translates the response (including streaming tool calls) back to Anthropic format

### Environment Variables

```bash
# Option 1: Anthropic (default)
export ANTHROPIC_API_KEY="sk-ant-..."
export ANTHROPIC_BASE_URL="https://api.anthropic.com"  # optional

# Option 2: OpenAI-compatible API
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"     # optional, defaults to OpenAI
export OPENAI_MODEL="gpt-4o"                           # optional, defaults to gpt-4o

# Server port
export PORT=3001
```

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key (`sk-ant-...`) |
| `ANTHROPIC_AUTH_TOKEN` | Yes* | Or Claude subscription token (`cr_...`) |
| `ANTHROPIC_BASE_URL` | No | Custom Anthropic-compatible endpoint |
| `OPENAI_API_KEY` | Yes* | OpenAI or compatible API key |
| `OPENAI_BASE_URL` | No | OpenAI-compatible base URL (default: `https://api.openai.com/v1`) |
| `OPENAI_MODEL` | No | Model to use in OpenAI mode (default: `gpt-4o`) |
| `PORT` | No | Server port (default: `3001`) |

*One of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `OPENAI_API_KEY` is required.

### UI Toggle

The header shows the active provider as a badge (`Anthropic` / `OpenAI`). Click it to switch at runtime — takes effect for new agent runs. Green = API key detected, red = missing.

### Default Working Directory

New sessions default to the project directory. Override per session in the create dialog.

### Permissions

CtrlNect runs with `bypassPermissions` mode — Claude has full tool access without interactive confirmation prompts. This is by design for a self-hosted tool where you control the environment. **Do not expose CtrlNect to untrusted networks.**

### Running from Claude Code

If you start the server from within a Claude Code session, CtrlNect automatically strips the `CLAUDECODE` environment variable so the Agent SDK subprocess doesn't conflict with the parent session.

## Development

```bash
# Start both servers (backend + Vite dev server)
bun run dev

# Or start individually:
bun run dev:server    # Backend on :3001 (auto-restart on changes)
bun run dev:client    # Vite on :5173 (HMR, proxies to :3001)

# Type check
bun run typecheck

# Build for production
bun run build
```

The `dev.sh` script adds quality-of-life for local development:
- **Keyboard shortcuts**: `r` = restart Vite, `R` = restart server, `q` = quit
- **Control file**: `echo r > .dev.sh.control` (useful when no TTY)
- **Watchdog**: auto-restarts the server if port 3001 goes down unexpectedly

## API Reference

**REST endpoints:**

```
GET    /api/sessions                     List sessions
POST   /api/sessions                     Create session
PATCH  /api/sessions/:id                 Update session
DELETE /api/sessions/:id                 Delete session + messages
GET    /api/sessions/:id/messages        Get message history

GET    /api/crons                        List cron jobs
POST   /api/crons                        Create cron job
PATCH  /api/crons/:id                    Update cron job
DELETE /api/crons/:id                    Delete cron job
POST   /api/crons/:id/trigger            Manually trigger cron job
POST   /api/crons/import-system          Import system crontab entries

GET    /api/services                     List services
POST   /api/services                     Create service
PATCH  /api/services/:id                 Update service
DELETE /api/services/:id                 Delete service

GET    /api/models                       Available models
GET    /api/feishu/status                Feishu bridge status
GET    /health                           Health check
```

**WebSocket protocol (`/ws`):**

```
→ { type: "subscribe",    sessionId }
→ { type: "chat",         sessionId, text, images? }
→ { type: "interrupt",    sessionId }
→ { type: "cron_trigger", cronId }

← { type: "stream_start",    sessionId }
← { type: "agent_event",     sessionId, event }   // SDK events
← { type: "stream_end",      sessionId, cost? }
← { type: "session_update",  session }
← { type: "error",           sessionId, message }
```

## License

[MIT](LICENSE)

---

<div align="center">

Built with the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) · Maximum Control · Maximum Connection · Maximum Usage

</div>
