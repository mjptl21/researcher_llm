# Deep Analyst — 1-Pager Design Document

---

## Tenets

1. **Transparency over magic.** Every inference step the AI takes is visible. Users never see a spinner; they see thinking.
2. **Real work, not simulations.** The agent pipeline mirrors how a human research team would divide labour — lead analyst, parallel researchers, synthesis, report.
3. **Frontend first.** The UI contract (12 typed SSE events) is fixed before any LLM is wired in. Mocks must be indistinguishable from real runs.
4. **Fail loudly, recover gracefully.** Errors surface in the UI with retry affordance; streams reconnect automatically and replay missed events.

---

## Problem

Developers building with LLMs face two hard problems simultaneously: **(a)** they can't see what their agents are actually doing while a request is in flight, and **(b)** there is no reference implementation showing how to wire SSE streaming, parallel sub-agents, and a reactive frontend together in a single coherent system.

Existing demos show either the chat surface or the backend plumbing — never both at once, never with real parallelism, and never with enough state management to survive a page refresh or a network blip.

---

## Proposed Solution

A full-stack **agent-transparent chat application** (Domain A: "Deep Analyst") where:

- A **multi-agent research pipeline** (lead-analyst → 3 parallel web-researchers → data-analyst → report-writer) runs on a Python FastAPI backend.
- Every internal event the pipeline emits — agent spawns, tool calls, thinking deltas, artifacts — is streamed to the browser over **Server-Sent Events** using a discriminated-union event schema (12 event types).
- A **React + Redux** frontend renders the full agent tree in real time, grouping siblings that run concurrently into a parallel-group widget, and auto-collapsing completed nodes.
- A **Zen runner** connects to any real LLM (DeepSeek, Claude, etc.) via the OpenCode Zen OpenAI-compatible gateway, with a placeholder `agent_runner` for future Claude Agent SDK integration.

---

## Goals

- **G1** Stream all 12 event types end-to-end from backend runner to React component tree.
- **G2** Detect and visualise parallel agents without hardcoding agent names — pure timestamp-overlap logic.
- **G3** Persist the last 5 completed runs across page refreshes via localStorage.
- **G4** Reconnect a dropped SSE stream and replay missed events from a server-side buffer without user action.
- **G5** Surface a retry button on error; re-run the last query with one click.
- **G6** Reach ≥ 30 unit tests covering the event decoder and agent-tree builder.

---

## Non-Goals

- **Not a production deployment.** Sessions are held in a Python process-level dict; no Redis, no persistence beyond a single uvicorn worker.
- **Not a general chat interface.** The chat panel is read-only except for the query input and the ask-user answer box — it is not a general-purpose assistant.
- **Not a browser extension or SaaS.** There is no auth, no multi-tenancy, no rate limiting.
- **Not real web search.** The zen runner simulates web-search results locally; no external HTTP calls are made from the agent tools.
- **Not mobile.** The split-panel layout requires a minimum ~900 px viewport.

---

## Open Questions

| # | Question | Current stance |
|---|----------|----------------|
| OQ-1 | Should the agent tree support more than one level of nesting (grandchild agents)? | Not implemented. `TraceNode.children` is a flat list of IDs; deeper nesting would require a recursive `parentId` chain already present in the data model but untested at depth > 2. |
| OQ-2 | Can the Zen runner use streaming tool calls reliably across all Zen-supported models? | Tested only with `deepseek-v4-flash-free`. Other models may emit tool-call deltas in different chunk shapes; `tool_calls_acc` accumulation logic may need adjustment. |
| OQ-3 | Should past runs be exportable (download as JSON / markdown)? | Not in scope for v1; the `RunSummary` data structure contains everything needed for a download button. |
| OQ-4 | Is an 800 ms localStorage debounce safe if the user closes the tab immediately after a run? | Risk is accepted for v1. The `snapshotCurrentRun` action now writes synchronously to Redux on `done`; the 800 ms save to disk is the only window where data can be lost on hard close. A `beforeunload` flush would close this gap. |
| OQ-5 | Should the frontend validate incoming SSE events against the schema at runtime? | Currently only the `type` field is validated against `KNOWN_EVENT_TYPES`. Full runtime validation (e.g. with Zod) would catch malformed payloads from future runner changes but adds bundle size. |
