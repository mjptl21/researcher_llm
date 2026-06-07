import { describe, it, expect } from 'vitest'
import { decodeEvent } from '../services/eventDecoder'
import type { TraceEvent } from '../types/events'

// Helper: encode a TraceEvent as a raw SSE line
function sse(event: TraceEvent): string {
  return `data: ${JSON.stringify(event)}`
}

const BASE = {
  agentId: 'agent-1',
  agentName: 'lead-analyst',
  parentAgentId: null,
  timestamp: 1000,
  sessionId: 'sess-1',
}

describe('decodeEvent', () => {
  it('decodes session_start', () => {
    const event: TraceEvent = { ...BASE, type: 'session_start', payload: { query: 'test query' } }
    const result = decodeEvent(sse(event))
    expect(result).not.toBeNull()
    expect(result!.type).toBe('session_start')
    expect((result as typeof event).payload.query).toBe('test query')
  })

  it('decodes thinking', () => {
    const event: TraceEvent = { ...BASE, type: 'thinking', payload: { text: 'I am thinking...', delta: false } }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('thinking')
    expect((result as typeof event).payload.text).toBe('I am thinking...')
    expect((result as typeof event).payload.delta).toBe(false)
  })

  it('decodes thinking with delta=true', () => {
    const event: TraceEvent = { ...BASE, type: 'thinking', payload: { text: ' more text', delta: true } }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('thinking')
    expect((result as typeof event).payload.delta).toBe(true)
  })

  it('decodes tool_start', () => {
    const event: TraceEvent = {
      ...BASE, type: 'tool_start',
      payload: { toolName: 'WebSearch', input: { query: 'AI trends' }, toolUseId: 'tu-001' },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('tool_start')
    expect((result as typeof event).payload.toolName).toBe('WebSearch')
    expect((result as typeof event).payload.toolUseId).toBe('tu-001')
  })

  it('decodes tool_end', () => {
    const event: TraceEvent = {
      ...BASE, type: 'tool_end',
      payload: { toolName: 'WebSearch', output: { results: [] }, toolUseId: 'tu-001' },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('tool_end')
    expect((result as typeof event).payload.toolUseId).toBe('tu-001')
  })

  it('decodes agent_start as orchestrator', () => {
    const event: TraceEvent = { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('agent_start')
    expect((result as typeof event).payload.role).toBe('orchestrator')
  })

  it('decodes agent_start as sub-agent with parentAgentId', () => {
    const event: TraceEvent = {
      ...BASE, type: 'agent_start', agentId: 'wr-1', parentAgentId: 'lead-analyst-1',
      payload: { role: 'sub-agent', subtopic: 'AI frameworks' },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('agent_start')
    expect(result!.parentAgentId).toBe('lead-analyst-1')
    expect((result as typeof event).payload.role).toBe('sub-agent')
  })

  it('decodes agent_end with status completed', () => {
    const event: TraceEvent = { ...BASE, type: 'agent_end', payload: { status: 'completed' } }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('agent_end')
    expect((result as typeof event).payload.status).toBe('completed')
  })

  it('decodes agent_end with status failed', () => {
    const event: TraceEvent = {
      ...BASE, type: 'agent_end', payload: { status: 'failed', message: 'rate limit' },
    }
    const result = decodeEvent(sse(event))
    expect((result as typeof event).payload.status).toBe('failed')
  })

  it('decodes ask_user', () => {
    const event: TraceEvent = {
      ...BASE, type: 'ask_user',
      payload: { question: 'Which angle matters most?', questionId: 'q-001' },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('ask_user')
    expect((result as typeof event).payload.question).toBe('Which angle matters most?')
    expect((result as typeof event).payload.questionId).toBe('q-001')
  })

  it('decodes ask_user_answered', () => {
    const event: TraceEvent = {
      ...BASE, type: 'ask_user_answered',
      payload: { questionId: 'q-001', answer: 'developer adoption' },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('ask_user_answered')
    expect((result as typeof event).payload.answer).toBe('developer adoption')
  })

  it('decodes agent_response', () => {
    const event: TraceEvent = {
      ...BASE, type: 'agent_response', payload: { text: 'Here is the final report...' },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('agent_response')
    expect((result as typeof event).payload.text).toBe('Here is the final report...')
  })

  it('decodes artifact', () => {
    const event: TraceEvent = {
      ...BASE, type: 'artifact',
      payload: { filename: 'report.md', contentSnippet: '# Report', fullPath: '/tmp/report.md', mimeType: 'text/markdown' },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('artifact')
    expect((result as typeof event).payload.filename).toBe('report.md')
    expect((result as typeof event).payload.mimeType).toBe('text/markdown')
  })

  it('decodes error with recoverable flag', () => {
    const event: TraceEvent = {
      ...BASE, type: 'error', payload: { message: 'rate limit exceeded', recoverable: false },
    }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('error')
    expect((result as typeof event).payload.recoverable).toBe(false)
  })

  it('decodes done', () => {
    const event: TraceEvent = { ...BASE, type: 'done', payload: {} }
    const result = decodeEvent(sse(event))
    expect(result!.type).toBe('done')
  })

  // Edge cases
  it('returns null for malformed JSON', () => {
    expect(decodeEvent('data: {not valid json')).toBeNull()
    expect(decodeEvent('data: ')).toBeNull()
    expect(decodeEvent('{bad')).toBeNull()
  })

  it('returns null for unknown event type', () => {
    const raw = JSON.stringify({ ...BASE, type: 'unknown_future_type', payload: {} })
    expect(decodeEvent(`data: ${raw}`)).toBeNull()
  })

  it('works without the "data: " prefix', () => {
    const event: TraceEvent = { ...BASE, type: 'done', payload: {} }
    const result = decodeEvent(JSON.stringify(event))
    expect(result!.type).toBe('done')
  })
})
