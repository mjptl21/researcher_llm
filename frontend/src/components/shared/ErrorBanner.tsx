import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/index'
import { setError, resetSession, startSession } from '../../store/sessionSlice'
import { resetTrace } from '../../store/traceSlice'
import { resetChat } from '../../store/chatSlice'

export function ErrorBanner() {
  const dispatch = useAppDispatch()
  const error = useAppSelector(s => s.session.error)
  const status = useAppSelector(s => s.session.status)
  const lastQuery = useAppSelector(s => s.session.lastQuery)

  // Auto-dismiss recoverable errors after 6 s
  useEffect(() => {
    if (!error || status === 'error') return
    const id = setTimeout(() => dispatch(setError(null)), 6000)
    return () => clearTimeout(id)
  }, [error, status, dispatch])

  if (!error) return null

  function handleRetry() {
    dispatch(resetTrace())
    dispatch(resetChat())
    dispatch(resetSession())
    if (lastQuery) {
      // Re-run the same query
      void dispatch(startSession(lastQuery))
    }
  }

  function handleDismiss() {
    dispatch(setError(null))
    if (status === 'error') {
      dispatch(resetTrace())
      dispatch(resetChat())
      dispatch(resetSession())
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-red-950 border-b border-red-800 text-red-300 text-sm">
      <svg className="w-4 h-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <span className="flex-1 truncate">{error}</span>

      {status === 'error' && lastQuery && (
        <button
          onClick={handleRetry}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-900 hover:bg-blue-800 border border-blue-700 text-blue-300 rounded cursor-pointer transition-colors shrink-0"
        >
          ↻ Retry
        </button>
      )}

      <button
        onClick={handleDismiss}
        className="text-red-500 hover:text-red-300 cursor-pointer shrink-0"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
