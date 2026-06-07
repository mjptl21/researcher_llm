import type { TraceEvent, EventType } from '../types/events'
import { KNOWN_EVENT_TYPES } from '../types/events'

/**
 * Parses a raw SSE "data: {...}" line into a typed TraceEvent.
 * Returns null for malformed JSON or unknown event types — never throws.
 */
export function decodeEvent(rawLine: string): TraceEvent | null {
  const line = rawLine.startsWith('data: ') ? rawLine.slice(6) : rawLine

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (!isObject(parsed)) return null

  const type = (parsed as Record<string, unknown>).type
  if (typeof type !== 'string' || !KNOWN_EVENT_TYPES.has(type as EventType)) {
    return null
  }

  return parsed as unknown as TraceEvent
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
