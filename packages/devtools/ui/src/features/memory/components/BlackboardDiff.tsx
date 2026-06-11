interface BlackboardDiffProps {
  prev: Record<string, unknown>
  current: Record<string, unknown>
  fieldsChanged: string[]
}

export function BlackboardDiff({ prev, current, fieldsChanged }: BlackboardDiffProps) {
  if (fieldsChanged.length === 0) return null

  return (
    <div className="mt-1.5 space-y-1">
      {fieldsChanged.map((field) => {
        if (field === '*') {
          return (
            <div key={field} className="text-[10px] text-(--qw-danger) italic">
              Board cleared
            </div>
          )
        }

        const oldVal = prev[field]
        const newVal = current[field]
        const oldStr = formatValue(oldVal)
        const newStr = formatValue(newVal)

        if (oldStr === newStr) return null

        return (
          <div key={field} className="flex items-start gap-2 text-[10px]">
            <span className="text-(--qw-fg-muted) font-medium shrink-0">{field}:</span>
            <div className="min-w-0">
              {oldVal !== undefined && <div className="text-(--qw-danger) line-through truncate">{oldStr}</div>}
              <div className="text-(--qw-ok) truncate">{newStr}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '...' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const json = JSON.stringify(value)
  return json.length > 100 ? json.slice(0, 100) + '...' : json
}
