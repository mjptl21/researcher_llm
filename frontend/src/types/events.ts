export type EventType =
  | 'session_start'
  | 'thinking'
  | 'tool_start'
  | 'tool_end'
  | 'agent_start'
  | 'agent_end'
  | 'ask_user'
  | 'ask_user_answered'
  | 'agent_response'
  | 'artifact'
  | 'error'
  | 'done'

export interface BaseEvent {
  type: EventType
  agentId: string
  agentName: string
  parentAgentId: string | null
  timestamp: number
  sessionId: string
}

export interface SessionStartEvent extends BaseEvent {
  type: 'session_start'
  payload: { query: string }
}

export interface ThinkingEvent extends BaseEvent {
  type: 'thinking'
  payload: { text: string; delta: boolean }
}

export interface ToolStartEvent extends BaseEvent {
  type: 'tool_start'
  payload: { toolName: string; input: unknown; toolUseId: string }
}

export interface ToolEndEvent extends BaseEvent {
  type: 'tool_end'
  payload: { toolName: string; output: unknown; toolUseId: string }
}

export interface AgentStartEvent extends BaseEvent {
  type: 'agent_start'
  payload: { role: 'orchestrator' | 'sub-agent'; subtopic?: string }
}

export interface AgentEndEvent extends BaseEvent {
  type: 'agent_end'
  payload: { status: 'completed' | 'failed'; message?: string }
}

export interface AskUserEvent extends BaseEvent {
  type: 'ask_user'
  payload: { question: string; questionId: string }
}

export interface AskUserAnsweredEvent extends BaseEvent {
  type: 'ask_user_answered'
  payload: { questionId: string; answer: string }
}

export interface AgentResponseEvent extends BaseEvent {
  type: 'agent_response'
  payload: { text: string }
}

export interface ArtifactEvent extends BaseEvent {
  type: 'artifact'
  payload: { filename: string; contentSnippet: string; fullPath: string; mimeType: string }
}

export interface ErrorEvent extends BaseEvent {
  type: 'error'
  payload: { message: string; recoverable: boolean }
}

export interface DoneEvent extends BaseEvent {
  type: 'done'
  payload: Record<string, never>
}

export type TraceEvent =
  | SessionStartEvent
  | ThinkingEvent
  | ToolStartEvent
  | ToolEndEvent
  | AgentStartEvent
  | AgentEndEvent
  | AskUserEvent
  | AskUserAnsweredEvent
  | AgentResponseEvent
  | ArtifactEvent
  | ErrorEvent
  | DoneEvent

export const KNOWN_EVENT_TYPES: Set<EventType> = new Set([
  'session_start', 'thinking', 'tool_start', 'tool_end',
  'agent_start', 'agent_end', 'ask_user', 'ask_user_answered',
  'agent_response', 'artifact', 'error', 'done',
])
