import type { JsonSchema } from '@/types'

interface SchemaFieldNode {
  name: string
  type: string
  required: boolean
  default?: unknown
  description?: string
  fields?: SchemaFieldNode[]
}

function describeType(s: JsonSchema | undefined): string {
  if (!s) return 'unknown'
  const t = s.type
  if (Array.isArray(s.enum)) {
    const vals = s.enum.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' | ')
    return `enum<${vals}>`
  }
  if (s.const !== undefined) return `const<${JSON.stringify(s.const)}>`
  if (t === 'array') {
    const items = s.items as JsonSchema | undefined
    const itemType = items ? describeType(items) : 'unknown'
    return `${itemType}[]`
  }
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const variants = (s.anyOf ?? s.oneOf) as JsonSchema[]
    return variants.map(describeType).join(' | ')
  }
  if (typeof t === 'string') return t
  if (Array.isArray(t)) return t.join(' | ')
  if (s.properties) return 'object'
  return s.$ref ? String(s.$ref).split('/').pop()! : 'unknown'
}

export function schemaToFields(schema: JsonSchema | undefined): SchemaFieldNode[] {
  if (!schema || typeof schema !== 'object') return []
  const props = schema.properties as Record<string, JsonSchema> | undefined
  const required = (schema.required as string[] | undefined) ?? []
  if (!props) return []

  const out: SchemaFieldNode[] = []
  for (const [name, sub] of Object.entries(props)) {
    const fieldType = describeType(sub)
    let nested: SchemaFieldNode[] | undefined
    if (sub.type === 'object' && sub.properties) {
      nested = schemaToFields(sub)
    } else if (sub.type === 'array' && (sub.items as JsonSchema | undefined)?.type === 'object') {
      nested = schemaToFields(sub.items as JsonSchema)
    }
    out.push({
      name,
      type: fieldType,
      required: required.includes(name),
      default: sub.default,
      description: typeof sub.description === 'string' ? sub.description : undefined,
      fields: nested && nested.length > 0 ? nested : undefined,
    })
  }
  return out
}

function SchemaField({ field, depth = 0, last = false }: { field: SchemaFieldNode; depth?: number; last?: boolean }) {
  const hasChildren = !!field.fields && field.fields.length > 0
  const indent = depth * 16
  return (
    <div style={{ position: 'relative', paddingLeft: indent }}>
      {depth > 0 && (
        <span
          style={{
            position: 'absolute',
            left: indent - 8,
            top: 0,
            bottom: last && !hasChildren ? 14 : 0,
            width: 1,
            background: 'var(--qw-border)',
          }}
        />
      )}
      {depth > 0 && (
        <span
          style={{
            position: 'absolute',
            left: indent - 8,
            top: 14,
            width: 6,
            height: 1,
            background: 'var(--qw-border)',
          }}
        />
      )}
      <div className="flex flex-wrap items-baseline gap-2 py-[6px] pb-0.5">
        <span className="font-mono text-[12px] font-semibold" style={{ color: 'var(--qw-crux)' }}>
          {field.name}
        </span>
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {field.type}
        </span>
        {field.required && (
          <span
            className="rounded-[3px] px-[5px] py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: 'var(--qw-danger)', background: 'var(--qw-danger-soft)' }}
          >
            required
          </span>
        )}
        {!field.required && field.default !== undefined && (
          <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            default · <span style={{ color: 'var(--qw-fg)' }}>{JSON.stringify(field.default)}</span>
          </span>
        )}
      </div>
      {field.description && (
        <div
          className="max-w-[480px] pb-2 text-[12px] leading-[1.55]"
          style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif, Georgia, serif)' }}
        >
          {field.description}
        </div>
      )}
      {hasChildren && (
        <div className="pb-1">
          {field.fields!.map((f, i) => (
            <SchemaField key={f.name} field={f} depth={depth + 1} last={i === field.fields!.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SchemaCard({
  title,
  dotColor,
  fields,
}: {
  title: string
  dotColor: string
  fields: SchemaFieldNode[]
}) {
  return (
    <div
      className="rounded-[10px] px-4 py-3.5"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div className="mb-3 flex items-center gap-2 pb-2.5" style={{ borderBottom: '1px solid var(--qw-border)' }}>
        <span className="size-2 rounded-full" style={{ background: dotColor }} />
        <span className="text-[12px] font-semibold tracking-[0.02em]">{title}</span>
        <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {fields.length} {fields.length === 1 ? 'field' : 'fields'}
        </span>
      </div>
      {fields.map((f, i) => (
        <SchemaField key={f.name} field={f} depth={0} last={i === fields.length - 1} />
      ))}
    </div>
  )
}
