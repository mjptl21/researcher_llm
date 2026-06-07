import { describe, it, expect } from 'vitest'
import {
  handleAgentStart,
  handleAgentEnd,
  handleThinking,
  handleToolStart,
  handleToolEnd,
  handleArtifact,
  handleError,
  groupSiblings,
} from '../services/treeBuilder'
import type { TraceNode } from '../types/trace'
import type { TraceEvent } from '../types/events'
import { fullRunFixture } from '../mocks/fullRun'
import { applyTraceEvent } from '../store/traceSlice'
import { configureStore } from '@reduxjs/toolkit'
import { traceReducer } from '../store/traceSlice'

const BASE = {
  agentId: 'lead-1',
  agentName: 'lead-analyst',
  parentAgentId: null as string | null,
  timestamp: 1000,
  sessionId: 'sess-1',
}

function makeNodes(): Record<string, TraceNode> {
  return {}
}

describe('treeBuilder', () => {
  it('agent_start with null parentId creates root node', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    expect(nodes['lead-1']).toBeDefined()
    expect(nodes['lead-1'].role).toBe('orchestrator')
    expect(nodes['lead-1'].status).toBe('running')
    expect(nodes['lead-1'].parentId).toBeNull()
  })

  it('agent_start with parentId links child to parent', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    handleAgentStart(nodes, {
      ...BASE,
      agentId: 'wr-1', agentName: 'web-researcher', parentAgentId: 'lead-1',
      type: 'agent_start', payload: { role: 'sub-agent' },
    })
    expect(nodes['wr-1'].parentId).toBe('lead-1')
    expect(nodes['lead-1'].children).toContain('wr-1')
  })

  it('three agent_starts with same parentId creates three siblings', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    for (const id of ['wr-1', 'wr-2', 'wr-3']) {
      handleAgentStart(nodes, {
        ...BASE, agentId: id, agentName: 'web-researcher', parentAgentId: 'lead-1',
        type: 'agent_start', payload: { role: 'sub-agent' },
      })
    }
    expect(nodes['lead-1'].children).toHaveLength(3)
    expect(nodes['lead-1'].children).toEqual(['wr-1', 'wr-2', 'wr-3'])
  })

  it('thinking delta=true accumulates on the same block', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    handleThinking(nodes, { ...BASE, type: 'thinking', payload: { text: 'Hello', delta: false } })
    handleThinking(nodes, { ...BASE, type: 'thinking', payload: { text: ' world', delta: true } })
    const thinkEvents = nodes['lead-1'].events.filter(e => e.type === 'thinking')
    expect(thinkEvents).toHaveLength(1)
    expect((thinkEvents[0] as Extract<TraceEvent, { type: 'thinking' }>).payload.text).toBe('Hello world')
  })

  it('thinking delta=false creates a new block', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    handleThinking(nodes, { ...BASE, type: 'thinking', payload: { text: 'First thought', delta: false } })
    handleThinking(nodes, { ...BASE, type: 'thinking', payload: { text: 'Second thought', delta: false } })
    const thinkEvents = nodes['lead-1'].events.filter(e => e.type === 'thinking')
    expect(thinkEvents).toHaveLength(2)
  })

  it('tool_end finds its tool_start by toolUseId and attaches output', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    handleToolStart(nodes, {
      ...BASE, type: 'tool_start',
      payload: { toolName: 'WebSearch', input: { query: 'test' }, toolUseId: 'tu-42' },
    })
    handleToolEnd(nodes, {
      ...BASE, type: 'tool_end',
      payload: { toolName: 'WebSearch', output: { results: ['result1'] }, toolUseId: 'tu-42' },
    })
    const toolStart = nodes['lead-1'].events.find(
      e => e.type === 'tool_start' &&
        (e as Extract<TraceEvent, { type: 'tool_start' }>).payload.toolUseId === 'tu-42'
    ) as Extract<TraceEvent, { type: 'tool_start' }> & { _output?: unknown }
    expect(toolStart?._output).toEqual({ results: ['result1'] })
  })

  it('agent_end with status failed marks node as failed', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    handleAgentEnd(nodes, {
      ...BASE, type: 'agent_end', payload: { status: 'failed', message: 'timeout' },
    })
    expect(nodes['lead-1'].status).toBe('failed')
    expect(nodes['lead-1'].completedAt).toBe(1000)
  })

  it('artifact appears in both node.artifacts and node.events', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    handleArtifact(nodes, {
      ...BASE, type: 'artifact',
      payload: { filename: 'report.md', contentSnippet: '# Report', fullPath: '/tmp/report.md', mimeType: 'text/markdown' },
    })
    expect(nodes['lead-1'].artifacts).toHaveLength(1)
    expect(nodes['lead-1'].artifacts[0].filename).toBe('report.md')
    expect(nodes['lead-1'].events.some(e => e.type === 'artifact')).toBe(true)
  })

  it('error with recoverable=false marks node as failed', () => {
    const nodes = makeNodes()
    handleAgentStart(nodes, { ...BASE, type: 'agent_start', payload: { role: 'orchestrator' } })
    handleError(nodes, {
      ...BASE, type: 'error', payload: { message: 'rate limit', recoverable: false },
    })
    expect(nodes['lead-1'].status).toBe('failed')
  })

  it('tool_start before agent_start creates a queued placeholder node', () => {
    const nodes = makeNodes()
    handleToolStart(nodes, {
      ...BASE, type: 'tool_start',
      payload: { toolName: 'WebSearch', input: {}, toolUseId: 'tu-99' },
    })
    expect(nodes['lead-1']).toBeDefined()
    expect(nodes['lead-1'].status).toBe('queued')
  })

  it('full fullRun fixture produces correct tree shape via Redux store', () => {
    const store = configureStore({ reducer: { trace: traceReducer } })
    for (const event of fullRunFixture) {
      store.dispatch(applyTraceEvent(event))
    }
    const { nodes, rootIds } = store.getState().trace

    // One root
    expect(rootIds).toHaveLength(1)
    expect(rootIds[0]).toBe('lead-analyst-1')

    // lead-analyst has 5 children: 3 web-researchers + data-analyst + report-writer
    const root = nodes['lead-analyst-1']
    expect(root.children).toHaveLength(5)

    // All three web-researchers are children
    expect(root.children).toContain('web-researcher-1')
    expect(root.children).toContain('web-researcher-2')
    expect(root.children).toContain('web-researcher-3')

    // data-analyst and report-writer are children
    expect(root.children).toContain('data-analyst-1')
    expect(root.children).toContain('report-writer-1')

    // Root is completed
    expect(root.status).toBe('completed')
  })
})

describe('groupSiblings', () => {
  function node(id: string, startedAt: number, completedAt: number | null): TraceNode {
    return {
      id, name: id, role: 'sub-agent', status: completedAt ? 'completed' : 'running',
      parentId: 'parent', children: [], events: [], artifacts: [],
      startedAt, completedAt,
    }
  }

  it('sequential nodes returned as individual entries', () => {
    const siblings = [
      node('a', 100, 200),
      node('b', 300, 400),
    ]
    const groups = groupSiblings(siblings)
    expect(groups).toHaveLength(2)
    expect(Array.isArray(groups[0])).toBe(false)
    expect(Array.isArray(groups[1])).toBe(false)
  })

  it('overlapping nodes grouped as parallel', () => {
    const siblings = [
      node('a', 100, 500),
      node('b', 150, 500),
      node('c', 200, 500),
    ]
    const groups = groupSiblings(siblings)
    expect(groups).toHaveLength(1)
    expect(Array.isArray(groups[0])).toBe(true)
    expect((groups[0] as TraceNode[]).map(n => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('still-running node (completedAt=null) treated as parallel with subsequent', () => {
    const siblings = [
      node('a', 100, null),  // still running
      node('b', 200, 400),
    ]
    const groups = groupSiblings(siblings)
    expect(groups).toHaveLength(1)
    expect(Array.isArray(groups[0])).toBe(true)
  })
})
