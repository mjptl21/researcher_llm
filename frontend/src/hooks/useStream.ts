import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector, store } from '../store/index'
import { applyTraceEvent, autoCollapse, snapshotCurrentRun } from '../store/traceSlice'
import { addAssistantMessage, setPendingQuestion, setLiveStatus } from '../store/chatSlice'
import { setStatus, setError, incrementReconnect } from '../store/sessionSlice'
import { createMockStream } from '../services/mockStream'
import { mockAnswerBus } from '../services/mockAnswerBus'
import { startStream } from '../services/streamConsumer'
import { fullRunFixture } from '../mocks/fullRun'
import { askUserRunFixture } from '../mocks/askUserRun'
import { errorRunFixture } from '../mocks/errorRun'
import type { TraceEvent } from '../types/events'

const AUTO_COLLAPSE_DELAY_MS = 2500

function getFixture() {
  const f = import.meta.env.VITE_FIXTURE
  if (f === 'askUser') return askUserRunFixture
  if (f === 'error') return errorRunFixture
  return fullRunFixture
}

function routeEvent(event: TraceEvent, dispatch: ReturnType<typeof useAppDispatch>) {
  dispatch(applyTraceEvent(event))

  switch (event.type) {
    case 'agent_start':
      dispatch(setLiveStatus(`Spawning ${event.agentName}…`))
      break
    case 'thinking':
      dispatch(setLiveStatus(`${event.agentName} is thinking…`))
      break
    case 'tool_start':
      dispatch(setLiveStatus(`${event.agentName} → ${event.payload.toolName}`))
      break
    case 'agent_end': {
      // Auto-collapse completed nodes after a short delay
      if (event.payload.status === 'completed') {
        setTimeout(() => dispatch(autoCollapse(event.agentId)), AUTO_COLLAPSE_DELAY_MS)
      }
      break
    }
    case 'ask_user':
      dispatch(setPendingQuestion({
        question: event.payload.question,
        questionId: event.payload.questionId,
        agentName: event.agentName,
      }))
      dispatch(setStatus('waiting_for_user'))
      break
    case 'done': {
      const state = store.getState()
      const allArtifacts = state.trace.allArtifacts
      let responseText = 'Research complete.'
      let respAgentName: string | undefined
      for (const node of Object.values(state.trace.nodes)) {
        const resp = [...node.events].reverse().find(e => e.type === 'agent_response')
        if (resp) {
          responseText = (resp as Extract<TraceEvent, { type: 'agent_response' }>).payload.text
          respAgentName = node.name
          break
        }
      }
      dispatch(addAssistantMessage({ text: responseText, artifacts: allArtifacts, agentName: respAgentName }))
      dispatch(setStatus('done'))
      dispatch(setLiveStatus(''))
      // Snapshot immediately so localStorage captures pastRuns before a page refresh.
      // (archiveCurrentRun in startSession will clear the current run; it skips
      // re-adding to pastRuns since snapshotCurrentRun already did so.)
      dispatch(snapshotCurrentRun({
        query: state.session.lastQuery,
        status: 'completed',
      }))
      break
    }
    case 'error':
      dispatch(setError(event.payload.message))
      if (!event.payload.recoverable) dispatch(setStatus('error'))
      break
  }
}

export function useStream() {
  const dispatch = useAppDispatch()
  const sessionId = useAppSelector(s => s.session.sessionId)
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    stoppedRef.current = false

    if (import.meta.env.VITE_USE_MOCK === 'true') {
      const fixture = getFixture()
      const gen = createMockStream(fixture, {
        delayMs: 120,
        onAskUser: () => mockAnswerBus.waitForAnswer(),
      })

      void (async () => {
        for await (const event of gen) {
          if (stoppedRef.current) break
          routeEvent(event, dispatch)
        }
      })()

      return () => { stoppedRef.current = true }
    }

    // Real SSE mode
    const stop = startStream(sessionId, {
      onEvent: (event) => routeEvent(event, dispatch),
      onReconnect: () => {
        dispatch(incrementReconnect())
        dispatch(setError('Connection lost — reconnecting…'))
      },
      onError: (msg) => {
        dispatch(setError(msg))
        dispatch(setStatus('error'))
      },
      onDone: () => {},
    })

    return stop
  }, [sessionId, dispatch])
}
