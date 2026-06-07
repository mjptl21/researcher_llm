import { useAppSelector } from '../../store/index'
import { Spinner } from '../shared/Spinner'
import type { RootState } from '../../store/index'

function selectActiveAgents(state: RootState) {
  return Object.values(state.trace.nodes).filter(n => n.status === 'running')
}

export function LiveStatusBar() {
  const status = useAppSelector(s => s.session.status)
  const liveStatus = useAppSelector(s => s.chat.liveStatus)
  const activeAgents = useAppSelector(selectActiveAgents)
  const reconnectCount = useAppSelector(s => s.session.reconnectCount)

  if (status !== 'running' && status !== 'waiting_for_user') return null

  const isWaiting = status === 'waiting_for_user'

  return (
    <div className={`border-t text-xs transition-all ${
      isWaiting ? 'bg-amber-950/60 border-amber-900' : 'bg-blue-950/60 border-blue-900'
    }`}>
      {/* Reconnect notice */}
      {reconnectCount > 0 && (
        <div className="px-4 py-1 text-yellow-400 bg-yellow-950/40 border-b border-yellow-900">
          ↻ Reconnected ({reconnectCount}x) — resuming stream
        </div>
      )}

      {/* Main status line */}
      <div className="flex items-center gap-2.5 px-4 py-2">
        {isWaiting ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span className="text-amber-400">Waiting for your answer…</span>
          </>
        ) : (
          <>
            <Spinner color="bg-blue-400" />
            <span className="text-blue-400 truncate">{liveStatus || 'Working…'}</span>
          </>
        )}
      </div>

      {/* Activity ticker — shows all concurrently running agents */}
      {!isWaiting && activeAgents.length > 1 && (
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto">
          {activeAgents.map(agent => {
            const lastEvent = agent.events[agent.events.length - 1]
            const action =
              lastEvent?.type === 'thinking'   ? 'thinking…'  :
              lastEvent?.type === 'tool_start' ?
                `→ ${(lastEvent as Extract<typeof lastEvent, {type:'tool_start'}>).payload.toolName}` :
              'running…'
            return (
              <div
                key={agent.id}
                className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-900/50 border border-blue-800 rounded-full shrink-0"
              >
                <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-blue-300 font-mono">{agent.name}</span>
                <span className="text-blue-500">{action}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
