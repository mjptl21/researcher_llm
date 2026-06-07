import { useState } from 'react'
import type { ThinkingEvent } from '../../types/events'

interface Props {
  event: ThinkingEvent
}

export function ThinkingBlock({ event }: Props) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-gray-800 rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-400 hover:bg-gray-900 transition-colors cursor-pointer text-left"
      >
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="italic">Thinking</span>
      </button>
      {open && (
        <p className="px-3 py-2 text-xs text-gray-500 italic leading-relaxed whitespace-pre-wrap">
          {event.payload.text}
        </p>
      )}
    </div>
  )
}
