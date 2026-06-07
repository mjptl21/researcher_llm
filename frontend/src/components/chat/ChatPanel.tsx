import { useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/index'
import { startSession } from '../../store/sessionSlice'
import { ChatMessage } from './ChatMessage'
import { AskUserPrompt } from './AskUserPrompt'
import { LiveStatusBar } from './LiveStatusBar'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useStream } from '../../hooks/useStream'

export function ChatPanel() {
  const dispatch = useAppDispatch()
  const messages = useAppSelector(s => s.chat.messages)
  const status = useAppSelector(s => s.session.status)
  const hasPendingQ = useAppSelector(s => s.chat.pendingQuestion !== null)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useAutoScroll<HTMLDivElement>()

  // Activate the stream whenever sessionId changes
  useStream()

  const isRunning = status === 'running' || status === 'waiting_for_user'
  const canSubmit = input.trim().length > 0 && !isRunning

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const query = input.trim()
    setInput('')
    await dispatch(startSession(query))
  }

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-800 shrink-0">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Chat</h2>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-700">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-600">Deep Analyst</p>
              <p className="text-xs mt-1">Ask me to research any topic</p>
            </div>
          </div>
        )}
        {messages.map(m => <ChatMessage key={m.id} message={m} />)}
      </div>

      {/* Ask-user prompt (above input when agent is waiting) */}
      {hasPendingQ && <AskUserPrompt />}

      {/* Live status */}
      <LiveStatusBar />

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-gray-800 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isRunning}
            placeholder={isRunning ? 'Agent is running…' : 'Ask anything to research…'}
            className="flex-1 px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 disabled:opacity-50 transition-colors"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer shrink-0"
          >
            Run
          </button>
        </div>
      </form>
    </div>
  )
}
