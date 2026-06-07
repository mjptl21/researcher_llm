import asyncio
import os
import time
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.models import RunRequest, RunResponse
from app.session_manager import (
    create_session, get_session, buffer_event, get_events_after, parse_event_type
)

router = APIRouter()

DUMMY_MODE = os.getenv("DUMMY_MODE", "true").lower() == "true"
ZEN_MODE   = os.getenv("ZEN_MODE", "false").lower() == "true"


def _get_runner():
    if DUMMY_MODE:
        from app.dummy_runner import run_dummy
        return run_dummy
    if ZEN_MODE:
        from app.zen_runner import run_zen
        return run_zen
    from app.agent_runner import run_agent
    return run_agent


def _ts() -> str:
    return str(int(time.time() * 1000))


@router.post("/api/run", response_model=RunResponse)
async def start_run(body: RunRequest, background_tasks: BackgroundTasks):
    session_id = str(uuid4())
    session    = create_session(session_id)
    runner     = _get_runner()

    background_tasks.add_task(
        runner,
        session_id=session_id,
        query=body.query,
        event_queue=session["event_queue"],
        answer_queue=session["answer_queue"],
    )

    return RunResponse(sessionId=session_id)


@router.get("/api/stream/{session_id}")
async def stream_events(session_id: str, request: Request, lastEventId: str = ""):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    eq: asyncio.Queue = session["event_queue"]

    async def event_generator():
        # ── reconnect: replay missed events from buffer ───────────────────────
        replay_id = lastEventId or request.headers.get("Last-Event-ID", "")
        if replay_id:
            missed = get_events_after(session_id, replay_id)
            for entry in missed:
                yield {"data": entry["data"], "id": entry["id"]}
                if parse_event_type(entry["data"]) == "done":
                    return

        # ── live stream ───────────────────────────────────────────────────────
        while True:
            try:
                data: str = await asyncio.wait_for(eq.get(), timeout=60.0)
                event_id  = _ts()

                # Buffer before sending (so reconnects can replay)
                buffer_event(session_id, event_id, data)

                yield {"data": data, "id": event_id}

                if parse_event_type(data) == "done":
                    break
            except asyncio.TimeoutError:
                yield {"comment": "keep-alive"}

    return EventSourceResponse(event_generator())
