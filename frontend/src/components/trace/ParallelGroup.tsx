import { TraceNode } from './TraceNode'

interface Props {
  agentIds: string[]
}

export function ParallelGroup({ agentIds }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-1">
        <div className="h-px flex-1 bg-blue-900" />
        <span className="text-xs text-blue-500 font-mono shrink-0">‖ parallel ({agentIds.length})</span>
        <div className="h-px flex-1 bg-blue-900" />
      </div>
      <div className="flex flex-row gap-2 pl-3 border-l-2 border-blue-800">
        {agentIds.map(id => (
          <div key={id} className="flex-1 min-w-0">
            <TraceNode agentId={id} />
          </div>
        ))}
      </div>
    </div>
  )
}
