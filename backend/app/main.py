import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.routers import stream as stream_router
from app.routers import answer as answer_router

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
DUMMY_MODE    = os.getenv("DUMMY_MODE", "true").lower() == "true"
ZEN_MODE      = os.getenv("ZEN_MODE", "false").lower() == "true"
DUMMY_FIXTURE = os.getenv("DUMMY_FIXTURE", "full")
ZEN_MODEL     = os.getenv("ZEN_MODEL", "claude-sonnet-4-5")

app = FastAPI(
    title="Deep Analyst API",
    description="Agent-transparent research platform backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5174", "http://localhost:5175"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stream_router.router)
app.include_router(answer_router.router)


@app.get("/api/health")
async def health():
    mode = "dummy" if DUMMY_MODE else ("zen" if ZEN_MODE else "agent_sdk")
    return {
        "status": "ok",
        "mode": mode,
        "dummy_fixture": DUMMY_FIXTURE if DUMMY_MODE else None,
        "zen_model": ZEN_MODEL if ZEN_MODE else None,
        "zen_base_url": os.getenv("ZEN_BASE_URL", "https://opencode.ai/zen/v1") if ZEN_MODE else None,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
