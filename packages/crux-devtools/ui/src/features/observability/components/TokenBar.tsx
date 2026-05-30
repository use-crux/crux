import type { InspectPart, DroppedContext } from '@/types'

interface TokenBarProps {
  parts: InspectPart[]
  droppedContexts?: DroppedContext[]
  totalTokens: number
}

const COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
]

export function TokenBar({ parts, droppedContexts = [], totalTokens }: TokenBarProps) {
  if (totalTokens === 0) return null

  const activeParts = parts.filter((p) => !p.skipped && p.tokens > 0)

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div className="flex h-6 rounded overflow-hidden bg-zinc-800">
        {activeParts.map((part, i) => {
          const width = (part.tokens / totalTokens) * 100
          if (width < 0.5) return null
          return (
            <div
              key={part.source}
              className={`${COLORS[i % COLORS.length]} relative group`}
              style={{ width: `${width}%` }}
              title={`${part.source}: ${part.tokens} tokens`}
            >
              <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-medium overflow-hidden whitespace-nowrap px-1">
                {width > 8 ? part.source : ''}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {activeParts.map((part, i) => (
          <div key={part.source} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${COLORS[i % COLORS.length]}`} />
            <span className="text-zinc-300">{part.source}</span>
            <span className="text-zinc-500">{part.tokens}</span>
          </div>
        ))}
        {droppedContexts.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-zinc-600 opacity-50" />
            <span className="text-zinc-500">{droppedContexts.length} dropped</span>
          </div>
        )}
      </div>
    </div>
  )
}
