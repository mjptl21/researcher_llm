import type { TraceNode } from '../../types/trace'
import { AgentStatusBadge } from './AgentStatusBadge'

interface Props {
  node: TraceNode
  expanded: boolean
  onToggle: () => void
}

const STATUS_BORDER: Record<string, string> = {
  queued: 'border-l-gray-700',
  running: 'border-l-blue-500',
  completed: 'border-l-green-500',
  failed: 'border-l-red-500',
}

function elapsed(node: TraceNode): string {
  const end = node.completedAt ?? Date.now()
  const ms = end - node.startedAt
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function TraceNodeHeader({ node, expanded, onToggle }: Props) {
  const borderClass = STATUS_BORDER[node.status] ?? 'border-l-gray-700'
  const hasChildren = node.children.length > 0 || node.events.length > 0

  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-3 py-2 border-l-2 ${borderClass} bg-gray-900 hover:bg-gray-800 rounded-t-lg transition-colors cursor-pointer text-left`}
    >
      {hasChildren && (
        <svg
          className={`w-3 h-3 text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
      {!hasChildren && <span className="w-3 h-3 shrink-0" />}

      <span className="font-mono text-sm text-gray-100 font-medium truncate flex-1">
        {node.name}
      </span>

      {node.role === 'orchestrator' && (
        <span className="text-xs text-gray-600 shrink-0">orchestrator</span>
      )}

      <span className="text-xs text-gray-500 shrink-0 tabular-nums">{elapsed(node)}</span>

      <AgentStatusBadge status={node.status} />

      {node.artifacts.length > 0 && (
        <span className="text-xs text-purple-400 shrink-0" title={`${node.artifacts.length} artifact(s)`}>
          📄 {node.artifacts.length}
        </span>
      )}
    </button>
  )
}
