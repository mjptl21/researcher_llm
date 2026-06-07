import type { Draft } from '@reduxjs/toolkit'
import type { TraceNode, Artifact } from '../types/trace'
import type {
  AgentStartEvent,
  AgentEndEvent,
  ThinkingEvent,
  ToolStartEvent,
  ToolEndEvent,
  ArtifactEvent,
  ErrorEvent,
  AskUserEvent,
  AskUserAnsweredEvent,
} from '../types/events'

type NodeMap = Draft<Record<string, TraceNode>> | Record<string, TraceNode>

function getOrCreate(nodes: NodeMap, agentId: string, agentName: string, parentId: string | null): TraceNode {
  if (!nodes[agentId]) {
    nodes[agentId] = {
      id: agentId,
      name: agentName,
      role: 'sub-agent',
      status: 'queued',
      parentId,
      children: [],
      events: [],
      artifacts: [],
      startedAt: Date.now(),
      completedAt: null,
    }
  }
  return nodes[agentId] as TraceNode
}

export function handleAgentStart(nodes: NodeMap, event: AgentStartEvent): void {
  const node = getOrCreate(nodes, event.agentId, event.agentName, event.parentAgentId)
  node.name = event.agentName
  node.role = event.payload.role
  node.status = 'running'
  node.parentId = event.parentAgentId
  node.startedAt = event.timestamp
  node.events.push(event)

  if (event.parentAgentId !== null) {
    const parent = nodes[event.parentAgentId]
    if (parent && !parent.children.includes(event.agentId)) {
      parent.children.push(event.agentId)
    }
  }
}

export function handleAgentEnd(nodes: NodeMap, event: AgentEndEvent): void {
  const node = nodes[event.agentId]
  if (!node) return
  node.status = event.payload.status
  node.completedAt = event.timestamp
  node.events.push(event)
}

export function handleThinking(nodes: NodeMap, event: ThinkingEvent): void {
  const node = getOrCreate(nodes, event.agentId, event.agentName, event.parentAgentId)
  if (event.payload.delta) {
    const last = node.events[node.events.length - 1]
    if (last?.type === 'thinking') {
      ;(last as ThinkingEvent).payload.text += event.payload.text
      return
    }
  }
  node.events.push(event)
}

export function handleToolStart(nodes: NodeMap, event: ToolStartEvent): void {
  const node = getOrCreate(nodes, event.agentId, event.agentName, event.parentAgentId)
  node.events.push(event)
}

export function handleToolEnd(nodes: NodeMap, event: ToolEndEvent): void {
  const node = nodes[event.agentId]
  if (!node) return
  // Find matching tool_start by toolUseId and attach output
  const toolStart = [...node.events].reverse().find(
    (e) => e.type === 'tool_start' && (e as ToolStartEvent).payload.toolUseId === event.payload.toolUseId,
  )
  if (toolStart) {
    ;(toolStart as ToolStartEvent & { _output?: unknown })._output = event.payload.output
  }
  node.events.push(event)
}

export function handleArtifact(nodes: NodeMap, event: ArtifactEvent): void {
  const node = getOrCreate(nodes, event.agentId, event.agentName, event.parentAgentId)
  const artifact: Artifact = {
    ...event.payload,
    agentId: event.agentId,
    agentName: event.agentName,
    timestamp: event.timestamp,
  }
  node.artifacts.push(artifact)
  node.events.push(event)
}

export function handleError(nodes: NodeMap, event: ErrorEvent): void {
  const node = getOrCreate(nodes, event.agentId, event.agentName, event.parentAgentId)
  node.events.push(event)
  if (!event.payload.recoverable) {
    node.status = 'failed'
    node.completedAt = event.timestamp
  }
}

export function handleAskUser(nodes: NodeMap, event: AskUserEvent | AskUserAnsweredEvent): void {
  const node = nodes[event.agentId]
  if (node) node.events.push(event)
}

/**
 * Given a list of sibling TraceNodes (same parentId), groups them into
 * sequential entries or parallel groups based on time-range overlap.
 * Returns an array where each entry is either a single node (sequential)
 * or an array of nodes (parallel group).
 */
export function groupSiblings(siblings: TraceNode[]): Array<TraceNode | TraceNode[]> {
  if (siblings.length === 0) return []
  const sorted = [...siblings].sort((a, b) => a.startedAt - b.startedAt)
  const groups: Array<TraceNode | TraceNode[]> = []
  let currentGroup: TraceNode[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentGroup[currentGroup.length - 1]
    const prevEnd = prev.completedAt ?? Infinity
    if (sorted[i].startedAt < prevEnd) {
      // Overlapping — parallel
      currentGroup.push(sorted[i])
    } else {
      groups.push(currentGroup.length === 1 ? currentGroup[0] : currentGroup)
      currentGroup = [sorted[i]]
    }
  }
  groups.push(currentGroup.length === 1 ? currentGroup[0] : currentGroup)
  return groups
}
