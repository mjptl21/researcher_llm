import { configureStore, type Middleware } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import { traceReducer, hydrateTrace } from './traceSlice'
import { chatReducer } from './chatSlice'
import { sessionReducer } from './sessionSlice'

const STORAGE_KEY = 'deep-analyst-state-v1'

// -- persistence middleware -----------------------------------------------------
// Debounced save to localStorage after every state change
let saveTimer: ReturnType<typeof setTimeout> | null = null

const persistMiddleware: Middleware = store => next => action => {
  const result = next(action)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const { trace, chat, session } = store.getState() as RootState
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        trace:   { pastRuns: trace.pastRuns },
        chat:    { messages: chat.messages },
        session: { lastQuery: session.lastQuery },
      }))
    } catch {
      // localStorage quota exceeded or unavailable - ignore
    }
  }, 800)
  return result
}

export const store = configureStore({
  reducer: {
    trace:   traceReducer,
    chat:    chatReducer,
    session: sessionReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }).concat(persistMiddleware),
})

// -- hydrate from localStorage on startup -------------------------------------
try {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    const saved = JSON.parse(raw) as {
      trace?: { pastRuns?: unknown[] }
      chat?: { messages?: unknown[] }
      session?: { lastQuery?: string }
    }
    if (saved.trace?.pastRuns?.length) {
      store.dispatch(hydrateTrace({ pastRuns: saved.trace.pastRuns as never }))
    }
  }
} catch {
  // Corrupted storage - ignore and start fresh
}

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector = <T>(selector: (state: RootState) => T): T =>
  useSelector(selector)

// Expose store for dev/preview testing
;(window as unknown as Record<string, unknown>).__store__ = store
