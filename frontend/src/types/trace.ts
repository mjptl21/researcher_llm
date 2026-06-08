import type { TraceEvent } from './events'

export type AgentStatus = 'queued' | 'running' | 'completed' | 'failed'
export type AgentRole = 'orchestrator' | 'sub-agent'

export interface Artifact {
  filename: string
  contentSnippet: string
  fullPath: string
  mimeType: string
  agentId: string
  agentName: string
  timestamp: number
}

export interface TraceNode {
  id: string
  name: string
  role: AgentRole
  status: AgentStatus
  parentId: string | null
  children: string[]    // ordered list of child agentIds
  events: TraceEvent[]
  artifacts: Artifact[]
  startedAt: number
  completedAt: number | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  agentName?: string   // name of the root agent that produced this message
  text: string
  artifacts: Artifact[]
  timestamp: number
}

export interface AskUserPayload {
  question: string
  questionId: string
  agentName: string
}
