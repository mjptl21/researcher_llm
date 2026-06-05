import type { TraceEvent, AskUserEvent } from '../types/events'

export interface MockStreamOptions {
  delayMs?: number
  onAskUser?: (event: AskUserEvent) => Promise<string>
}

export async function* createMockStream(
  fixture: TraceEvent[],
  options: MockStreamOptions = {},
): AsyncGenerator<TraceEvent> {
  const { delayMs = 120, onAskUser } = options

  for (const event of fixture) {
    await delay(delayMs)

    if (event.type === 'ask_user' && onAskUser) {
      yield event
      // Pause here — wait for the caller to provide the answer
      const answer = await onAskUser(event as AskUserEvent)
      // Emit the answered event with the provided answer
      yield {
        ...event,
        type: 'ask_user_answered',
        payload: { questionId: event.payload.questionId, answer },
      } as TraceEvent
      continue
    }

    yield event

    if (event.type === 'done') break
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
