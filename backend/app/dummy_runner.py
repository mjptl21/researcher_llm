"""
Dummy runner — streams realistic multi-agent events with zero API calls or internet.

Supports two modes via DUMMY_FIXTURE env var:
  "full"     — lead-analyst → 3 parallel web-researchers → data-analyst → report-writer
  "ask_user" — same as full but pauses mid-run to ask the user a scoping question
  "error"    — web-researcher-2 fails midway, others complete

The event schema exactly matches what frontend/src/types/events.ts expects.
"""
import asyncio
import json
import os
import time
from typing import Any

FIXTURE = os.getenv("DUMMY_FIXTURE", "full")
DELAY = 0.12  # seconds between events


def ts() -> int:
    return int(time.time() * 1000)


def make_event(
    event_type: str,
    agent_id: str,
    agent_name: str,
    parent_id: str | None,
    session_id: str,
    payload: dict[str, Any],
) -> str:
    return json.dumps(
        {
            "type": event_type,
            "agentId": agent_id,
            "agentName": agent_name,
            "parentAgentId": parent_id,
            "timestamp": ts(),
            "sessionId": session_id,
            "payload": payload,
        }
    )


async def run_dummy(
    session_id: str,
    query: str,
    event_queue: asyncio.Queue,
    answer_queue: asyncio.Queue,
) -> None:
    """Entry point — dispatches to the correct fixture."""
    fixture = os.getenv("DUMMY_FIXTURE", "full")
    if fixture == "ask_user":
        await _run_ask_user(session_id, query, event_queue, answer_queue)
    elif fixture == "error":
        await _run_error(session_id, query, event_queue, answer_queue)
    else:
        await _run_full(session_id, query, event_queue, answer_queue)


# ─── helpers ──────────────────────────────────────────────────────────────────

async def _emit(queue: asyncio.Queue, event_str: str, delay: float = DELAY) -> None:
    await queue.put(event_str)
    await asyncio.sleep(delay)


def _subtopics(query: str) -> list[str]:
    """Derive 3 research subtopics from the query (no API needed)."""
    q = query.strip().rstrip("?")
    return [
        f"{q} — landscape and key players",
        f"{q} — trends and market data",
        f"{q} — practical applications and case studies",
    ]


def _slug(subtopic: str) -> str:
    return subtopic.split("—")[1].strip().replace(" ", "-").replace("/", "-")[:30].lower()


# ─── full fixture ─────────────────────────────────────────────────────────────

async def _run_full(
    session_id: str,
    query: str,
    eq: asyncio.Queue,
    _aq: asyncio.Queue,
) -> None:
    e = lambda t, ai, an, pi, pl: make_event(t, ai, an, pi, session_id, pl)

    subtopics = _subtopics(query)

    # ── session start
    await _emit(eq, e("session_start", "lead-analyst-1", "lead-analyst", None, {"query": query}))

    # ── lead-analyst boots
    await _emit(eq, e("agent_start", "lead-analyst-1", "lead-analyst", None, {"role": "orchestrator"}))
    await _emit(eq, e("thinking", "lead-analyst-1", "lead-analyst", None, {
        "text": f"Analyzing request: '{query}'. Breaking into 3 parallel research streams.",
        "delta": False,
    }), delay=0.3)
    await _emit(eq, e("thinking", "lead-analyst-1", "lead-analyst", None, {
        "text": " Dispatching specialized researchers now.",
        "delta": True,
    }))

    # ── spawn 3 web-researchers (overlapping start times → parallel)
    for i, subtopic in enumerate(subtopics, 1):
        await _emit(eq, e("tool_start", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task",
            "toolUseId": f"task-wr{i}",
            "input": {"agent": "web-researcher", "prompt": subtopic},
        }))
        await _emit(eq, e("agent_start", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "role": "sub-agent",
            "subtopic": subtopic,
        }), delay=0.05)  # fast spawning = overlapping timestamps

    # ── each researcher works (interleaved)
    for i, subtopic in enumerate(subtopics, 1):
        slug = _slug(subtopic)
        filename = f"notes-{slug}.md"

        await _emit(eq, e("thinking", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "text": f"Searching for: {subtopic}",
            "delta": False,
        }))
        await _emit(eq, e("tool_start", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "toolName": "WebSearch",
            "toolUseId": f"ws-{i}a",
            "input": {"query": subtopic},
        }))
        await asyncio.sleep(0.4)
        await _emit(eq, e("tool_end", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "toolName": "WebSearch",
            "toolUseId": f"ws-{i}a",
            "output": {"results": [
                {"title": f"Key findings on {subtopic}", "snippet": f"Recent analysis shows notable developments in {query}..."},
            ]},
        }))
        await _emit(eq, e("tool_start", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "toolName": "Write",
            "toolUseId": f"write-{i}",
            "input": {"path": f"/tmp/{session_id}/{filename}", "content": f"# {subtopic}\n\n..."},
        }))
        await _emit(eq, e("tool_end", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "toolName": "Write",
            "toolUseId": f"write-{i}",
            "output": {"success": True},
        }))
        await _emit(eq, e("artifact", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "filename": filename,
            "contentSnippet": f"# {subtopic.split('—')[0].strip()}\n\nKey findings on {query}:\n\n- Finding 1: significant recent developments\n- Finding 2: competitive landscape shifting\n- Finding 3: adoption accelerating",
            "fullPath": f"/tmp/{session_id}/{filename}",
            "mimeType": "text/markdown",
        }))
        await _emit(eq, e("agent_end", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "status": "completed",
        }))
        await _emit(eq, e("tool_end", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task",
            "toolUseId": f"task-wr{i}",
            "output": {"result": f"Notes saved to /tmp/{session_id}/{filename}"},
        }))

    # ── data-analyst (sequential after all researchers)
    await _emit(eq, e("tool_start", "lead-analyst-1", "lead-analyst", None, {
        "toolName": "Task",
        "toolUseId": "task-da",
        "input": {"agent": "data-analyst", "prompt": "Analyze research notes, extract key metrics and comparisons"},
    }))
    await _emit(eq, e("agent_start", "data-analyst-1", "data-analyst", "lead-analyst-1", {"role": "sub-agent"}))
    await _emit(eq, e("thinking", "data-analyst-1", "data-analyst", "lead-analyst-1", {
        "text": "Reading all research notes and extracting key metrics for comparison...",
        "delta": False,
    }))
    await asyncio.sleep(0.6)
    await _emit(eq, e("artifact", "data-analyst-1", "data-analyst", "lead-analyst-1", {
        "filename": "analysis-summary.md",
        "contentSnippet": (
            f"# Analysis: {query}\n\n"
            "| Dimension | Finding | Confidence |\n"
            "|-----------|---------|------------|\n"
            "| Landscape | 3 dominant players | High |\n"
            "| Trends | 40% YoY growth | High |\n"
            "| Adoption | Enterprise-first pattern | Medium |"
        ),
        "fullPath": f"/tmp/{session_id}/analysis-summary.md",
        "mimeType": "text/markdown",
    }))
    await _emit(eq, e("agent_end", "data-analyst-1", "data-analyst", "lead-analyst-1", {"status": "completed"}))
    await _emit(eq, e("tool_end", "lead-analyst-1", "lead-analyst", None, {
        "toolName": "Task",
        "toolUseId": "task-da",
        "output": {"result": "Analysis complete. Summary saved."},
    }))

    # ── report-writer (sequential after data-analyst)
    await _emit(eq, e("tool_start", "lead-analyst-1", "lead-analyst", None, {
        "toolName": "Task",
        "toolUseId": "task-rw",
        "input": {"agent": "report-writer", "prompt": "Write final research brief from all notes and analysis"},
    }))
    await _emit(eq, e("agent_start", "report-writer-1", "report-writer", "lead-analyst-1", {"role": "sub-agent"}))
    await _emit(eq, e("thinking", "report-writer-1", "report-writer", "lead-analyst-1", {
        "text": "Synthesizing all research notes and data analysis into a comprehensive brief...",
        "delta": False,
    }))
    await asyncio.sleep(0.8)
    await _emit(eq, e("artifact", "report-writer-1", "report-writer", "lead-analyst-1", {
        "filename": "research-brief.md",
        "contentSnippet": (
            f"# Research Brief: {query}\n\n"
            "## Executive Summary\n\n"
            f"This report synthesizes findings from three parallel research streams on {query}. "
            "Key themes: rapid market growth, consolidation among top players, and strong enterprise adoption.\n\n"
            "## Key Findings\n\n"
            "1. The landscape is evolving rapidly with clear leaders emerging\n"
            "2. Market data shows accelerating adoption curves\n"
            "3. Practical deployments are moving from pilots to production"
        ),
        "fullPath": f"/tmp/{session_id}/research-brief.md",
        "mimeType": "text/markdown",
    }))
    await _emit(eq, e("agent_end", "report-writer-1", "report-writer", "lead-analyst-1", {"status": "completed"}))
    await _emit(eq, e("tool_end", "lead-analyst-1", "lead-analyst", None, {
        "toolName": "Task",
        "toolUseId": "task-rw",
        "output": {"result": "Research brief written successfully."},
    }))

    # ── lead-analyst final response
    await _emit(eq, e("agent_response", "lead-analyst-1", "lead-analyst", None, {
        "text": (
            f"Research on '{query}' is complete. I ran three parallel investigators covering the landscape, "
            "market trends, and practical applications, followed by quantitative analysis and a synthesized brief. "
            "The attached research-brief.md contains the full report. Key takeaway: this area is growing rapidly "
            "with clear leaders and strong enterprise momentum."
        ),
    }))
    await _emit(eq, e("agent_end", "lead-analyst-1", "lead-analyst", None, {"status": "completed"}))
    await _emit(eq, e("done", "lead-analyst-1", "lead-analyst", None, {}))


# ─── ask_user fixture ─────────────────────────────────────────────────────────

async def _run_ask_user(
    session_id: str,
    query: str,
    eq: asyncio.Queue,
    aq: asyncio.Queue,
) -> None:
    e = lambda t, ai, an, pi, pl: make_event(t, ai, an, pi, session_id, pl)

    await _emit(eq, e("session_start", "lead-analyst-1", "lead-analyst", None, {"query": query}))
    await _emit(eq, e("agent_start", "lead-analyst-1", "lead-analyst", None, {"role": "orchestrator"}))
    await _emit(eq, e("thinking", "lead-analyst-1", "lead-analyst", None, {
        "text": f"The query '{query}' is broad. I should clarify the focus before dispatching researchers.",
        "delta": False,
    }), delay=0.4)

    # ── pause for user input
    question = (
        f"'{query}' spans several dimensions. Which angle matters most?\n\n"
        "(a) Technical landscape and key players\n"
        "(b) Market data and growth trends\n"
        "(c) Enterprise adoption and case studies\n"
        "(d) All of the above (I'll cover everything)"
    )
    await _emit(eq, e("ask_user", "lead-analyst-1", "lead-analyst", None, {
        "question": question,
        "questionId": "q-scope-001",
    }))

    # Block until the user answers via POST /api/answer
    answer: str = await aq.get()

    await _emit(eq, e("ask_user_answered", "lead-analyst-1", "lead-analyst", None, {
        "questionId": "q-scope-001",
        "answer": answer,
    }))
    await _emit(eq, e("thinking", "lead-analyst-1", "lead-analyst", None, {
        "text": f"User chose: '{answer}'. Scoping research accordingly and dispatching parallel researchers.",
        "delta": False,
    }), delay=0.3)

    # Proceed with 2 focused researchers based on the answer
    subtopics = [
        f"{query} — focused analysis based on: {answer}",
        f"{query} — supporting evidence and data",
    ]

    for i, subtopic in enumerate(subtopics, 1):
        await _emit(eq, e("tool_start", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task", "toolUseId": f"task-wr{i}",
            "input": {"agent": "web-researcher", "prompt": subtopic},
        }))
        await _emit(eq, e("agent_start", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "role": "sub-agent", "subtopic": subtopic,
        }), delay=0.05)

    for i, subtopic in enumerate(subtopics, 1):
        filename = f"notes-focused-{i}.md"
        await _emit(eq, e("thinking", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "text": f"Researching: {subtopic}", "delta": False,
        }))
        await asyncio.sleep(0.5)
        await _emit(eq, e("artifact", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "filename": filename,
            "contentSnippet": f"# {subtopic.split('—')[0].strip()}\n\nFindings relevant to: {answer}",
            "fullPath": f"/tmp/{session_id}/{filename}",
            "mimeType": "text/markdown",
        }))
        await _emit(eq, e("agent_end", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {"status": "completed"}))
        await _emit(eq, e("tool_end", "lead-analyst-1", "lead-analyst", None, {
            "toolName": "Task", "toolUseId": f"task-wr{i}",
            "output": {"result": f"Research complete for focus area {i}"},
        }))

    await _emit(eq, e("agent_response", "lead-analyst-1", "lead-analyst", None, {
        "text": f"Research complete, scoped to your priority: '{answer}'. Two focused research streams completed. See attached notes.",
    }))
    await _emit(eq, e("agent_end", "lead-analyst-1", "lead-analyst", None, {"status": "completed"}))
    await _emit(eq, e("done", "lead-analyst-1", "lead-analyst", None, {}))


# ─── error fixture ────────────────────────────────────────────────────────────

async def _run_error(
    session_id: str,
    query: str,
    eq: asyncio.Queue,
    _aq: asyncio.Queue,
) -> None:
    e = lambda t, ai, an, pi, pl: make_event(t, ai, an, pi, session_id, pl)

    subtopics = _subtopics(query)

    await _emit(eq, e("session_start", "lead-analyst-1", "lead-analyst", None, {"query": query}))
    await _emit(eq, e("agent_start", "lead-analyst-1", "lead-analyst", None, {"role": "orchestrator"}))
    await _emit(eq, e("thinking", "lead-analyst-1", "lead-analyst", None, {
        "text": "Dispatching 3 parallel researchers. One will encounter a rate-limit error.",
        "delta": False,
    }), delay=0.3)

    for i, subtopic in enumerate(subtopics, 1):
        await _emit(eq, e("agent_start", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "role": "sub-agent", "subtopic": subtopic,
        }), delay=0.05)

    # researcher-2 fails
    await _emit(eq, e("thinking", "web-researcher-1", "web-researcher", "lead-analyst-1", {
        "text": "Searching...", "delta": False,
    }))
    await _emit(eq, e("thinking", "web-researcher-3", "web-researcher", "lead-analyst-1", {
        "text": "Searching...", "delta": False,
    }))
    await asyncio.sleep(0.5)

    await _emit(eq, e("error", "web-researcher-2", "web-researcher", "lead-analyst-1", {
        "message": "WebSearch rate limit exceeded — retries exhausted after 3 attempts",
        "recoverable": False,
    }))
    await _emit(eq, e("agent_end", "web-researcher-2", "web-researcher", "lead-analyst-1", {
        "status": "failed", "message": "Rate limit",
    }))

    # others succeed
    for i in [1, 3]:
        slug = _slug(subtopics[i - 1])
        filename = f"notes-{slug}.md"
        await asyncio.sleep(0.4)
        await _emit(eq, e("artifact", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {
            "filename": filename,
            "contentSnippet": f"# {subtopics[i-1].split('—')[0].strip()}\n\nPartial findings on {query}...",
            "fullPath": f"/tmp/{session_id}/{filename}",
            "mimeType": "text/markdown",
        }))
        await _emit(eq, e("agent_end", f"web-researcher-{i}", "web-researcher", "lead-analyst-1", {"status": "completed"}))

    await _emit(eq, e("agent_response", "lead-analyst-1", "lead-analyst", None, {
        "text": f"Research partially complete. Note: one researcher (web-researcher-2) hit a rate limit. "
                "Two of three research streams succeeded — see attached notes.",
    }))
    await _emit(eq, e("agent_end", "lead-analyst-1", "lead-analyst", None, {"status": "completed"}))
    await _emit(eq, e("done", "lead-analyst-1", "lead-analyst", None, {}))
