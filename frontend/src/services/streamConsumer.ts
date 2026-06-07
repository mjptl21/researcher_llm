import { decodeEvent } from './eventDecoder'
import type { TraceEvent } from '../types/events'

export interface StreamCallbacks {
  onEvent: (event: TraceEvent) => void
  onReconnect: () => void
  onError: (msg: string) => void
  onDone: () => void
}

export function startStream(sessionId: string, callbacks: StreamCallbacks): () => void {
  let stopped = false
  let retried = false
  let lastEventId: string | null = null
  let es: EventSource

  function connect() {
    // Pass lastEventId as query param so backend can replay missed events
    const url = lastEventId
      ? `/api/stream/${sessionId}?lastEventId=${encodeURIComponent(lastEventId)}`
      : `/api/stream/${sessionId}`

    es = new EventSource(url)

    es.onmessage = (e) => {
      if (stopped) return
      // Track last-event-id for reconnect
      if (e.lastEventId) lastEventId = e.lastEventId

      const event = decodeEvent(`data: ${e.data}`)
      if (!event) return

      callbacks.onEvent(event)

      if (event.type === 'done') {
        callbacks.onDone()
        es.close()
      }
    }

    es.onerror = () => {
      if (stopped) return
      es.close()
      if (!retried) {
        retried = true
        callbacks.onReconnect()
        // Reconnect after 2s — server will replay events since lastEventId
        setTimeout(connect, 2000)
      } else {
        callbacks.onError('Stream connection failed after reconnect attempt.')
      }
    }
  }

  connect()

  return () => {
    stopped = true
    es?.close()
  }
}
