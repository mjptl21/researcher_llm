import { useState } from 'react'
import type { TraceEvent, ToolStartEvent } from '../../types/events'
import type { Artifact } from '../../types/trace'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ArtifactBadge } from './ArtifactBadge'
import { ArtifactModal } from '../chat/ArtifactList'

interface Props {
  events: TraceEvent[]
}

export function EventList({ events }: Props) {
  const [viewing, setViewing] = useState<Artifact | null>(null)

  if (events.length === 0) return null

  return (
    <div className="px-3 pb-3 space-y-1.5">
      {events.map((event, i) => {
        switch (event.type) {
          case 'thinking':
            return <ThinkingBlock key={i} event={event} />
          case 'tool_start':
            return (
              <ToolCallBlock
                key={event.payload.toolUseId}
                event={event as ToolStartEvent & { _output?: unknown }}
              />
            )
          case 'artifact':
            return (
              <ArtifactBadge
                key={i}
                artifact={{
                  ...event.payload,
                  agentId: event.agentId,
                  agentName: event.agentName,
                  timestamp: event.timestamp,
                }}
                onClick={setViewing}
              />
            )
          case 'error':
            return (
              <div key={i} className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1.5">
                ✗ {event.payload.message}
              </div>
            )
          case 'ask_user':
            return (
              <div key={i} className="text-xs text-amber-400 bg-amber-950/30 border border-amber-900 rounded px-2 py-1.5">
                ? {event.payload.question.split('\n')[0]}
              </div>
            )
          case 'ask_user_answered':
            return (
              <div key={i} className="text-xs text-amber-300 bg-amber-950/20 rounded px-2 py-1">
                ↩ {event.payload.answer}
              </div>
            )
          default:
            return null
        }
      })}
      {viewing && <ArtifactModal artifact={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
