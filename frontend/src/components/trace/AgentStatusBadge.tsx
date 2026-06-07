import type { AgentStatus } from '../../types/trace'

interface Props {
  status: AgentStatus
}

const CONFIG: Record<AgentStatus, { label: string; classes: string; dot: string }> = {
  queued: {
    label: 'queued',
    classes: 'bg-gray-800 text-gray-400 border-gray-700',
    dot: 'bg-gray-500',
  },
  running: {
    label: 'running',
    classes: 'bg-blue-950 text-blue-300 border-blue-800',
    dot: 'bg-blue-400 animate-pulse',
  },
  completed: {
    label: 'done',
    classes: 'bg-green-950 text-green-300 border-green-800',
    dot: 'bg-green-400',
  },
  failed: {
    label: 'failed',
    classes: 'bg-red-950 text-red-300 border-red-800',
    dot: 'bg-red-400',
  },
}

export function AgentStatusBadge({ status }: Props) {
  const { label, classes, dot } = CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium border rounded-full ${classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
