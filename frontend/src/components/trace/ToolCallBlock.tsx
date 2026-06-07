import { useState } from 'react'
import type { ToolStartEvent } from '../../types/events'

type ToolStartWithOutput = ToolStartEvent & { _output?: unknown }

interface Props {
  event: ToolStartWithOutput
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="text-xs font-mono text-green-400 bg-gray-950 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function ToolCallBlock({ event }: Props) {
  const [open, setOpen] = useState(false)
  const hasOutput = event._output !== undefined

  return (
    <div className="border border-gray-800 rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-900 transition-colors cursor-pointer text-left"
      >
        <svg
          className={`w-3 h-3 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-yellow-400 font-mono">{event.payload.toolName}</span>
        {hasOutput ? (
          <span className="ml-auto text-green-600 text-xs">✓</span>
        ) : (
          <span className="ml-auto text-yellow-700 text-xs animate-pulse">…</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <p className="text-xs text-gray-500 mb-1">Input</p>
            <JsonBlock value={event.payload.input} />
          </div>
          {hasOutput && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Output</p>
              <JsonBlock value={event._output} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
