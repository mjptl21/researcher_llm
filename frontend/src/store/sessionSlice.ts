import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'
import { setPendingQuestion, setLiveStatus } from './chatSlice'

export type SessionStatus = 'idle' | 'running' | 'waiting_for_user' | 'done' | 'error'

interface SessionState {
  sessionId: string | null
  status: SessionStatus
  error: string | null
}

const initialState: SessionState = {
  sessionId: null,
  status: 'idle',
  error: null,
}

export const submitAnswer = createAsyncThunk(
  'session/submitAnswer',
  async (
    payload: { questionId: string; answer: string },
    { getState, dispatch },
  ) => {
    const state = getState() as RootState
    const sessionId = state.session.sessionId
    await fetch(`/api/answer/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
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

    reset: () => initialState,
  },
  extraReducers: (builder) => {
    builder.addCase(submitAnswer.fulfilled, (state) => {
      state.status = 'running'
    })
  },
})

export const {
  setSessionId,
  setStatus,
  setError,
  reset: resetSession,
} = sessionSlice.actions
export const sessionReducer = sessionSlice.reducer
