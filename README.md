# Deep Analyst

Agent-transparent research platform. Watch a multi-agent pipeline research any topic in real time.

## Prerequisites

- Node.js 18+
- Python 3.11+

---

## Setup — Real LLM (DeepSeek / Claude via OpenCode Zen)

**1. Backend**

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — set ZEN_API_KEY (get one free at https://opencode.ai)
# DUMMY_MODE=false, ZEN_MODE=true

uvicorn app.main:app --reload --port 8000
```

**2. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Environment variables (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `ZEN_MODE` | `true` | Enable real LLM via Zen gateway |
| `ZEN_API_KEY` | — | Required — get free at opencode.ai |
| `ZEN_MODEL` | `deepseek-v4-flash-free` | Any model slug supported by Zen |
