import type { ChatMessage as ChatMessageType } from '../../types/trace'
import { ArtifactList } from './ArtifactList'

interface Props {
  message: ChatMessageType
}

export function ChatMessage({ message }: Props) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-4 py-2.5 bg-blue-900 text-blue-50 rounded-2xl rounded-tr-sm text-sm">
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] px-4 py-3 bg-gray-800 border border-gray-700 text-gray-100 rounded-2xl rounded-tl-sm text-sm">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 shrink-0" />
          <span className="text-xs text-gray-400 font-medium">{message.agentName ?? 'assistant'}</span>
        </div>
        <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
        {message.artifacts.length > 0 && (
          <>
            <div className="my-3 border-t border-gray-700" />
            <p className="text-xs text-gray-500 mb-1">Artifacts ({message.artifacts.length})</p>
            <ArtifactList artifacts={message.artifacts} />
          </>
        )}
      </div>
    </div>
  )
}
