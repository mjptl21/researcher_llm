"""
Session store — one entry per active run.

Each session carries:
  event_queue   asyncio.Queue[str]  — runner pushes; SSE endpoint pops
  answer_queue  asyncio.Queue[str]  — POST /answer pushes; runner pops (ask_user)
  event_buffer  list[dict]          — all emitted events, keyed by timestamp id
                                      used for stream reconnection + replay
"""
import asyncio
import json
from typing import TypedDict


class Session(TypedDict):
    event_queue:  asyncio.Queue
    answer_queue: asyncio.Queue
    event_buffer: list[dict]   # {"id": str, "data": str}


_sessions: dict[str, Session] = {}


def create_session(session_id: str) -> Session:
    session: Session = {
        "event_queue":  asyncio.Queue(),
        "answer_queue": asyncio.Queue(),
        "event_buffer": [],
    }
    _sessions[session_id] = session
    return session


def get_session(session_id: str) -> Session | None:
    return _sessions.get(session_id)


def remove_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


def buffer_event(session_id: str, event_id: str, data: str) -> None:
    """Record an event in the replay buffer."""
    session = _sessions.get(session_id)
    if session is not None:
        session["event_buffer"].append({"id": event_id, "data": data})


def get_events_after(session_id: str, last_event_id: str) -> list[dict]:
    """
    Return all buffered events that came after last_event_id.
    Used when a client reconnects with Last-Event-ID.
    """
    session = _sessions.get(session_id)
    if not session:
        return []
    buf = session["event_buffer"]
    # Find the index of the last_event_id
    for i, entry in enumerate(buf):
        if entry["id"] == last_event_id:
            return buf[i + 1:]   # everything after it
    # ID not found — replay the whole buffer (safe fallback)
    return buf


def parse_event_type(data: str) -> str | None:
    """Quick-parse the 'type' field from a JSON event string."""
    try:
        return json.loads(data).get("type")
    except Exception:
        return None
