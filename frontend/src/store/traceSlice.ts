import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { TraceNode, Artifact } from '../types/trace'
import type { TraceEvent } from '../types/events'

export interface RunSummary {
  id: string
  query: string
  rootIds: string[]
  nodes: Record<string, TraceNode>
  allArtifacts: Artifact[]
  status: 'completed' | 'failed' | 'error'
  timestamp: number
  durationMs: number
}

interface TraceState {
  nodes: Record<string, TraceNode>
  rootIds: string[]
  allArtifacts: Artifact[]
  expandedIds: string[]
  pastRuns: RunSummary[]
  runStartedAt: number | null
}

const initialState: TraceState = {
  nodes: {},
  rootIds: [],
  allArtifacts: [],
  expandedIds: [],
  pastRuns: [],
  runStartedAt: null,
}

const traceSlice = createSlice({
  name: 'trace',
  initialState,
  reducers: {
    applyTraceEvent(state, action: PayloadAction<TraceEvent>) {
      const event = action.payload

      if (state.runStartedAt === null) state.runStartedAt = event.timestamp

      switch (event.type) {
        case 'agent_start': {
          const { role } = event.payload
          state.nodes[event.agentId] = {
            id: event.agentId,
            name: event.agentName,
            role,
            status: 'running',
            parentId: event.parentAgentId,
            children: [],
            events: [event],
            artifacts: [],
            startedAt: event.timestamp,
            completedAt: null,
          }
          if (event.parentAgentId === null) {
            if (!state.rootIds.includes(event.agentId)) state.rootIds.push(event.agentId)
          } else {
            const parent = state.nodes[event.parentAgentId]
            if (parent && !parent.children.includes(event.agentId))
              parent.children.push(event.agentId)
          }
          // Auto-expand new nodes
          if (!state.expandedIds.includes(event.agentId))
            state.expandedIds.push(event.agentId)
          break
        }

        case 'agent_end': {
          const node = state.nodes[event.agentId]
          if (node) {
            node.status = event.payload.status
            node.completedAt = event.timestamp
            node.events.push(event)
          }
          break
        }

        case 'thinking': {
          const node = state.nodes[event.agentId]
          if (!node) break
          if (event.payload.delta) {
            const last = node.events[node.events.length - 1]
            if (last?.type === 'thinking') {
              ;(last as typeof event).payload.text += event.payload.text
              break
            }
          }
          node.events.push(event)
          break
        }

        case 'tool_start': {
          const node = state.nodes[event.agentId]
          if (!node) {
            state.nodes[event.agentId] = {
              id: event.agentId, name: event.agentName, role: 'sub-agent',
              status: 'queued', parentId: event.parentAgentId,
              children: [], events: [event], artifacts: [],
              startedAt: event.timestamp, completedAt: null,
            }
          } else {
            node.events.push(event)
          }
          break
        }

        case 'tool_end': {
          const node = state.nodes[event.agentId]
          if (!node) break
          const toolStart = node.events.findLast(
            (e) => e.type === 'tool_start' &&
              (e as unknown as { payload: { toolUseId: string } }).payload.toolUseId === event.payload.toolUseId,
          )
          if (toolStart) {
            ;(toolStart as unknown as { _output?: unknown })._output = event.payload.output
          }
          node.events.push(event)
          break
        }

        case 'artifact': {
          const node = state.nodes[event.agentId]
          const artifact: Artifact = {
            ...event.payload, agentId: event.agentId,
            agentName: event.agentName, timestamp: event.timestamp,
          }
          if (node) { node.artifacts.push(artifact); node.events.push(event) }
          state.allArtifacts.push(artifact)
          break
        }

        case 'ask_user':
        case 'ask_user_answered':
        case 'error': {
          const node = state.nodes[event.agentId]
          if (node) {
            node.events.push(event)
            if (event.type === 'error' &&
                !(event as Extract<TraceEvent, { type: 'error' }>).payload.recoverable) {
              node.status = 'failed'
              node.completedAt = event.timestamp
            }
          }
          break
        }

        default:
          break
      }
    },

    toggleExpanded(state, action: PayloadAction<string>) {
      const id = action.payload
      const idx = state.expandedIds.indexOf(id)
      if (idx === -1) state.expandedIds.push(id)
      else state.expandedIds.splice(idx, 1)
    },

    // Collapse a completed node (called after a delay from useStream)
    autoCollapse(state, action: PayloadAction<string>) {
      const id = action.payload
      const node = state.nodes[id]
      if (!node || node.status === 'running') return
      // Don't collapse if any child is still running
      const hasRunningChild = node.children.some(
        cid => state.nodes[cid]?.status === 'running'
      )
      if (hasRunningChild) return
      state.expandedIds = state.expandedIds.filter(eid => eid !== id)
    },

    // Snapshot the current run into pastRuns WITHOUT clearing it.
    // Call this when `done` fires so the data is persisted immediately
    // (before the user might refresh). The trace panel stays visible.
    snapshotCurrentRun(state, action: PayloadAction<{ query: string; status: RunSummary['status'] }>) {
      if (state.rootIds.length === 0) return
      const now = Date.now()
      const id = `run-${state.runStartedAt ?? now}`
      // Avoid duplicates if called more than once
      if (state.pastRuns.some(r => r.id === id)) return
      state.pastRuns.unshift({
        id,
        query: action.payload.query,
        rootIds: [...state.rootIds],
        nodes: { ...state.nodes },
        allArtifacts: [...state.allArtifacts],
        status: action.payload.status,
        timestamp: state.runStartedAt ?? now,
        durationMs: state.runStartedAt ? now - state.runStartedAt : 0,
      })
      state.pastRuns = state.pastRuns.slice(0, 5)
      // Intentionally does NOT clear nodes/rootIds — trace panel stays visible
    },

    // Archive current run into pastRuns, then reset for next run.
    // If snapshotCurrentRun already ran, skips the pastRuns push to avoid duplicates.
    archiveCurrentRun(state, action: PayloadAction<{ query: string; status: RunSummary['status'] }>) {
      if (state.rootIds.length > 0) {
        const now = Date.now()
        const id = `run-${state.runStartedAt ?? now}`
        // Only push if not already snapshotted by snapshotCurrentRun
        if (!state.pastRuns.some(r => r.id === id)) {
          state.pastRuns.unshift({
            id,
            query: action.payload.query,
            rootIds: [...state.rootIds],
            nodes: { ...state.nodes },
            allArtifacts: [...state.allArtifacts],
            status: action.payload.status,
            timestamp: state.runStartedAt ?? now,
            durationMs: state.runStartedAt ? now - state.runStartedAt : 0,
          })
          state.pastRuns = state.pastRuns.slice(0, 5)
        }
      }
      // Always clear current run state for the new session
      state.nodes = {}
      state.rootIds = []
      state.allArtifacts = []
      state.expandedIds = []
      state.runStartedAt = null
    },

    hydrateTrace(state, action: PayloadAction<Partial<TraceState>>) {
      const saved = action.payload
      // Only restore pastRuns and completed/done state — never restore an active run
      if (saved.pastRuns) state.pastRuns = saved.pastRuns
    },

    reset() {
      return { ...initialState }
    },
  },
})

export const {
  applyTraceEvent,
  toggleExpanded,
  autoCollapse,
  snapshotCurrentRun,
  archiveCurrentRun,
  hydrateTrace,
  reset: resetTrace,
} = traceSlice.actions
export const traceReducer = traceSlice.reducer
