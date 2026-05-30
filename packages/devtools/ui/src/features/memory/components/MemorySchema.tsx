import { LDCard } from './MemoryAtoms'
import type { MemoryStoreDetail } from '@/types'

interface SchemaFieldNode {
  name?: string
  type?: string
  required?: boolean
  default?: unknown
  description?: string
  fields?: readonly SchemaFieldNode[]
}

export function SchemaCard({
  schema,
  inferredFields,
  color,
  authoringHint,
}: {
  schema: MemoryStoreDetail['schema']
  inferredFields?: readonly { name: string; ty: string }[]
  color: string
  authoringHint?: string
}) {
  const s = schema as
    | {
        name?: string
        description?: string
        fields?: readonly SchemaFieldNode[]
        properties?: Record<string, SchemaFieldNode>
      }
    | undefined
  const fields: SchemaFieldNode[] = s
    ? Array.isArray(s.fields)
      ? (s.fields as SchemaFieldNode[])
      : s.properties
        ? Object.entries(s.properties).map(([name, f]) => ({ name, ...(f ?? {}) }))
        : []
    : []
  const hasAuthored = fields.length > 0
  const hasInferred = !hasAuthored && Boolean(inferredFields && inferredFields.length > 0)
  const title = hasAuthored ? `Schema${s?.name ? ` · ${s.name}` : ''}` : hasInferred ? 'Schema · inferred' : 'Schema'
  return (
    <LDCard title={title} color={color} padding="12px 14px">
      {hasAuthored ? (
        <>
          <div className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)', lineHeight: 1.7 }}>
            {fields.map((f, i) => (
              <SchemaFieldLine key={`${f.name ?? i}`} field={f} depth={0} />
            ))}
          </div>
          {s?.description && (
            <div
              className="mt-2.5 pt-2.5 text-[12px] leading-[1.5]"
              style={{
                borderTop: '1px dashed var(--qw-border)',
                color: 'var(--qw-fg-muted)',
                fontFamily: 'var(--qw-serif, Georgia, serif)',
              }}
            >
              {s.description}
            </div>
          )}
        </>
      ) : hasInferred ? (
        <>
          <div className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)', lineHeight: 1.7 }}>
            {inferredFields!.map((f) => (
              <div key={f.name}>
                <span style={{ color: 'var(--qw-crux)' }}>{f.name}</span>{' '}
                <span style={{ color: 'var(--qw-fg-faint)' }}>{f.ty}</span>
              </div>
            ))}
          </div>
          <div
            className="mt-2.5 pt-2.5 text-[11.5px] leading-[1.45]"
            style={{
              borderTop: '1px dashed var(--qw-border)',
              color: 'var(--qw-fg-faint)',
              fontFamily: 'var(--qw-serif, Georgia, serif)',
            }}
          >
            Authored schema not declared in this project — showing runtime-inferred shape.
            {authoringHint && (
              <>
                {' '}
                Declare with <span className="font-mono">{authoringHint}</span> to see typed field descriptions here.
              </>
            )}
          </div>
        </>
      ) : (
        <SchemaPlaceholderBody authoringHint={authoringHint} />
      )}
    </LDCard>
  )
}

function SchemaPlaceholderBody({ authoringHint }: { authoringHint?: string }) {
  return (
    <div
      className="text-[12px] leading-[1.5]"
      style={{
        color: 'var(--qw-fg-muted)',
        fontFamily: 'var(--qw-serif, Georgia, serif)',
      }}
    >
      <div
        className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        Pending authored schema
      </div>
      Not declared in this project yet — runtime hasn't observed any fields either.
      {authoringHint && (
        <div className="mt-1.5">
          Declare with{' '}
          <span className="font-mono" style={{ color: 'var(--qw-fg)' }}>
            {authoringHint}
          </span>{' '}
          and the typed fields will surface here automatically.
        </div>
      )}
    </div>
  )
}

function SchemaFieldLine({ field, depth }: { field: SchemaFieldNode; depth: number }) {
  const indent = depth * 12
  return (
    <div style={{ paddingLeft: indent }}>
      <div className="flex flex-wrap items-baseline gap-1.5">
        {field.name && <span style={{ color: 'var(--qw-crux)' }}>{field.name}</span>}
        {field.type && <span style={{ color: 'var(--qw-fg-faint)' }}>{field.type}</span>}
        {field.required && (
          <span
            className="rounded-[3px] px-[5px] text-[9px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: 'var(--qw-danger)', background: 'var(--qw-danger-soft)' }}
          >
            required
          </span>
        )}
      </div>
      {field.description && (
        <div
          className="pb-1 text-[11.5px] leading-[1.45]"
          style={{
            color: 'var(--qw-fg-muted)',
            fontFamily: 'var(--qw-serif, Georgia, serif)',
            maxWidth: 360,
          }}
        >
          {field.description}
        </div>
      )}
      {field.fields && field.fields.length > 0 && (
        <div>
          {field.fields.map((c, i) => (
            <SchemaFieldLine key={`${c.name ?? i}`} field={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
