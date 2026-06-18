# Deep Analyst

Agent-transparent research platform. Watch a multi-agent pipeline research any topic in real time — every tool call, thinking step, and sub-agent spawn streamed live to the browser.

## Prerequisites

- Node.js 18+
- Python 3.11+ (3.13 recommended; 3.14 is not yet supported by pydantic-core)

---

## Quick Start

**Backend**

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — set ZEN_API_KEY (get one free at https://opencode.ai)

uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, type any query, and watch the agent tree build in real time.

---

## Environment Variables (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `ZEN_API_KEY` | — | **Required** — models are served by OpenCode Zen |
| `ZEN_MODEL` | `deepseek-v4-flash-free` | Any Zen-supported model slug |
| `ZEN_BASE_URL` | `https://opencode.ai/zen/v1` | Override for self-hosted Zen |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS allowed origin |

---

## Running Tests

```bash
cd frontend
npm run test          # Vitest — 32 tests (eventDecoder + treeBuilder)
npm run test:coverage
```

---

## Architecture Overview

```
Browser                         FastAPI (port 8000)
──────────────────────────      ──────────────────────────────────────
ChatPanel                       POST /api/run  {query}
  └─ QueryInput ─────────────►      └─ uuid4 sessionId → BackgroundTask
                                        └─ runner(query, queue)
                               GET /api/stream/{sessionId}  (SSE)
TracePanel                     ◄─── data: {"type":"agent_start", ...}
  └─ TraceNode (recursive)          data: {"type":"thinking", ...}
       └─ ParallelGroup             data: {"type":"tool_start", ...}
                                    data: {"type":"artifact", ...}
Redux store                         data: {"type":"done"}
  trace slice  ◄─ applyTraceEvent
  chat  slice  ◄─ addAssistantMessage
  session slice◄─ setStatus
```

### Event Contract

Twelve discriminated-union event types shared by all runners and the frontend:

| Type | Direction | Purpose |
|---|---|---|
| `session_start` | backend → frontend | Query acknowledged |
| `agent_start` | backend → frontend | Sub-agent spawned |
| `agent_end` | backend → frontend | Sub-agent finished |
| `thinking` | backend → frontend | LLM reasoning delta |
| `tool_start` | backend → frontend | Tool call begins |
| `tool_end` | backend → frontend | Tool call result |
| `artifact` | backend → frontend | File produced |
| `agent_response` | backend → frontend | Agent's final answer text |
| `ask_user` | backend → frontend | Agent needs clarification |
| `ask_user_answered` | frontend → store | User's answer recorded |
| `error` | backend → frontend | Recoverable or fatal error |
| `done` | backend → frontend | Entire pipeline complete |

### Frontend State

| Redux slice | Key state | Updated by |
|---|---|---|
| `trace` | `nodes: Record<agentId, TraceNode>` flat map; `rootIds`; `expandedIds`; `pastRuns` (last 5) | `applyTraceEvent`, `snapshotCurrentRun`, `autoCollapse` |
| `chat` | `messages`; `pendingQuestion` | `addAssistantMessage`, `setPendingQuestion` |
| `session` | `sessionId`; `status`; `lastQuery`; `reconnectCount` | `startSession` thunk, `setStatus` |

Parallel agent detection is pure: `groupSiblings()` in `treeBuilder.ts` sorts nodes by `startedAt` and detects overlap with `completedAt ?? Infinity` — no agent names hardcoded.

### Backend Runner

| File | Notes |
|---|---|
| `openhands_runner.py` | **OpenHands Agent SDK** harness → models via **OpenCode Zen** gateway |

The backend separates the two concerns the way the reviewer architecture prescribes:

- **Agent harness — OpenHands SDK.** Each pipeline stage (lead-analyst, web-researcher ×3, data-analyst, report-writer) is an SDK `Conversation`. The harness owns the agent loop: tool dispatch, message history, termination (`finish` tool), and error events. SDK events (`ActionEvent`, `ObservationEvent`, `MessageEvent`, `AgentErrorEvent`) are translated to the app's 12-type SSE schema via conversation callbacks.
- **Models — OpenCode Zen.** The SDK's `LLM` is pointed at the Zen OpenAI-compatible gateway (`openai/<ZEN_MODEL>` + `ZEN_BASE_URL`), so any Zen-supported model (DeepSeek, Claude, Qwen, …) works without code changes.

### Agent Definitions — an OpenHands SDK plugin

Agent system prompts are **not hardcoded in Python**. They ship as a proper **OpenHands SDK plugin** — a self-contained directory with a manifest and an `agents/` folder of markdown definitions:

```
backend/deep-analyst-plugin/
  .plugin/plugin.json   # plugin manifest (name, version, description, author)
  agents/
    lead-analyst.md     # orchestrator — decomposes into 3 subtopics, may ask_user
    web-researcher.md   # web_search + write_file on one subtopic
    data-analyst.md     # metrics extraction → analysis-summary.md
    report-writer.md    # final synthesis → research-brief.md
  .mcp.json             # MCP servers (none — tools are registered in Python)
  README.md
```

Each agent file declares `name`, `description`, and allowed `tools` in YAML frontmatter; the markdown body is the system prompt. The runner loads the plugin once at import with the SDK's `Plugin.load()`, which parses the manifest and turns each `agents/*.md` into an `AgentDefinition` (and surfaces any MCP config / hooks the plugin declares). Editing a prompt requires no Python changes.

Custom tools (`web_search` via DuckDuckGo, `write_file`, `ask_user`) are Python `ToolDefinition` classes registered with the SDK's `register_tool()` and referenced by name from the agent frontmatter (plugins bundle agents/skills/hooks/MCP — not Python tool classes).

### SSE Reconnect & Replay

Every emitted event is appended to a per-session `event_buffer` list. On reconnect the client sends `?lastEventId=<id>`; the server replays all buffered events after that ID before resuming the live queue.

---

## Known Limitations

| # | Limitation | Impact |
|---|------------|--------|
| L1 | **In-memory session store** — sessions live in a Python process dict | Single-worker only; restart loses all in-flight runs; not suitable for multi-process deployment (fix: Redis-backed session store) |
| L2 | **Web search has no rate-limit handling** — `web_search` uses DuckDuckGo (`ddgs`) without backoff | Heavy parallel querying can get temporarily rate-limited; the tool returns an error result and the researcher continues with whatever it has |
| L3 | **No multi-worker scaling** — `asyncio.Queue` objects can't cross process boundaries | `uvicorn --workers N` with N > 1 will 404 stream requests that land on a different worker than the one that created the session |
| L4 | **localStorage quota** — `snapshotCurrentRun` stores full node event arrays | Very long runs (hundreds of tool calls) can exceed the 5 MB localStorage quota; the save is silently dropped; no user feedback |
| L5 | **Thinking is not token-streamed** — the OpenHands harness delivers agent thoughts per turn, not per token | `thinking` events arrive as whole chunks (`delta: false`) rather than a live typing effect; the UI renders them identically |
| L6 | **No authentication** — all endpoints are unauthenticated | Anyone who can reach port 8000 can start sessions and read SSE streams |
| L7 | **`beforeunload` flush missing** — localStorage is written 800 ms after the last Redux action | Closing the tab within 800 ms of a run completing loses the past-run card (the run is in Redux but not yet persisted) |
| L8 | **Mobile layout unsupported** — split panel requires ≥ 900 px viewport | Below that width the chat panel fills the screen and the trace panel is hidden |
