// Coordinates the ask_user pause/resume loop in mock mode.
// useStream registers a waiter; AskUserPrompt calls provide() when the user submits.
let resolver: ((answer: string) => void) | null = null

export const mockAnswerBus = {
  waitForAnswer(): Promise<string> {
    return new Promise(resolve => {
      resolver = resolve
    })
  },
  provideAnswer(answer: string): void {
    resolver?.(answer)
    resolver = null
  },
}
