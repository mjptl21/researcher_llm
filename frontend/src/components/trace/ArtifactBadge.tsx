import type { Artifact } from '../../types/trace'

interface Props {
  artifact: Artifact
  onClick: (a: Artifact) => void
}

export function ArtifactBadge({ artifact, onClick }: Props) {
  return (
    <button
      onClick={() => onClick(artifact)}
      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-purple-950 text-purple-300 border border-purple-800 rounded-md hover:bg-purple-900 transition-colors cursor-pointer"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {artifact.filename}
    </button>
  )
}
