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
| `ZEN_MODE` | `true` | Real LLM via OpenCode Zen gateway |
| `ZEN_API_KEY` | — | Required when `ZEN_MODE=true` |
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

### Backend Runners

| Mode | File | Notes |
|---|---|---|
| `ZEN_MODE=true` | `zen_runner.py` | OpenAI SDK → OpenCode Zen gateway → any model |
| `ZEN_MODE=false` | `agent_runner.py` | Placeholder for Claude Agent SDK integration |

The Zen runner uses the **OpenAI SDK** (not Anthropic SDK) because non-Claude models require OpenAI tool format `{type: "function", function: {...}}`.

### SSE Reconnect & Replay

Every emitted event is appended to a per-session `event_buffer` list. On reconnect the client sends `?lastEventId=<id>`; the server replays all buffered events after that ID before resuming the live queue.

---

## Known Limitations

| # | Limitation | Impact |
|---|------------|--------|
| L1 | **In-memory session store** — sessions live in a Python process dict | Single-worker only; restart loses all in-flight runs; not suitable for multi-process deployment (fix: Redis-backed session store) |
| L2 | **Web search is stubbed** — `zen_runner._handle_web_search()` returns simulated results | The Zen runner does not make real HTTP requests; research output is LLM-generated from its training data, not live web data |
| L3 | **No multi-worker scaling** — `asyncio.Queue` objects can't cross process boundaries | `uvicorn --workers N` with N > 1 will 404 stream requests that land on a different worker than the one that created the session |
| L4 | **localStorage quota** — `snapshotCurrentRun` stores full node event arrays | Very long runs (hundreds of tool calls) can exceed the 5 MB localStorage quota; the save is silently dropped; no user feedback |
| L5 | **Streaming tool calls model-dependent** — `tool_calls_acc` delta accumulation tested only with `deepseek-v4-flash-free` | Other Zen-supported models may emit tool-call deltas in a different shape, causing `tool_calls_acc` to mis-parse and the runner to stall |
| L6 | **No authentication** — all endpoints are unauthenticated | Anyone who can reach port 8000 can start sessions and read SSE streams |
| L7 | **`beforeunload` flush missing** — localStorage is written 800 ms after the last Redux action | Closing the tab within 800 ms of a run completing loses the past-run card (the run is in Redux but not yet persisted) |
| L8 | **Mobile layout unsupported** — split panel requires ≥ 900 px viewport | Below that width the chat panel fills the screen and the trace panel is hidden |
