import { useAppDispatch, useAppSelector } from '../../store/index'
import { toggleExpanded } from '../../store/traceSlice'
import { groupSiblings } from '../../services/treeBuilder'
import { TraceNodeHeader } from './TraceNodeHeader'
import { EventList } from './EventList'
import { ParallelGroup } from './ParallelGroup'
import type { TraceNode as TraceNodeType } from '../../types/trace'

interface Props {
  agentId: string
}

export function TraceNode({ agentId }: Props) {
  const dispatch = useAppDispatch()
  const node = useAppSelector(s => s.trace.nodes[agentId])
  const expanded = useAppSelector(s => s.trace.expandedIds.includes(agentId))
  const allNodes = useAppSelector(s => s.trace.nodes)

  if (!node) return null

  const childNodes = node.children
    .map(id => allNodes[id])
    .filter((n): n is TraceNodeType => Boolean(n))

  const groups = groupSiblings(childNodes)

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <TraceNodeHeader
        node={node}
        expanded={expanded}
        onToggle={() => dispatch(toggleExpanded(agentId))}
      />

      {expanded && (
        <div className="bg-gray-950">
          {node.events.length > 0 && <EventList events={node.events} />}

          {groups.length > 0 && (
            <div className="px-2 pb-2 space-y-2">
              {groups.map((group, i) =>
                Array.isArray(group) ? (
                  <ParallelGroup key={i} agentIds={group.map(n => n.id)} />
                ) : (
                  <TraceNode key={group.id} agentId={group.id} />
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
