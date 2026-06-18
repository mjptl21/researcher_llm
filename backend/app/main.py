import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

load_dotenv()

from app.routers import stream as stream_router
from app.routers import answer as answer_router

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
ZEN_MODEL       = os.getenv("ZEN_MODEL", "deepseek-v4-flash-free")
ZEN_BASE_URL    = os.getenv("ZEN_BASE_URL", "https://opencode.ai/zen/v1")

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
    # Single backend: OpenHands Agent SDK harness + OpenCode Zen models.
    return {
        "status": "ok",
        "mode": "openhands",
        "zen_model": ZEN_MODEL,
        "zen_base_url": ZEN_BASE_URL,
    }


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
