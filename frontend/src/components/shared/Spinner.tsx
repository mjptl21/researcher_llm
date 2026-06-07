interface SpinnerProps {
  size?: 'sm' | 'md'
  color?: string
}

export function Spinner({ size = 'sm', color = 'bg-blue-400' }: SpinnerProps) {
  const dim = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={`${dim} ${color} rounded-full animate-bounce`}
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  )
}
