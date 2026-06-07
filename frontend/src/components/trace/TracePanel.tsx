import { useAppSelector } from '../../store/index'
import { TraceNode } from './TraceNode'
import { RunHistory } from './RunHistory'
import { useAutoScroll } from '../../hooks/useAutoScroll'

export function TracePanel() {
  const rootIds = useAppSelector(s => s.trace.rootIds)
  const scrollRef = useAutoScroll<HTMLDivElement>()

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="px-4 py-2.5 border-b border-gray-800 shrink-0">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Agent Trace</h2>
      </div>

      {/* Past runs — rendered outside the auto-scroll container so the
          ResizeObserver never scrolls them out of view on page load */}
      <RunHistory />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Current run */}
        {rootIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-700">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-sm">Trace will appear here during a run</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {rootIds.map(id => <TraceNode key={id} agentId={id} />)}
          </div>
        )}
      </div>
    </div>
  )
}
