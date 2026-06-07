from fastapi import APIRouter, HTTPException

from app.models import AnswerRequest
from app.session_manager import get_session

router = APIRouter()


@router.post("/api/answer/{session_id}")
async def submit_answer(session_id: str, body: AnswerRequest):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await session["answer_queue"].put(body.answer)
    return {"ok": True}
