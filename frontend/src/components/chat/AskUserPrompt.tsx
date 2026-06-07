import { useRef, useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/index'
import { submitAnswer } from '../../store/sessionSlice'

export function AskUserPrompt() {
  const dispatch = useAppDispatch()
  const pending = useAppSelector(s => s.chat.pendingQuestion)
  const sessionId = useAppSelector(s => s.session.sessionId)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (pending) {
      setAnswer('')
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [pending])

  if (!pending || !sessionId) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!answer.trim() || submitting || !sessionId || !pending) return
    setSubmitting(true)
    await dispatch(submitAnswer({ sessionId, questionId: pending.questionId, answer: answer.trim() }))
    setSubmitting(false)
  }

  return (
    <div className="mx-3 mb-2 p-3 bg-gray-900 border border-amber-800 rounded-xl">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-full bg-amber-700 flex items-center justify-center shrink-0">
          <span className="text-xs text-amber-200">?</span>
        </div>
        <span className="text-xs text-amber-400 font-medium">{pending.agentName} asks</span>
      </div>
      <p className="text-sm text-gray-200 mb-3 whitespace-pre-wrap leading-relaxed">
        {pending.question}
      </p>
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          ref={textareaRef}
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSubmit(e)
            }
          }}
          placeholder="Type your answer… (Enter to send)"
          rows={2}
          className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-amber-700 transition-colors"
        />
        <button
          type="submit"
          disabled={!answer.trim() || submitting}
          className="px-4 py-1.5 text-sm bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer"
        >
          {submitting ? 'Sending…' : 'Send Answer'}
        </button>
      </form>
    </div>
  )
}
