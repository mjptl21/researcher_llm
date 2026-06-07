import { ChatPanel } from '../chat/ChatPanel'
import { TracePanel } from '../trace/TracePanel'
import { ErrorBanner } from '../shared/ErrorBanner'

export function AppShell() {
  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-blue-500" />
        <span className="text-sm font-semibold text-gray-200">Deep Analyst</span>
        <span className="text-xs text-gray-600">Agent-transparent research platform</span>
      </header>

      {/* Error banner */}
      <ErrorBanner />

      {/* Main split */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat — fixed width */}
        <div className="w-[420px] min-w-[320px] shrink-0 border-r border-gray-800 overflow-hidden">
          <ChatPanel />
        </div>

        {/* Trace — fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <TracePanel />
        </div>
      </div>
    </div>
  )
}
