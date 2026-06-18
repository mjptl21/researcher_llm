"""
OpenHands runner — agents run on the OpenHands Agent SDK harness;
models are served by OpenCode Zen (OpenAI-compatible gateway).

Architecture:
  - Agent definitions ship as an OpenHands SDK plugin in
    backend/deep-analyst-plugin/ (a .plugin/plugin.json manifest plus an
    agents/*.md folder). The plugin is loaded once via Plugin.load(), exposing
    one AgentDefinition (system prompt + allowed tools) per pipeline stage.
  - Each pipeline stage is an SDK Conversation run in a worker thread
    (Conversation.run() is synchronous); SDK events are translated to the
    app's 12-type SSE event schema via conversation callbacks and pushed
    thread-safely onto the session's asyncio event queue.
  - Custom tools (web_search, write_file, ask_user) are registered once with
    register_tool(); executors resolve per-session context (answer queue,
    event loop) through the conversation's workspace directory.

Pipeline:
  lead-analyst   → decomposes query into 3 subtopics (may ask_user)
  web-researcher × 3 (parallel asyncio.gather)
  data-analyst   → extracts metrics from all research notes
  report-writer  → synthesises final research brief
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Self

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")

from pydantic import Field, SecretStr

from openhands.sdk import LLM, Agent, Conversation, Tool, register_tool
from openhands.sdk.event import (
    ActionEvent,
    AgentErrorEvent,
    MessageEvent,
    ObservationEvent,
)
from openhands.sdk.plugin import Plugin
from openhands.sdk.tool import Action, Observation, ToolDefinition, ToolExecutor

# ── config ────────────────────────────────────────────────────────────────────

ZEN_API_KEY  = os.getenv("ZEN_API_KEY", "")
ZEN_BASE_URL = os.getenv("ZEN_BASE_URL", "https://opencode.ai/zen/v1")
ZEN_MODEL    = os.getenv("ZEN_MODEL", "deepseek-v4-flash-free")

# The agents ship as an OpenHands SDK plugin: a directory with a
# .plugin/plugin.json manifest and an agents/ folder of markdown definitions.
PLUGIN_DIR = Path(__file__).resolve().parent.parent / "deep-analyst-plugin"

# Per-session context for tool executors, keyed by session working dir.
# Executors run on conversation worker threads and only receive the
# conversation object, so they look up the session through its workspace.
_SESSION_CTX: dict[str, dict[str, Any]] = {}

# The plugin is static, so load it once. Plugin.load() parses the manifest and
# the agents/ markdown files into AgentDefinition objects, and reads any MCP
# config / hooks the plugin declares.
_PLUGIN = Plugin.load(PLUGIN_DIR)
_AGENT_DEFS = {d.name: d for d in _PLUGIN.agents}
# Only forward MCP config when the plugin actually declares servers.
_MCP_CONFIG = _PLUGIN.mcp_config if (_PLUGIN.mcp_config or {}).get("mcpServers") else {}
_HOOK_CONFIG = _PLUGIN.hooks

_REQUIRED_AGENTS = {"lead-analyst", "web-researcher", "data-analyst", "report-writer"}
_missing = _REQUIRED_AGENTS - set(_AGENT_DEFS)
if _missing:
    raise RuntimeError(f"Plugin {PLUGIN_DIR} is missing agent definitions: {_missing}")


def _ts() -> int:
    return int(time.time() * 1000)


def _make_emitter(session_id: str, eq: asyncio.Queue, loop: asyncio.AbstractEventLoop):
    """Thread-safe emitter: callable from conversation worker threads."""
    def emit(
        event_type: str,
        agent_id: str,
        agent_name: str,
        parent_id: str | None,
        payload: dict[str, Any],
    ) -> None:
        data = json.dumps({
            "type": event_type,
            "agentId": agent_id,
            "agentName": agent_name,
            "parentAgentId": parent_id,
            "timestamp": _ts(),
            "sessionId": session_id,
            "payload": payload,
        })
        loop.call_soon_threadsafe(eq.put_nowait, data)
    return emit


def _conv_dir(conversation: Any) -> Path:
    """Resolve the workspace working directory of a conversation."""
    ws = getattr(getattr(conversation, "state", None), "workspace", None) \
        or getattr(conversation, "workspace", None)
    wd = getattr(ws, "working_dir", None) or ws
    return Path(str(wd))


# ── text extraction helpers (defensive across SDK content shapes) ─────────────

def _text_of(x: Any) -> str:
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    if isinstance(x, (list, tuple)):
        return "".join(_text_of(i) for i in x)
    t = getattr(x, "text", None)
    return t if isinstance(t, str) else ""


def _action_args(action: Any) -> dict[str, Any]:
    try:
        d = action.model_dump(mode="json")
        d.pop("kind", None)
        return d
    except Exception:
        return {}


def _obs_text(obs: Any) -> str:
    s = _text_of(getattr(obs, "content", None))
    if s:
        return s
    try:
        return json.dumps(obs.model_dump(mode="json"))[:2000]
    except Exception:
        return str(obs)


def _msg_text(message: Any) -> str:
    return _text_of(getattr(message, "content", None))


# ── custom tools ──────────────────────────────────────────────────────────────

class WebSearchAction(Action):
    query: str = Field(description="The search query")


class WebSearchObservation(Observation):
    pass


class WebSearchExecutor(ToolExecutor):
    def __call__(self, action: WebSearchAction, conversation=None) -> WebSearchObservation:
        try:
            from ddgs import DDGS  # type: ignore
            # Bound the call: DuckDuckGo rate-limits under parallel researchers,
            # and a hung request would block this conversation's worker thread
            # indefinitely. timeout makes it fail fast into the except branch.
            with DDGS(timeout=15) as ddgs:
                results = [
                    {"title": r.get("title", ""), "url": r.get("href", ""),
                     "snippet": r.get("body", "")}
                    for r in ddgs.text(action.query, max_results=5)
                ]
        except Exception as exc:
            results = [{"title": "search unavailable", "url": "", "snippet": str(exc)}]
        return WebSearchObservation.from_text(text=json.dumps({"results": results}))


class WebSearchTool(ToolDefinition[WebSearchAction, WebSearchObservation]):
    @classmethod
    def create(cls, conv_state=None, **params) -> Sequence[Self]:
        return [cls(
            description="Search the web for information on a topic. Returns a list of relevant results.",
            action_type=WebSearchAction,
            observation_type=WebSearchObservation,
            executor=WebSearchExecutor(),
        )]


class WriteFileAction(Action):
    filename: str = Field(description="Filename e.g. notes-topic.md")
    content: str = Field(description="Full markdown content to write")


class WriteFileObservation(Observation):
    pass


class WriteFileExecutor(ToolExecutor):
    def __call__(self, action: WriteFileAction, conversation=None) -> WriteFileObservation:
        session_dir = _conv_dir(conversation)
        path = session_dir / action.filename
        path.write_text(action.content, encoding="utf-8")
        return WriteFileObservation.from_text(text=json.dumps(
            {"success": True, "path": str(path), "bytes": len(action.content)}
        ))


class WriteFileTool(ToolDefinition[WriteFileAction, WriteFileObservation]):
    @classmethod
    def create(cls, conv_state=None, **params) -> Sequence[Self]:
        return [cls(
            description="Save research notes or a report to a markdown file.",
            action_type=WriteFileAction,
            observation_type=WriteFileObservation,
            executor=WriteFileExecutor(),
        )]


class AskUserAction(Action):
    question: str = Field(description="The question to ask the user")


class AskUserObservation(Observation):
    pass


class AskUserExecutor(ToolExecutor):
    def __call__(self, action: AskUserAction, conversation=None) -> AskUserObservation:
        ctx = _SESSION_CTX.get(str(_conv_dir(conversation)))
        if ctx is None:
            return AskUserObservation.from_text(text="(no user available — proceed with your best interpretation)")
        # Block this conversation thread until the user answers via POST /api/answer.
        fut = asyncio.run_coroutine_threadsafe(ctx["answer_queue"].get(), ctx["loop"])
        answer = fut.result()
        return AskUserObservation.from_text(text=str(answer))


class AskUserTool(ToolDefinition[AskUserAction, AskUserObservation]):
    @classmethod
    def create(cls, conv_state=None, **params) -> Sequence[Self]:
        return [cls(
            description=(
                "Pause and ask the user a clarifying question when the research "
                "scope is ambiguous or spans multiple conflicting domains."
            ),
            action_type=AskUserAction,
            observation_type=AskUserObservation,
            executor=AskUserExecutor(),
        )]


register_tool("web_search", WebSearchTool)
register_tool("write_file", WriteFileTool)
register_tool("ask_user", AskUserTool)


# ── SDK event → SSE event translation ────────────────────────────────────────

def _make_callback(
    emit,
    agent_id: str,
    agent_name: str,
    parent_id: str | None,
    collector: dict[str, Any],
    session_dir: Path,
):
    tool_inputs: dict[str, tuple[str, dict[str, Any]]] = {}

    def cb(event) -> None:
        if isinstance(event, ActionEvent):
            thought = _text_of(event.thought) or _text_of(event.reasoning_content)
            if thought:
                emit("thinking", agent_id, agent_name, parent_id,
                     {"text": thought, "delta": False})

            name = event.tool_name
            args = _action_args(event.action)

            # The harness's finish tool ends the agent loop — capture its
            # message as the agent's final answer instead of showing a tool.
            if name == "finish":
                msg = args.get("message", "")
                if msg:
                    collector["final"] = msg
                return

            tuid = str(event.tool_call_id)
            tool_inputs[tuid] = (name, args)
            emit("tool_start", agent_id, agent_name, parent_id,
                 {"toolName": name, "toolUseId": tuid, "input": args})
            if name == "ask_user":
                emit("ask_user", agent_id, agent_name, parent_id,
                     {"question": args.get("question", ""), "questionId": f"q-{tuid}"})

        elif isinstance(event, ObservationEvent):
            name = event.tool_name
            if name == "finish":
                return
            tuid = str(event.tool_call_id)
            out_text = _obs_text(event.observation)

            if name == "ask_user":
                emit("ask_user_answered", agent_id, agent_name, parent_id,
                     {"questionId": f"q-{tuid}", "answer": out_text})

            stored = tool_inputs.get(tuid)
            if name == "write_file" and stored:
                _, args = stored
                filename = args.get("filename", "output.md")
                content = args.get("content", "")
                emit("artifact", agent_id, agent_name, parent_id, {
                    "filename": filename,
                    "contentSnippet": content[:500] + ("…" if len(content) > 500 else ""),
                    "fullPath": str(session_dir / filename),
                    "mimeType": "text/markdown",
                })
                collector.setdefault("artifacts", []).append(filename)

            try:
                out_obj: Any = json.loads(out_text)
            except (json.JSONDecodeError, TypeError):
                out_obj = {"result": out_text}
            emit("tool_end", agent_id, agent_name, parent_id,
                 {"toolName": name, "toolUseId": tuid, "output": out_obj})

        elif isinstance(event, MessageEvent):
            if str(getattr(event, "source", "")) == "agent":
                text = _msg_text(event.llm_message)
                if text:
                    collector["final"] = text
                    emit("thinking", agent_id, agent_name, parent_id,
                         {"text": text, "delta": False})

        elif isinstance(event, AgentErrorEvent):
            emit("error", agent_id, agent_name, parent_id,
                 {"message": str(event.error), "recoverable": True})

    return cb


# ── conversation runner ───────────────────────────────────────────────────────

def _make_agent(llm: LLM, defn) -> Agent:
    return Agent(
        llm=llm,
        system_prompt=defn.system_prompt,
        tools=[Tool(name=t) for t in defn.tools],
        mcp_config=_MCP_CONFIG,
    )


# Bounds on a single stage. The iteration cap is the primary guard: it stops a
# model that loops through endless search/think rounds (observed with the free
# DeepSeek model). The wall-clock timeout is a backstop so one stuck stage can
# never hang the whole pipeline — the orphaned worker thread is itself bounded
# by the LLM timeout + iteration cap, so it cannot run forever.
_STAGE_MAX_ITERATIONS = 12
_STAGE_TIMEOUT_S = 240


async def _run_conversation(
    llm: LLM,
    defn,
    user_message: str,
    agent_id: str,
    agent_name: str,
    parent_id: str | None,
    emit,
    session_dir: Path,
    collector: dict[str, Any],
) -> None:
    """Run one SDK Conversation to completion in a worker thread, bounded by an
    iteration cap and a wall-clock timeout so a stuck stage can't stall the run."""
    agent = _make_agent(llm, defn)
    callback = _make_callback(emit, agent_id, agent_name, parent_id, collector, session_dir)

    def _go() -> None:
        conv = Conversation(
            agent=agent,
            workspace=str(session_dir),
            callbacks=[callback],
            visualizer=None,
            hook_config=_HOOK_CONFIG,
            max_iteration_per_run=_STAGE_MAX_ITERATIONS,
        )
        try:
            conv.send_message(user_message)
            conv.run()
        finally:
            try:
                conv.close()
            except Exception:
                pass

    try:
        await asyncio.wait_for(asyncio.to_thread(_go), timeout=_STAGE_TIMEOUT_S)
    except asyncio.TimeoutError:
        # Stage exceeded its wall-clock budget. Surface a recoverable error and
        # let the pipeline continue with whatever this stage produced so far.
        emit("error", agent_id, agent_name, parent_id,
             {"message": f"{agent_name} timed out after {_STAGE_TIMEOUT_S}s — continuing",
              "recoverable": True})


# ── main entry point ──────────────────────────────────────────────────────────

async def run_openhands(
    session_id: str,
    query: str,
    event_queue: asyncio.Queue,
    answer_queue: asyncio.Queue,
) -> None:
    if not ZEN_API_KEY:
        raise RuntimeError("ZEN_API_KEY not set. Add it to backend/.env")

    loop = asyncio.get_running_loop()
    emit = _make_emitter(session_id, event_queue, loop)
    session_dir = Path(tempfile.gettempdir()) / "deep-analyst" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    _SESSION_CTX[str(session_dir)] = {"loop": loop, "answer_queue": answer_queue}

    # OpenCode Zen via litellm's OpenAI-compatible route.
    # timeout/num_retries bound a slow or stuck gateway turn so it can't hang
    # a stage's worker thread indefinitely.
    llm = LLM(
        model=f"openai/{ZEN_MODEL}",
        base_url=ZEN_BASE_URL,
        api_key=SecretStr(ZEN_API_KEY),
        timeout=90,
        num_retries=2,
    )

    defs = _AGENT_DEFS  # loaded once from the deep-analyst plugin at import time

    lead_id, lead_name = "lead-analyst-1", "lead-analyst"

    try:
        emit("session_start", lead_id, lead_name, None, {"query": query})

        # 1. lead-analyst decomposes (may ask_user)
        emit("agent_start", lead_id, lead_name, None, {"role": "orchestrator"})
        lead_col: dict[str, Any] = {}
        await _run_conversation(
            llm, defs["lead-analyst"], f"Research request: {query}",
            lead_id, lead_name, None, emit, session_dir, lead_col,
        )
        subtopics = _parse_subtopics(lead_col.get("final", ""), query)

        # 2. spawn Task events
        for i, subtopic in enumerate(subtopics, 1):
            emit("tool_start", lead_id, lead_name, None, {
                "toolName": "Task", "toolUseId": f"task-wr{i}",
                "input": {"agent": "web-researcher", "prompt": subtopic},
            })

        # 3. parallel web-researchers
        async def _research(i: int, subtopic: str) -> tuple[str, str]:
            agent_id = f"web-researcher-{i}"
            slug = re.sub(r"[^a-z0-9]+", "-", subtopic.lower())[:35].strip("-")
            filename = f"notes-{slug}.md"
            emit("agent_start", agent_id, "web-researcher", lead_id,
                 {"role": "sub-agent", "subtopic": subtopic})
            col: dict[str, Any] = {}
            await _run_conversation(
                llm, defs["web-researcher"],
                f"Overall research topic: {query}\n"
                f"Your assigned subtopic: {subtopic}\n\n"
                f"Research this subtopic in the context of the overall topic, then "
                f"save your notes with write_file using filename='{filename}'.",
                agent_id, "web-researcher", lead_id, emit, session_dir, col,
            )
            emit("agent_end", agent_id, "web-researcher", lead_id, {"status": "completed"})
            p = session_dir / filename
            return filename, p.read_text(encoding="utf-8") if p.exists() else ""

        results = await asyncio.gather(
            *[_research(i, st) for i, st in enumerate(subtopics, 1)],
            return_exceptions=True,
        )

        notes: dict[str, str] = {}
        for i, result in enumerate(results, 1):
            if isinstance(result, BaseException):
                emit("error", f"web-researcher-{i}", "web-researcher", lead_id,
                     {"message": str(result), "recoverable": True})
            else:
                fname, content = result
                notes[fname] = content
                emit("tool_end", lead_id, lead_name, None, {
                    "toolName": "Task", "toolUseId": f"task-wr{i}",
                    "output": {"result": f"Notes saved: {fname}"},
                })

        combined = "\n\n---\n\n".join(f"## {f}\n{c}" for f, c in notes.items())

        # 4. data-analyst
        emit("tool_start", lead_id, lead_name, None, {
            "toolName": "Task", "toolUseId": "task-da",
            "input": {"agent": "data-analyst", "prompt": "Analyse research notes"},
        })
        emit("agent_start", "data-analyst-1", "data-analyst", lead_id, {"role": "sub-agent"})
        da_col: dict[str, Any] = {}
        await _run_conversation(
            llm, defs["data-analyst"], f"Research notes:\n\n{combined}",
            "data-analyst-1", "data-analyst", lead_id, emit, session_dir, da_col,
        )
        emit("agent_end", "data-analyst-1", "data-analyst", lead_id, {"status": "completed"})
        emit("tool_end", lead_id, lead_name, None, {
            "toolName": "Task", "toolUseId": "task-da", "output": {"result": "Analysis complete"},
        })
        analysis_path = session_dir / "analysis-summary.md"
        analysis = analysis_path.read_text(encoding="utf-8") if analysis_path.exists() else ""

        # 5. report-writer
        emit("tool_start", lead_id, lead_name, None, {
            "toolName": "Task", "toolUseId": "task-rw",
            "input": {"agent": "report-writer", "prompt": "Write final research brief"},
        })
        emit("agent_start", "report-writer-1", "report-writer", lead_id, {"role": "sub-agent"})
        rw_col: dict[str, Any] = {}
        await _run_conversation(
            llm, defs["report-writer"],
            f"Query: {query}\n\n=== Research Notes ===\n{combined}\n\n=== Data Analysis ===\n{analysis}",
            "report-writer-1", "report-writer", lead_id, emit, session_dir, rw_col,
        )
        emit("agent_end", "report-writer-1", "report-writer", lead_id, {"status": "completed"})
        emit("tool_end", lead_id, lead_name, None, {
            "toolName": "Task", "toolUseId": "task-rw", "output": {"result": "Brief written"},
        })

        # 6. final response
        summary = (
            f"Research on '{query}' complete. Three parallel investigators covered: "
            f"{', '.join(s.split('—')[0].strip() for s in subtopics[:2])}… "
            "See research-brief.md for the full report."
        )
        emit("agent_response", lead_id, lead_name, None, {"text": summary})
        emit("agent_end", lead_id, lead_name, None, {"status": "completed"})
        emit("done", lead_id, lead_name, None, {})

    except Exception as exc:
        emit("error", lead_id, lead_name, None, {"message": str(exc), "recoverable": False})
        emit("agent_end", lead_id, lead_name, None, {"status": "failed", "message": str(exc)})
        emit("done", lead_id, lead_name, None, {})
        raise
    finally:
        _SESSION_CTX.pop(str(session_dir), None)


# ── helpers ───────────────────────────────────────────────────────────────────

def _parse_subtopics(text: str, query: str) -> list[str]:
    m = re.search(r'"subtopics"\s*:\s*(\[.*?\])', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))[:3]
        except json.JSONDecodeError:
            pass
    m = re.search(r'\[([^\[\]]+)\]', text, re.DOTALL)
    if m:
        try:
            items = json.loads(f"[{m.group(1)}]")
            if isinstance(items, list) and all(isinstance(i, str) for i in items):
                return items[:3]
        except json.JSONDecodeError:
            pass
    lines = [re.sub(r'^\s*\d+[\.\)]\s*', '', l).strip()
             for l in text.split('\n') if re.match(r'^\s*\d+[\.\)]', l)]
    if len(lines) >= 3:
        return lines[:3]
    return [
        f"{query} — current landscape and key players",
        f"{query} — market data, metrics and trends",
        f"{query} — risks, challenges and future outlook",
    ]
