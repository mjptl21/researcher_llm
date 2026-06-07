"""
Zen runner — real multi-agent research via OpenCode Zen gateway.

Uses the OpenAI-compatible SDK so it works with ALL Zen models:
  Claude (claude-sonnet-4-5, claude-haiku-4-5, …)
  DeepSeek (deepseek-v4-flash-free, …)
  Nemotron, Qwen, Grok, Gemini, …

Correct base URL for the OpenAI SDK:
  ZEN_BASE_URL=https://opencode.ai/zen/v1
  (OpenAI SDK appends /chat/completions → full path is /zen/v1/chat/completions)

Pipeline (same interface as dummy_runner.py):
  lead-analyst   → decomposes query into 3 subtopics (+ optional ask_user)
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
from pathlib import Path
from typing import Any


from openai import AsyncOpenAI

# ── config ────────────────────────────────────────────────────────────────────

ZEN_API_KEY  = os.getenv("ZEN_API_KEY", "")
ZEN_BASE_URL = os.getenv("ZEN_BASE_URL", "https://opencode.ai/zen/v1")
ZEN_MODEL    = os.getenv("ZEN_MODEL", "deepseek-v4-flash-free")


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=ZEN_API_KEY,
        base_url=ZEN_BASE_URL,
    )


# ── event helpers ─────────────────────────────────────────────────────────────

def _ts() -> int:
    return int(time.time() * 1000)


def _evt(
    event_type: str,
    agent_id: str,
    agent_name: str,
    parent_id: str | None,
    session_id: str,
    payload: dict[str, Any],
) -> str:
    return json.dumps({
        "type": event_type,
        "agentId": agent_id,
        "agentName": agent_name,
        "parentAgentId": parent_id,
        "timestamp": _ts(),
        "sessionId": session_id,
        "payload": payload,
    })


def _make_emitter(session_id: str, eq: asyncio.Queue):
    async def emit(
        event_type: str,
        agent_id: str,
        agent_name: str,
        parent_id: str | None,
        payload: dict[str, Any],
        delay: float = 0.0,
    ) -> None:
        await eq.put(_evt(event_type, agent_id, agent_name, parent_id, session_id, payload))
        if delay:
            await asyncio.sleep(delay)
    return emit


# ── tool definitions (OpenAI function-calling format) ─────────────────────────

_WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for information on a topic. Returns a list of relevant results.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query"},
            },
            "required": ["query"],
        },
    },
}

_WRITE_FILE_TOOL = {
    "type": "function",
    "function": {
        "name": "write_file",
        "description": "Save research notes or a report to a markdown file.",
        "parameters": {
            "type": "object",
            "properties": {
                "filename": {"type": "string", "description": "Filename e.g. notes-topic.md"},
                "content":  {"type": "string", "description": "Full markdown content to write"},
            },
            "required": ["filename", "content"],
        },
    },
}

_ASK_USER_TOOL = {
    "type": "function",
    "function": {
        "name": "ask_user",
        "description": (
            "Pause and ask the user a clarifying question when the research scope "
            "is ambiguous or spans multiple conflicting domains."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The question to ask"},
            },
            "required": ["question"],
        },
    },
}


# ── web search (DuckDuckGo — no API key required) ────────────────────────────

async def _handle_web_search(query: str) -> list[dict]:
    from ddgs import DDGS  # type: ignore

    def _ddg() -> list[dict]:
        with DDGS() as ddgs:
            return [
                {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
                for r in ddgs.text(query, max_results=5)
            ]

    return await asyncio.to_thread(_ddg)


def _handle_write_file(session_dir: Path, filename: str, content: str) -> dict:
    path = session_dir / filename
    path.write_text(content, encoding="utf-8")
    return {"success": True, "path": str(path), "bytes": len(content)}


# ── core streaming LLM call ───────────────────────────────────────────────────

async def _run_agent_llm(
    *,
    client: AsyncOpenAI,
    agent_id: str,
    agent_name: str,
    parent_id: str | None,
    session_id: str,
    session_dir: Path,
    system: str,
    messages: list[dict],
    tools: list[dict],
    emit,
    answer_queue: asyncio.Queue | None = None,
) -> tuple[str, list[str]]:
    """
    Streams one agent turn via Zen OpenAI-compatible endpoint.
    Handles tool calls (web_search, write_file, ask_user) in a loop.
    Returns (final_text, list_of_artifact_filenames).
    """
    final_text = ""
    artifacts: list[str] = []
    tool_use_counter = 0

    # Prepend system message in OpenAI format
    full_messages: list[dict] = [{"role": "system", "content": system}] + messages

    while True:
        # ── stream one LLM turn ───────────────────────────────────────────────
        thinking_text = ""
        thinking_started = False
        finish_reason = None
        tool_calls_acc: dict[int, dict] = {}  # index → accumulated tool call

        stream = await client.chat.completions.create(
            model=ZEN_MODEL,
            messages=full_messages,
            tools=tools or None,
            tool_choice="auto" if tools else None,
            stream=True,
            max_tokens=2048,
        )

        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if not choice:
                continue

            delta = choice.delta

            # Text chunk
            if delta.content:
                thinking_text += delta.content
                if not thinking_started:
                    await emit("thinking", agent_id, agent_name, parent_id,
                               {"text": delta.content, "delta": False})
                    thinking_started = True
                else:
                    await emit("thinking", agent_id, agent_name, parent_id,
                               {"text": delta.content, "delta": True})

            # Tool call deltas (accumulate across chunks)
            if delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tool_calls_acc:
                        tool_calls_acc[idx] = {"id": "", "name": "", "arguments": ""}
                    if tc_delta.id:
                        tool_calls_acc[idx]["id"] = tc_delta.id
                    if tc_delta.function:
                        if tc_delta.function.name:
                            tool_calls_acc[idx]["name"] += tc_delta.function.name
                        if tc_delta.function.arguments:
                            tool_calls_acc[idx]["arguments"] += tc_delta.function.arguments

            if choice.finish_reason:
                finish_reason = choice.finish_reason

        final_text = thinking_text

        # ── no tool calls — agent is done ─────────────────────────────────────
        if finish_reason != "tool_calls" or not tool_calls_acc:
            break

        # ── process accumulated tool calls ────────────────────────────────────
        tool_calls_list = [tool_calls_acc[i] for i in sorted(tool_calls_acc.keys())]

        # Add assistant message with tool calls to history
        full_messages.append({
            "role": "assistant",
            "content": thinking_text or None,
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]},
                }
                for tc in tool_calls_list
            ],
        })

        for tc in tool_calls_list:
            tool_use_counter += 1
            tuid = f"{agent_id}-tool-{tool_use_counter}"
            tool_input = json.loads(tc["arguments"] or "{}")

            await emit("tool_start", agent_id, agent_name, parent_id,
                       {"toolName": tc["name"], "toolUseId": tuid, "input": tool_input})

            # ── ask_user ──────────────────────────────────────────────────────
            if tc["name"] == "ask_user":
                question = tool_input.get("question", "")
                q_id = f"q-{tuid}"
                await emit("ask_user", agent_id, agent_name, parent_id,
                           {"question": question, "questionId": q_id})
                answer = await (answer_queue or asyncio.Queue()).get()
                await emit("ask_user_answered", agent_id, agent_name, parent_id,
                           {"questionId": q_id, "answer": answer})
                tool_output = answer

            # ── web_search ────────────────────────────────────────────────────
            elif tc["name"] == "web_search":
                results = await _handle_web_search(tool_input.get("query", ""))
                tool_output = json.dumps({"results": results})

            # ── write_file ────────────────────────────────────────────────────
            elif tc["name"] == "write_file":
                filename = tool_input.get("filename", "output.md")
                content  = tool_input.get("content", "")
                result   = _handle_write_file(session_dir, filename, content)
                tool_output = json.dumps(result)
                snippet = content[:500] + ("…" if len(content) > 500 else "")
                await emit("artifact", agent_id, agent_name, parent_id, {
                    "filename": filename,
                    "contentSnippet": snippet,
                    "fullPath": result["path"],
                    "mimeType": "text/markdown",
                })
                artifacts.append(filename)

            else:
                tool_output = json.dumps({"error": f"Unknown tool: {tc['name']}"})

            await emit("tool_end", agent_id, agent_name, parent_id,
                       {"toolName": tc["name"], "toolUseId": tuid, "output": json.loads(tool_output) if tool_output.startswith('{') else {"result": tool_output}})

            # Add tool result to conversation
            full_messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": tool_output,
            })

        # Reset thinking for next turn
        thinking_started = False
        thinking_text = ""

    return final_text, artifacts


# ── individual agent coroutines ───────────────────────────────────────────────

async def _lead_analyst_decompose(
    client, session_id, query, emit, answer_queue, session_dir
) -> list[str]:
    agent_id, agent_name, parent_id = "lead-analyst-1", "lead-analyst", None
    await emit("agent_start", agent_id, agent_name, parent_id, {"role": "orchestrator"})

    system = (
        "You are a lead research analyst. Decompose the research request into exactly "
        "3 focused, complementary subtopics for parallel investigation.\n\n"
        "If the query is ambiguous, use the ask_user tool to clarify before decomposing.\n\n"
        "After any clarification, respond with ONLY a valid JSON object:\n"
        '{"subtopics": ["subtopic 1", "subtopic 2", "subtopic 3"]}\n\n'
        "No other text — just the JSON object."
    )

    text, _ = await _run_agent_llm(
        client=client, agent_id=agent_id, agent_name=agent_name, parent_id=parent_id,
        session_id=session_id, session_dir=session_dir, system=system,
        messages=[{"role": "user", "content": f"Research request: {query}"}],
        tools=[_ASK_USER_TOOL], emit=emit, answer_queue=answer_queue,
    )
    return _parse_subtopics(text, query)


async def _web_researcher(
    client, session_id, idx, subtopic, parent_id, emit, session_dir
) -> tuple[str, str]:
    agent_id   = f"web-researcher-{idx}"
    agent_name = "web-researcher"
    slug       = re.sub(r"[^a-z0-9]+", "-", subtopic.lower())[:35].strip("-")
    filename   = f"notes-{slug}.md"

    await emit("agent_start", agent_id, agent_name, parent_id,
               {"role": "sub-agent", "subtopic": subtopic}, delay=idx * 0.05)

    system = (
        f"You are a specialist web researcher. Your subtopic: {subtopic}\n\n"
        "Steps:\n"
        "1. Call web_search with 1–2 targeted queries.\n"
        "2. Write detailed markdown research notes (300–500 words) with headings, "
        "specific facts, numbers, and trends.\n"
        f"3. Call write_file with filename='{filename}' and your complete notes."
    )

    _, arts = await _run_agent_llm(
        client=client, agent_id=agent_id, agent_name=agent_name, parent_id=parent_id,
        session_id=session_id, session_dir=session_dir, system=system,
        messages=[{"role": "user", "content": f"Research: {subtopic}"}],
        tools=[_WEB_SEARCH_TOOL, _WRITE_FILE_TOOL], emit=emit,
    )

    await emit("agent_end", agent_id, agent_name, parent_id, {"status": "completed"})
    path = session_dir / filename
    return filename, path.read_text(encoding="utf-8") if path.exists() else ""


async def _data_analyst(
    client, session_id, notes: dict[str, str], parent_id, emit, session_dir
) -> str:
    agent_id, agent_name = "data-analyst-1", "data-analyst"
    await emit("agent_start", agent_id, agent_name, parent_id, {"role": "sub-agent"})

    combined = "\n\n---\n\n".join(f"## {f}\n{c}" for f, c in notes.items())
    system = (
        "You are a data analyst. From the research notes, extract key metrics and produce:\n"
        "- A comparison table (markdown, 4+ rows)\n"
        "- Key quantitative findings\n"
        "- A 'Key Takeaways' section (3–5 bullets)\n\n"
        "Save with write_file, filename='analysis-summary.md'."
    )

    await _run_agent_llm(
        client=client, agent_id=agent_id, agent_name=agent_name, parent_id=parent_id,
        session_id=session_id, session_dir=session_dir, system=system,
        messages=[{"role": "user", "content": f"Research notes:\n\n{combined}"}],
        tools=[_WRITE_FILE_TOOL], emit=emit,
    )

    await emit("agent_end", agent_id, agent_name, parent_id, {"status": "completed"})
    p = session_dir / "analysis-summary.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


async def _report_writer(
    client, session_id, query, notes: dict[str, str], analysis: str,
    parent_id, emit, session_dir,
) -> str:
    agent_id, agent_name = "report-writer-1", "report-writer"
    await emit("agent_start", agent_id, agent_name, parent_id, {"role": "sub-agent"})

    combined = "\n\n---\n\n".join(f"## {f}\n{c}" for f, c in notes.items())
    system = (
        "You are a research report writer. Synthesise all inputs into a comprehensive brief.\n\n"
        "Structure:\n"
        "# Research Brief: <title>\n"
        "## Executive Summary (3–4 sentences)\n"
        "## Key Findings (5–7 bullets)\n"
        "## Detailed Analysis (2–3 paragraphs)\n"
        "## Strategic Implications (3–4 bullets)\n"
        "## Conclusion\n\n"
        "Save with write_file, filename='research-brief.md'. Target: 600–900 words."
    )
    context = (
        f"Query: {query}\n\n=== Research Notes ===\n{combined}\n\n"
        f"=== Data Analysis ===\n{analysis}"
    )

    text, _ = await _run_agent_llm(
        client=client, agent_id=agent_id, agent_name=agent_name, parent_id=parent_id,
        session_id=session_id, session_dir=session_dir, system=system,
        messages=[{"role": "user", "content": context}],
        tools=[_WRITE_FILE_TOOL], emit=emit,
    )

    await emit("agent_end", agent_id, agent_name, parent_id, {"status": "completed"})
    p = session_dir / "research-brief.md"
    return p.read_text(encoding="utf-8") if p.exists() else text


# ── main entry point ──────────────────────────────────────────────────────────

async def run_zen(
    session_id: str,
    query: str,
    event_queue: asyncio.Queue,
    answer_queue: asyncio.Queue,
) -> None:
    if not ZEN_API_KEY:
        raise RuntimeError("ZEN_API_KEY not set. Add it to backend/.env")

    client = _client()
    emit   = _make_emitter(session_id, event_queue)
    session_dir = Path(tempfile.gettempdir()) / "deep-analyst" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    try:
        await emit("session_start", "lead-analyst-1", "lead-analyst", None, {"query": query})

        # 1. lead-analyst decomposes
        subtopics = await _lead_analyst_decompose(
            client, session_id, query, emit, answer_queue, session_dir
        )

        # 2. spawn Task events
        for i, subtopic in enumerate(subtopics, 1):
            await emit("tool_start", "lead-analyst-1", "lead-analyst", None, {
                "toolName": "Task", "toolUseId": f"task-wr{i}",
                "input": {"agent": "web-researcher", "prompt": subtopic},
            })

        # 3. parallel web-researchers
        results = await asyncio.gather(
            *[_web_researcher(client, session_id, i, st, "lead-analyst-1", emit, session_dir)
              for i, st in enumerate(subtopics, 1)],
            return_exceptions=True,
        )

        notes: dict[str, str] = {}
        for i, result in enumerate(results, 1):
            if isinstance(result, Exception):
                await emit("error", f"web-researcher-{i}", "web-researcher", "lead-analyst-1",
                           {"message": str(result), "recoverable": True})
            else:
                fname, content = result
                notes[fname] = content
                await emit("tool_end", "lead-analyst-1", "lead-analyst", None, {
                    "toolName": "Task", "toolUseId": f"task-wr{i}",
                    "output": {"result": f"Notes saved: {fname}"},
                })

        # 4. data-analyst
        await emit("tool_start", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task", "toolUseId": "task-da",
            "input": {"agent": "data-analyst", "prompt": "Analyse research notes"},
        })
        analysis = await _data_analyst(client, session_id, notes, "lead-analyst-1", emit, session_dir)
        await emit("tool_end", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task", "toolUseId": "task-da", "output": {"result": "Analysis complete"},
        })

        # 5. report-writer
        await emit("tool_start", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task", "toolUseId": "task-rw",
            "input": {"agent": "report-writer", "prompt": "Write final research brief"},
        })
        await _report_writer(
            client, session_id, query, notes, analysis, "lead-analyst-1", emit, session_dir
        )
        await emit("tool_end", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task", "toolUseId": "task-rw", "output": {"result": "Brief written"},
        })

        # 6. final response
        summary = (
            f"Research on '{query}' complete. Three parallel investigators covered: "
            f"{', '.join(s.split('—')[0].strip() for s in subtopics[:2])}… "
            "See research-brief.md for the full report."
        )
        await emit("agent_response", "lead-analyst-1", "lead-analyst", None, {"text": summary})
        await emit("agent_end", "lead-analyst-1", "lead-analyst", None, {"status": "completed"})
        await emit("done", "lead-analyst-1", "lead-analyst", None, {})

    except Exception as exc:
        await emit("error", "lead-analyst-1", "lead-analyst", None,
                   {"message": str(exc), "recoverable": False})
        await emit("agent_end", "lead-analyst-1", "lead-analyst", None,
                   {"status": "failed", "message": str(exc)})
        await emit("done", "lead-analyst-1", "lead-analyst", None, {})
        raise


# ── helpers ───────────────────────────────────────────────────────────────────

def _parse_subtopics(text: str, query: str) -> list[str]:
    # JSON object
    m = re.search(r'"subtopics"\s*:\s*(\[.*?\])', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))[:3]
        except json.JSONDecodeError:
            pass
    # Bare JSON array
    m = re.search(r'\[([^\[\]]+)\]', text, re.DOTALL)
    if m:
        try:
            items = json.loads(f"[{m.group(1)}]")
            if isinstance(items, list) and all(isinstance(i, str) for i in items):
                return items[:3]
        except json.JSONDecodeError:
            pass
    # Numbered list
    lines = [re.sub(r'^\s*\d+[\.\)]\s*', '', l).strip()
             for l in text.split('\n') if re.match(r'^\s*\d+[\.\)]', l)]
    if len(lines) >= 3:
        return lines[:3]
    # Fallback
    return [
        f"{query} — landscape and key players",
        f"{query} — market trends and growth data",
        f"{query} — practical applications and case studies",
    ]
