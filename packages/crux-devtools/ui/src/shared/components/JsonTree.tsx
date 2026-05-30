import { useState } from 'react'

interface JsonTreeProps {
  data: unknown
  depth?: number
  label?: string
}

export function JsonTree({ data, depth = 0, label }: JsonTreeProps) {
  const [collapsed, setCollapsed] = useState(depth > 2)

  if (data === null || data === undefined) {
    return (
      <span className="text-(--qw-fg-faint)">
        {label && <span className="text-(--qw-fg-muted)">{label}: </span>}
        <span className="italic">{String(data)}</span>
      </span>
    )
  }

  if (typeof data === 'string') {
    const truncated = data.length > 200 ? data.slice(0, 200) + '...' : data
    return (
      <span>
        {label && <span className="text-(--qw-fg-muted)">{label}: </span>}
        <span className="text-emerald-400">"{truncated}"</span>
      </span>
    )
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return (
      <span>
        {label && <span className="text-(--qw-fg-muted)">{label}: </span>}
        <span className="text-amber-400">{String(data)}</span>
      </span>
    )
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <span>
          {label && <span className="text-(--qw-fg-muted)">{label}: </span>}
          <span className="text-(--qw-fg-faint)">[]</span>
        </span>
      )
    }

    return (
      <div style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        <button onClick={() => setCollapsed(!collapsed)} className="text-(--qw-fg-muted) hover:text-(--qw-fg) text-left">
          {label && <span>{label}: </span>}
          <span>{collapsed ? `[...] (${data.length})` : '['}</span>
        </button>
        {!collapsed && (
          <>
            {data.map((item, i) => (
              <div key={i} className="pl-4">
                <JsonTree data={item} depth={depth + 1} label={String(i)} />
                {i < data.length - 1 && <span className="text-(--qw-fg-faint)">,</span>}
              </div>
            ))}
            <span className="text-(--qw-fg-muted)">]</span>
          </>
        )}
      </div>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) {
      return (
        <span>
          {label && <span className="text-(--qw-fg-muted)">{label}: </span>}
          <span className="text-(--qw-fg-faint)">{'{}'}</span>
        </span>
      )
    }

    return (
      <div style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        <button onClick={() => setCollapsed(!collapsed)} className="text-(--qw-fg-muted) hover:text-(--qw-fg) text-left">
          {label && <span>{label}: </span>}
          <span>{collapsed ? `{...} (${entries.length})` : '{'}</span>
        </button>
        {!collapsed && (
          <>
            {entries.map(([key, value], i) => (
              <div key={key} className="pl-4">
                <JsonTree data={value} depth={depth + 1} label={key} />
                {i < entries.length - 1 && <span className="text-(--qw-fg-faint)">,</span>}
              </div>
            ))}
            <span className="text-(--qw-fg-muted)">{'}'}</span>
          </>
        )}
      </div>
    )
  }

  return <span className="text-(--qw-fg-faint)">{String(data)}</span>
}
