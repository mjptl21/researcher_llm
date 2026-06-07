from pydantic import BaseModel


class RunRequest(BaseModel):
    query: str


class RunResponse(BaseModel):
    sessionId: str


class AnswerRequest(BaseModel):
    questionId: str
    answer: str
