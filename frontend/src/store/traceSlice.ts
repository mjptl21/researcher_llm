import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { TraceNode, Artifact } from '../types/trace'
import type { TraceEvent } from '../types/events'

interface TraceState {
  nodes: Record<string, TraceNode>
  rootIds: string[]
  allArtifacts: Artifact[]
  expandedIds: string[]
}

const initialState: TraceState = {
  nodes: {},
  rootIds: [],
  allArtifacts: [],
  expandedIds: [],
}

const traceSlice = createSlice({
  name: 'trace',
  initialState,
  reducers: {
    applyTraceEvent(state, action: PayloadAction<TraceEvent>) {
      const event = action.payload

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
            if (!state.rootIds.includes(event.agentId)) {
              state.rootIds.push(event.agentId)
            }
          } else {
            const parent = state.nodes[event.parentAgentId]
            if (parent && !parent.children.includes(event.agentId)) {
              parent.children.push(event.agentId)
            }
          }
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
              // Concatenate onto last thinking block
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
            // Agent not yet started — create a queued placeholder
            state.nodes[event.agentId] = {
              id: event.agentId,
              name: event.agentName,
              role: 'sub-agent',
              status: 'queued',
              parentId: event.parentAgentId,
              children: [],
              events: [event],
              artifacts: [],
              startedAt: event.timestamp,
              completedAt: null,
            }
          } else {
            node.events.push(event)
          }
          break
        }

        case 'tool_end': {
          const node = state.nodes[event.agentId]
          if (!node) break
          // Find matching tool_start by toolUseId and attach output
          const toolStart = node.events.findLast(
            (e) => e.type === 'tool_start' && (e as typeof event).payload.toolUseId === event.payload.toolUseId,
          )
          if (toolStart) {
            ;(toolStart as { _output?: unknown })._output = event.payload.output
          }
          node.events.push(event)
          break
        }

        case 'artifact': {
          const node = state.nodes[event.agentId]
          const artifact: Artifact = {
            ...event.payload,
            agentId: event.agentId,
            agentName: event.agentName,
            timestamp: event.timestamp,
          }
          if (node) {
            node.artifacts.push(artifact)
            node.events.push(event)
          }
          state.allArtifacts.push(artifact)
          break
        }

        case 'ask_user':
        case 'ask_user_answered':
        case 'error': {
          const node = state.nodes[event.agentId]
          if (node) {
            node.events.push(event)
            if (event.type === 'error' && !(event as Extract<TraceEvent, { type: 'error' }>).payload.recoverable) {
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

    reset: () => initialState,
  },
})

export const { applyTraceEvent, toggleExpanded, reset: resetTrace } = traceSlice.actions
export const traceReducer = traceSlice.reducer
