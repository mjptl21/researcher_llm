import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import { setPendingQuestion, setLiveStatus, addUserMessage } from './chatSlice'
import { resetChat } from './chatSlice'
import { archiveCurrentRun } from './traceSlice'
import { mockAnswerBus } from '../services/mockAnswerBus'

export type SessionStatus = 'idle' | 'running' | 'waiting_for_user' | 'done' | 'error'

interface SessionState {
  sessionId: string | null
  status: SessionStatus
  error: string | null
  lastQuery: string        // for retry
  reconnectCount: number   // for stream reconnect tracking
}

const initialState: SessionState = {
  sessionId: null,
  status: 'idle',
  error: null,
  lastQuery: '',
  reconnectCount: 0,
}

export const startSession = createAsyncThunk(
  'session/start',
  async (query: string, { dispatch, getState }) => {
    // Archive previous run before resetting
    const state = (getState() as { session: SessionState }).session
    dispatch(archiveCurrentRun({
      query: state.lastQuery || query,
      status: state.status === 'error' ? 'error' : 'completed',
    }))
    dispatch(resetChat())
    dispatch(addUserMessage(query))

    if (import.meta.env.VITE_USE_MOCK === 'true') {
      return `mock-${Date.now()}`
    }

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) throw new Error(`Server error: ${res.status}`)
    const data = (await res.json()) as { sessionId: string }
    return data.sessionId
  },
)

export const submitAnswer = createAsyncThunk(
  'session/submitAnswer',
  async (
    payload: { sessionId: string; questionId: string; answer: string },
    { dispatch },
  ) => {
    if (import.meta.env.VITE_USE_MOCK === 'true') {
      mockAnswerBus.provideAnswer(payload.answer)
    } else {
      await fetch(`/api/answer/${payload.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: payload.questionId, answer: payload.answer }),
      })
    }
    dispatch(setPendingQuestion(null))
    dispatch(setLiveStatus(''))
  },
)

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setSessionId(state, action: PayloadAction<string>) {
      state.sessionId = action.payload
    },
    setStatus(state, action: PayloadAction<SessionStatus>) {
      state.status = action.payload
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
    incrementReconnect(state) {
      state.reconnectCount += 1
    },
    hydrateSession(_state, _action: PayloadAction<Partial<SessionState>>) {
      // Don't restore active sessions — they're gone after refresh
      // Just restore lastQuery so retry works
      // (actual hydration handled in store/index.ts)
    },
    reset: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(startSession.pending, (state, action) => {
        state.status = 'running'
        state.error = null
        state.sessionId = null
        state.lastQuery = action.meta.arg  // save query for retry
        state.reconnectCount = 0
      })
      .addCase(startSession.fulfilled, (state, action) => {
        state.sessionId = action.payload
      })
      .addCase(startSession.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.error.message ?? 'Failed to start session'
      })
      .addCase(submitAnswer.fulfilled, (state) => {
        state.status = 'running'
      })
  },
})

export const {
  setSessionId,
  setStatus,
  setError,
  incrementReconnect,
  reset: resetSession,
} = sessionSlice.actions
export const sessionReducer = sessionSlice.reducer
