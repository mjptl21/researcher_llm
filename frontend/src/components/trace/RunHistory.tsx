import { useState } from 'react'
import { useAppSelector } from '../../store/index'
import type { RunSummary } from '../../store/traceSlice'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function RunSummaryCard({ run }: { run: RunSummary }) {
  const [expanded, setExpanded] = useState(false)

  const agentNames = [...new Set(Object.values(run.nodes).map(n => n.name))]
  const statusColor =
    run.status === 'completed' ? 'text-green-400 border-green-800 bg-green-950/30' :
    run.status === 'failed'    ? 'text-red-400 border-red-800 bg-red-950/30' :
                                 'text-red-400 border-red-800 bg-red-950/30'

  return (
    <div className={`border rounded-lg overflow-hidden text-xs ${statusColor}`}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:brightness-110 transition-all cursor-pointer text-left"
      >
        <svg
          className={`w-3 h-3 shrink-0 transition-transform opacity-60 ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {/* Status dot */}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          run.status === 'completed' ? 'bg-green-400' : 'bg-red-400'
        }`} />

        <span className="flex-1 truncate font-medium opacity-80">{run.query}</span>

        <span className="opacity-50 shrink-0 tabular-nums">{formatDuration(run.durationMs)}</span>
        <span className="opacity-40 shrink-0">{formatTime(run.timestamp)}</span>
        {run.allArtifacts.length > 0 && (
          <span className="text-purple-400 shrink-0">📄 {run.allArtifacts.length}</span>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-current border-opacity-20">
          <div className="flex gap-1.5 flex-wrap pt-2">
            {agentNames.map(name => (
              <span
                key={name}
                className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded font-mono"
              >
                {name}
              </span>
            ))}
          </div>
          {run.allArtifacts.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {run.allArtifacts.map((a, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-purple-950 text-purple-400 border border-purple-800 rounded">
                  📄 {a.filename}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function RunHistory() {
  const pastRuns = useAppSelector(s => s.trace.pastRuns)
  if (pastRuns.length === 0) return null

  return (
    <div className="px-3 pt-3 pb-1 space-y-1.5 border-b border-gray-800">
      <p className="text-xs text-gray-600 uppercase tracking-wider px-1 mb-2">Past Runs</p>
      {pastRuns.map(run => (
        <RunSummaryCard key={run.id} run={run} />
      ))}
    </div>
  )
}
