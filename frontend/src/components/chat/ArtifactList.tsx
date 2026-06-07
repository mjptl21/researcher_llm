import { useState } from 'react'
import type { Artifact } from '../../types/trace'

interface ArtifactListProps {
  artifacts: Artifact[]
}

export function ArtifactList({ artifacts }: ArtifactListProps) {
  const [viewing, setViewing] = useState<Artifact | null>(null)

  if (artifacts.length === 0) return null

  // Group by agent name
  const byAgent = artifacts.reduce<Record<string, Artifact[]>>((acc, a) => {
    ;(acc[a.agentName] ??= []).push(a)
    return acc
  }, {})

  return (
    <div className="mt-3 space-y-3">
      {Object.entries(byAgent).map(([agentName, agentArtifacts]) => (
        <div key={agentName}>
          <p className="text-xs text-gray-600 mb-1.5">{agentName}</p>
          <div className="flex flex-wrap gap-1.5">
            {agentArtifacts.map((a, i) => (
              <button
                key={i}
                onClick={() => setViewing(a)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-purple-950 text-purple-300 border border-purple-800 rounded-md hover:bg-purple-900 transition-colors cursor-pointer"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {a.filename}
              </button>
            ))}
          </div>
        </div>
      ))}

      {viewing && <ArtifactModal artifact={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

interface ArtifactModalProps {
  artifact: Artifact
  onClose: () => void
}

export function ArtifactModal({ artifact, onClose }: ArtifactModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div>
            <p className="text-sm font-medium text-gray-100">{artifact.filename}</p>
            <p className="text-xs text-gray-500">{artifact.agentName} · {artifact.fullPath}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors cursor-pointer text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <pre className="p-4 text-xs font-mono text-green-400 bg-gray-950 overflow-auto max-h-96 whitespace-pre-wrap">
          {artifact.contentSnippet}
        </pre>
      </div>
    </div>
  )
}
