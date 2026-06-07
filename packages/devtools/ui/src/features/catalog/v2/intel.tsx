/**
 * Catalog v2 — source + schema + intelligence renderers.
 *
 * Ported from the design's catalog-intel.jsx:
 *   · CatCode            — inline syntax highlighter
 *   · CatSchemaField     — typed field tree
 *   · CatSourceRefs      — collapsible sourceRef cards
 *   · CatalogSource      — primary call-site snippet + refs
 *   · CatalogContract    — input/output/args/config/schema field trees
 *   · CatalogControl     — mode, ordering, retry, budget, suspension points
 *   · CatalogData        — reads / writes / retrievals / artifacts
 *   · CatalogDependencies— cards grouped by target kind (graph edges)
 *   · CatalogConfig      — settings/config params
 *
 * Every section returns `null` when its data is absent.
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { ControlFacts, DataFacts, DependencyFacts, ProjectSourceRef } from '@/types'
import { T, toneColor, type Tone } from './tokens'
import { Icon } from './icons'
import { Chip, SectionHead } from './primitives'
import { FamilyDot, FidelityChip, KindGlyph, kindMeta } from './kit'
import type { SchemaField, ViewDef } from './adapt'
import { useCatalogIndex, useCatalogSelect } from './context'

// ── syntax-highlighted code block ────────────────────────────────────────────
interface Tok {
  t: string
  v: string
}

function tokenizeLines(src: string): Tok[][] {
  const re =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\[\s\S]|[^\\`])*`?|'(?:\\[\s\S]|[^\\'\n])*'?|"(?:\\[\s\S]|[^\\"\n])*"?)|\b(const|let|var|function|return|if|else|export|import|from|as|async|await|new|class|interface|type|enum|extends|implements|true|false|null|undefined|default|of|in|typeof|void|never)\b|\b(\d+(?:\.\d+)?)\b|([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()|([a-zA-Z_$][a-zA-Z0-9_$]*)|([\s\S])/g
  const flat: Tok[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (m[1]) flat.push({ t: 'c', v: m[1] })
    else if (m[2]) flat.push({ t: 's', v: m[2] })
    else if (m[3]) flat.push({ t: 'k', v: m[3] })
    else if (m[4]) flat.push({ t: 'n', v: m[4] })
    else if (m[5]) flat.push({ t: 'f', v: m[5] })
    else if (m[6]) flat.push({ t: 'i', v: m[6] })
    else flat.push({ t: 'p', v: m[7] })
  }
  const lines: Tok[][] = [[]]
  for (const tok of flat) {
    const parts = tok.v.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) lines.push([])
      if (p.length) lines[lines.length - 1].push({ t: tok.t, v: p })
    })
  }
  return lines
}

export function CatCode({ code, startLine = 1, maxHeight }: { code: string; startLine?: number; maxHeight?: number }) {
  const lines = useMemo(() => tokenizeLines(code || ''), [code])
  const col: Record<string, string> = { c: T.fgFaint, s: T.ok, k: T.iris, n: T.warn, f: T.crux, i: T.fg, p: T.fgMuted }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        fontFamily: T.mono,
        fontSize: 11.5,
        lineHeight: 1.65,
        background: T.bg,
        color: T.fg,
        overflow: 'auto',
        maxHeight,
      }}
    >
      <div
        aria-hidden
        style={{
          padding: '12px 10px 12px 14px',
          textAlign: 'right',
          color: T.fgFaint,
          borderRight: `1px solid ${T.border}`,
          background: T.bgElev,
          userSelect: 'none',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 34,
        }}
      >
        {lines.map((_, i) => (
          <div key={i}>{startLine + i}</div>
        ))}
      </div>
      <div style={{ padding: '12px 16px', minWidth: 0 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: 'pre' }}>
            {line.length === 0 ? ' ' : line.map((tok, j) => <span key={j} style={{ color: col[tok.t] ?? T.fg }}>{tok.v}</span>)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── schema field tree ────────────────────────────────────────────────────────
export function CatSchemaField({ field, depth = 0, last = false }: { field: SchemaField; depth?: number; last?: boolean }) {
  const has = Array.isArray(field.fields) && field.fields.length > 0
  const indent = depth * 16
  return (
    <div style={{ position: 'relative', paddingLeft: indent }}>
      {depth > 0 && <span style={{ position: 'absolute', left: indent - 8, top: 0, bottom: last && !has ? 14 : 0, width: 1, background: T.border }} />}
      {depth > 0 && <span style={{ position: 'absolute', left: indent - 8, top: 14, width: 6, height: 1, background: T.border }} />}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0 2px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.crux }}>{field.name}</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgMuted }}>{field.type}</span>
        {field.required && (
          <span style={{ fontSize: 9, color: T.danger, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, padding: '1px 5px', background: T.dangerSoft, borderRadius: 3 }}>
            required
          </span>
        )}
        {!field.required && field.default !== undefined && (
          <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>
            default · <span style={{ color: T.fg }}>{JSON.stringify(field.default)}</span>
          </span>
        )}
      </div>
      {field.description && (
        <div style={{ paddingBottom: 8, fontFamily: T.serif, fontSize: 12, color: T.fgMuted, lineHeight: 1.55, maxWidth: 520 }}>{field.description}</div>
      )}
      {has && (
        <div style={{ paddingBottom: 4 }}>
          {field.fields!.map((f, i) => (
            <CatSchemaField key={f.name} field={f} depth={depth + 1} last={i === field.fields!.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── sourceRefs (collapsible cards) ───────────────────────────────────────────
const CAT_ROLE_TONE: Record<string, Tone> = {
  schema: 'iris',
  prompt: 'crux',
  system: 'crux',
  callback: 'ok',
  execute: 'ok',
  handler: 'ok',
  validator: 'warn',
  policy: 'warn',
  resolver: 'warn',
  config: 'muted',
  helper: 'muted',
}

export function CatSourceRefs({ refs }: { refs: ProjectSourceRef[] }) {
  const idx = useCatalogIndex()
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {refs.map((r) => {
        const open = closed[r.id] !== true
        const c = toneColor(T, CAT_ROLE_TONE[r.role] ?? 'muted')
        const md = r.metadata ?? {}
        const flags = [
          md.schemaKind,
          md.nested && 'nested',
          md.injected && 'injected',
          md.fragment && 'fragment',
          md.factoryArg && 'factory-arg',
          md.toolMapContributor && 'tool-map · ' + md.toolMapContributor,
          md.dataAccess && 'data-access',
          md.routingTarget && 'routing-target',
        ].filter((x): x is string => Boolean(x))
        const refIds = md.referencedDefinitionIds ?? []
        return (
          <div key={r.id} style={{ background: T.bgElev, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setClosed((s) => ({ ...s, [r.id]: !s[r.id] }))}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: 'auto auto 1fr auto auto',
                gap: 10,
                alignItems: 'center',
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 14px',
                background: T.bgMuted,
                borderBottom: open && r.snippet ? `1px solid ${T.border}` : 'none',
              }}
            >
              <Icon name="arrowDown" size={9} color={T.fgFaint} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms' }} />
              <span style={{ fontFamily: T.mono, fontSize: 10, padding: '1px 6px', borderRadius: 3, background: T.bg, color: c.fg, boxShadow: `inset 0 0 0 1px ${T.border}`, letterSpacing: '0.04em' }}>
                {r.role}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fg, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.symbol || r.property || '(anonymous)'}
                {r.property && r.symbol && <span style={{ color: T.fgFaint, fontWeight: 400 }}> · {r.property}</span>}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>
                {idx.relPath(r.source.file)}
                <span style={{ color: T.crux }}>:{r.source.line}</span>
              </span>
              <FidelityChip value={r.fidelity} size="xs" />
            </button>
            {(flags.length > 0 || refIds.length > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '6px 14px', background: T.bg, borderBottom: open && r.snippet ? `1px solid ${T.border}` : 'none' }}>
                {flags.map((fl) => (
                  <span key={fl} style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgMuted, background: T.bgMuted, padding: '1px 6px', borderRadius: 3, border: `1px solid ${T.border}` }}>
                    {fl}
                  </span>
                ))}
                {refIds.map((id) => (
                  <span key={id} style={{ fontFamily: T.mono, fontSize: 9.5, color: T.crux, background: T.cruxSoft, padding: '1px 6px', borderRadius: 3 }}>
                    → {id}
                  </span>
                ))}
              </div>
            )}
            {open && r.snippet && (
              <>
                {r.snippet.truncated && (
                  <div style={{ padding: '5px 14px', background: T.warnSoft, color: T.warn, fontFamily: T.mono, fontSize: 10.5, borderBottom: `1px solid ${T.border}` }}>
                    truncated · only the head was statically resolvable
                  </div>
                )}
                <CatCode code={r.snippet.source} startLine={r.snippet.range?.startLine ?? r.source.line} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── card chrome ──────────────────────────────────────────────────────────────
function IntelCard({ title, tone, right, children, pad = true }: { title: ReactNode; tone?: Tone; right?: ReactNode; children: ReactNode; pad?: boolean }) {
  const c = toneColor(T, tone ?? 'muted')
  return (
    <div style={{ background: T.bgElev, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `1px solid ${T.border}`, background: T.bgMuted }}>
        {tone && <span style={{ width: 7, height: 7, borderRadius: 99, background: c.fg }} />}
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
        {right && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</span>}
      </div>
      <div style={{ padding: pad ? '14px 16px' : 0 }}>{children}</div>
    </div>
  )
}

// ── SOURCE ───────────────────────────────────────────────────────────────────
export function CatalogSource({ def }: { def: ViewDef }) {
  if (!def.snippet && !(def.sourceRefs && def.sourceRefs.length)) return null
  return (
    <>
      <SectionHead
        eyebrow="Source"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {def.file}
            {def.sourceRefs ? ` · +${def.sourceRefs.length} refs` : ''}
          </span>
        }
      />
      {def.snippet && (
        <div style={{ background: T.bgElev, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: def.sourceRefs ? 10 : 22 }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: T.mono, color: T.fgMuted, background: T.bgMuted }}>
            <Icon name="doc" size={11} />
            <span>{def.file}</span>
            <FidelityChip value={def.fidelity} size="xs" />
            <span style={{ marginLeft: 'auto', color: T.fgFaint }}>{def.snippet.language || 'ts'} · primary call site</span>
          </div>
          <CatCode code={def.snippet.source} startLine={def.snippet.range?.startLine ?? def.line ?? 1} maxHeight={360} />
        </div>
      )}
      {def.sourceRefs && def.sourceRefs.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <CatSourceRefs refs={def.sourceRefs} />
        </div>
      )}
    </>
  )
}

// ── CONTRACT ─────────────────────────────────────────────────────────────────
export function CatalogContract({ def }: { def: ViewDef }) {
  const c = def.contract
  if (
    !c ||
    (!c.inputSchema &&
      !c.expandedInputSchema &&
      !c.outputSchema &&
      !c.argsSchema &&
      !c.configSchema &&
      !c.schema &&
      !c.inputContributions)
  ) {
    return null
  }
  const pair = c.inputSchema || c.outputSchema
  const cols: Array<{ title: string; tone: Tone; fields: SchemaField[] }> = []
  if (c.inputSchema) cols.push({ title: 'Input', tone: 'iris', fields: c.inputSchema })
  if (c.expandedInputSchema) cols.push({ title: 'Effective input', tone: 'crux', fields: c.expandedInputSchema })
  if (c.outputSchema) cols.push({ title: 'Output', tone: 'ok', fields: c.outputSchema })
  if (c.argsSchema) cols.push({ title: 'Args', tone: 'blue', fields: c.argsSchema })
  if (c.configSchema) cols.push({ title: 'Config', tone: 'muted', fields: c.configSchema })
  if (c.schema) cols.push({ title: 'Schema', tone: 'plum', fields: c.schema })
  const total = cols.reduce((n, s) => n + s.fields.length, 0)
  return (
    <>
      <SectionHead
        eyebrow="Contract"
        right={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>{total} fields · {cols.map((s) => s.title.toLowerCase()).join(' · ')}</span>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: cols.length > 1 && pair ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 22 }}>
        {cols.map((s) => (
          <IntelCard key={s.title} title={s.title} tone={s.tone} right={<span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>{s.fields.length} fields</span>}>
            {s.fields.map((f, i) => (
              <CatSchemaField key={f.name} field={f} depth={0} last={i === s.fields.length - 1} />
            ))}
          </IntelCard>
        ))}
      </div>
      {c.inputContributions && c.inputContributions.length > 0 && (
        <div style={{ marginTop: -8, marginBottom: 22 }}>
          <IntelCard title="Input contributions" tone="crux" right={<span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>{c.inputContributions.length} fields</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {c.inputContributions.map((item, i) => (
                <div key={`${item.sourceDefinitionId ?? 'source'}:${item.field}:${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center', padding: '7px 9px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.crux, fontWeight: 600 }}>{item.field}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}> from </span>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fg }}>{item.sourceName ?? item.sourceDefinitionId}</span>
                  </div>
                  <Chip tone={item.required ? 'danger' : 'muted'} mono>{item.required ? 'required' : 'optional'}</Chip>
                  <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>
                    {item.conditionality ?? 'always'}{item.branch ? ` · ${item.branch}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </IntelCard>
        </div>
      )}
    </>
  )
}

// ── CONTROL ──────────────────────────────────────────────────────────────────
export function CatalogInjection({ def }: { def: ViewDef }) {
  const idx = useCatalogIndex()
  const select = useCatalogSelect()
  const entries = def.facts?.useEntries ?? []
  const tools = def.facts?.tools
  const mayInject = def.facts?.mayInject ?? []
  if (entries.length === 0 && !tools && mayInject.length === 0) return null
  return (
    <>
      <SectionHead
        eyebrow="Injection"
        right={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>{entries.length} uses{tools ? ' · tools' : ''}</span>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: entries.length > 0 && (tools || mayInject.length > 0) ? '1.4fr 1fr' : '1fr', gap: 16, marginBottom: 22 }}>
        {entries.length > 0 && (
          <IntelCard title="Use entries" tone="iris" right={<span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>{entries.length}</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((entry, i) => {
                const target = entry.variable ? idx.resolve(entry.variable) : undefined
                return (
                  <button
                    key={`${entry.variable ?? 'dynamic'}:${i}`}
                    type="button"
                    onClick={target ? () => select(target.id) : undefined}
                    title={target ? `Open ${target.id}` : undefined}
                    style={{ all: 'unset', boxSizing: 'border-box', cursor: target ? 'pointer' : 'default', display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 9, alignItems: 'center', padding: '7px 9px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7 }}
                  >
                    {target ? <KindGlyph kind={target.kind} size={20} /> : <span style={{ width: 20 }} />}
                    <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 7, overflow: 'hidden' }}>
                      <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fg, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.variable ?? '(dynamic)'}</span>
                      <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>{entry.relationHint ?? 'unknown'}</span>
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint, whiteSpace: 'nowrap' }}>
                      {entry.conditionality ?? 'unknown'}{entry.branch ? ` · ${entry.branch}` : ''}{entry.via ? ` · ${entry.via}` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </IntelCard>
        )}
        {(tools || mayInject.length > 0) && (
          <IntelCard title="Contributions" tone="ok">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mayInject.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {mayInject.map((kind) => (
                    <Chip key={kind} tone="crux" mono>{kind}</Chip>
                  ))}
                </div>
              )}
              {tools && (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.fgFaint, fontWeight: 500, marginBottom: 7 }}>Tools</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(tools.names ?? tools.variables ?? []).map((name) => (
                      <Chip key={name} tone="ok" mono>{name}</Chip>
                    ))}
                    {tools.dynamic && <Chip tone="warn" mono>dynamic</Chip>}
                    {!tools.dynamic && !(tools.names ?? tools.variables)?.length && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>declared</span>}
                  </div>
                </div>
              )}
            </div>
          </IntelCard>
        )}
      </div>
    </>
  )
}

export function CatalogControl({ def }: { def: ViewDef }) {
  const ctl: ControlFacts | undefined = def.control
  if (!ctl) return null
  const kv = (k: string, v: ReactNode) => (
    <div style={{ display: 'flex', gap: 10, fontFamily: T.mono, fontSize: 11.5 }}>
      <span style={{ color: T.fgFaint, minWidth: 96 }}>{k}</span>
      <span style={{ color: T.fg }}>{v}</span>
    </div>
  )
  const hasBudget = ctl.budget && Object.keys(ctl.budget).length > 0
  return (
    <>
      <SectionHead
        eyebrow="Control & shape"
        right={
          <span style={{ display: 'flex', gap: 6 }}>
            {ctl.mode && <Chip tone="blue" mono>{ctl.mode}</Chip>}
            {ctl.ordering && <Chip tone="muted" mono>{ctl.ordering}</Chip>}
          </span>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: ctl.suspensionPoints ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 22 }}>
        <IntelCard title="Execution" tone="blue">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {ctl.mode && kv('mode', ctl.mode)}
            {ctl.ordering && kv('ordering', ctl.ordering)}
            {ctl.children && kv('children', ctl.children.length)}
            {ctl.retryPolicy && kv('retry', `${ctl.retryPolicy.maxAttempts}× · ${ctl.retryPolicy.backoff}`)}
            {ctl.retryPolicy && ctl.retryPolicy.nonRetryableErrors && kv('non-retryable', ctl.retryPolicy.nonRetryableErrors.join(', '))}
            {ctl.fallbackPolicy && kv('fallback', `${ctl.fallbackPolicy.optionCount} options · ${ctl.fallbackPolicy.timeoutMs}ms · shouldFallback=${String(ctl.fallbackPolicy.shouldFallback)}`)}
            {hasBudget && kv('budget', Object.entries(ctl.budget!).map(([k, v]) => `${k}=${String(v)}`).join(' · '))}
          </div>
        </IntelCard>
        {ctl.suspensionPoints && (
          <IntelCard title="Suspension points" tone="warn" right={<span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>{ctl.suspensionPoints.length}</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ctl.suspensionPoints.map((sp) => (
                <div key={sp.id} style={{ padding: '8px 10px', background: T.warnSoft, borderRadius: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                    <Icon name="clock" size={12} color={T.warn} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.warn }}>{sp.label}</span>
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgMuted }}>
                    signal · <span style={{ color: T.fg }}>{sp.signal}</span>
                    {sp.resumesDefinitionId && (
                      <>
                        {' '}→ resumes <span style={{ color: T.crux }}>{sp.resumesDefinitionId.split('.').pop()}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </IntelCard>
        )}
      </div>
    </>
  )
}

// ── DATA ACCESS ──────────────────────────────────────────────────────────────
export function CatalogData({ def }: { def: ViewDef }) {
  const idx = useCatalogIndex()
  const select = useCatalogSelect()
  const d: DataFacts | undefined = def.data
  if (!d || (!d.reads && !d.writes && !d.retrievals && !d.artifacts)) return null
  const opTone: Record<string, Tone> = { read: 'ok', write: 'danger', update: 'warn', append: 'iris', query: 'crux', delete: 'danger' }
  const Access = ({ items, title }: { items: DataFacts['reads']; title: string }) => (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.fgFaint, fontWeight: 500, marginBottom: 8 }}>{title} · {items!.length}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {items!.map((a, i) => {
          const target = a.targetId ? idx.byId(a.targetId) : undefined
          const tc = toneColor(T, opTone[a.operation ?? ''] ?? 'muted')
          return (
            <button
              key={i}
              type="button"
              onClick={target && a.targetId ? () => select(a.targetId!) : undefined}
              title={target ? `Open ${a.targetId}` : undefined}
              style={{ all: 'unset', boxSizing: 'border-box', cursor: target ? 'pointer' : 'default', display: 'grid', gridTemplateColumns: '60px 22px 1fr auto', gap: 9, alignItems: 'center', padding: '6px 9px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7 }}
            >
              <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, color: tc.fg, background: tc.soft, padding: '1px 5px', borderRadius: 3, textAlign: 'center' }}>{a.operation}</span>
              {target ? <KindGlyph kind={target.kind} size={20} /> : <span style={{ width: 20 }} />}
              <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fg }}>{a.targetId || a.targetVariable}</span>
              {a.key && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>{a.key}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
  return (
    <>
      <SectionHead eyebrow="Data access" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 22 }}>
        {d.reads && d.reads.length > 0 && <Access items={d.reads} title="Reads" />}
        {d.writes && d.writes.length > 0 && <Access items={d.writes} title="Writes" />}
        {d.retrievals && d.retrievals.length > 0 && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.fgFaint, fontWeight: 500, marginBottom: 8 }}>Retrievals · {d.retrievals.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {d.retrievals.map((r, i) => {
                const rid = r.retrieverId ?? r.memoryId ?? r.workspaceId
                const target = rid ? idx.byId(rid) : undefined
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={target && rid ? () => select(rid) : undefined}
                    title={target ? `Open ${rid}` : undefined}
                    style={{ all: 'unset', boxSizing: 'border-box', cursor: target ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7 }}
                  >
                    <KindGlyph kind={target ? target.kind : 'rag.retriever'} size={20} />
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fg }}>{rid}</span>
                    {r.topK != null && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint, marginLeft: 'auto' }}>topK · {r.topK}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {d.artifacts && d.artifacts.length > 0 && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.fgFaint, fontWeight: 500, marginBottom: 8 }}>Artifacts · {d.artifacts.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {d.artifacts.map((a, i) => (
                <div key={i} style={{ padding: '7px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.iris, fontWeight: 600 }}>{a.name}</span>
                    {a.kind && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgMuted }}>{a.kind}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── DEPENDENCIES ─────────────────────────────────────────────────────────────
const DEP_KIND: Record<string, string> = {
  prompts: 'prompt',
  contexts: 'context',
  injectables: 'injectable',
  tools: 'tool',
  agents: 'agent',
  flows: 'flow',
  memory: 'memory',
  blackboards: 'blackboard',
  workspaces: 'workspace',
  stores: 'memory.store',
  blocks: 'memory.block',
  routers: 'routing.router',
  ragPipelines: 'rag.pipeline',
  retrievers: 'rag.retriever',
  guardrails: 'guardrail',
  constraints: 'constraint',
  scorers: 'scorer',
}

export function CatalogDependencies({ def }: { def: ViewDef }) {
  const idx = useCatalogIndex()
  const select = useCatalogSelect()
  const raw: DependencyFacts | undefined = def.dependencies
  if (!raw) return null
  const dep = raw as unknown as Record<string, string[] | undefined>
  const groups = Object.keys(dep).filter((g) => Array.isArray(dep[g]) && dep[g]!.length > 0 && DEP_KIND[g])
  if (!groups.length) return null
  const total = groups.reduce((n, g) => n + dep[g]!.length, 0)
  return (
    <>
      <SectionHead eyebrow="Dependencies" right={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>{total} across {groups.length} kinds</span>} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
        {groups.map((g) => (
          <div key={g} style={{ flex: '1 1 220px', minWidth: 200, background: T.bgElev, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <FamilyDot family={kindMeta(DEP_KIND[g]).family} />
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: T.fg }}>{g}</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>{dep[g]!.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {dep[g]!.map((id) => {
                const td = idx.byId(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={td ? () => select(id) : undefined}
                    title={td ? `Open ${id}` : undefined}
                    style={{ all: 'unset', boxSizing: 'border-box', cursor: td ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6 }}
                  >
                    <KindGlyph kind={td ? td.kind : DEP_KIND[g]} size={19} />
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id}</span>
                    <Icon name="arrowRight" size={11} color={T.fgFaint} style={{ marginLeft: 'auto' }} />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── CONFIGURATION ────────────────────────────────────────────────────────────
function fmtCfg(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ')
  if (v === null) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

export function CatalogConfig({ def }: { def: ViewDef }) {
  const cfg: Record<string, unknown> = { ...(def.config ?? def.facts?.settings ?? {}) }
  const keys = Object.keys(cfg)
  if (!keys.length) return null
  const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
  const scalars = keys.filter((k) => !isObj(cfg[k]))
  const groups = keys.filter((k) => isObj(cfg[k]))
  const Param = ({ k, v }: { k: string; v: unknown }) => {
    const isBool = typeof v === 'boolean'
    const isNull = v === null
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>{k}</span>
        <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 500, color: isNull ? T.fgFaint : isBool ? (v ? T.ok : T.fgMuted) : T.fg, textAlign: 'right' }}>{fmtCfg(v)}</span>
      </div>
    )
  }
  return (
    <>
      <SectionHead eyebrow="Configuration" right={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>{keys.length} params</span>} />
      <div style={{ background: T.bgElev, border: `1px solid ${T.border}`, borderRadius: 11, padding: '6px 18px 12px', marginBottom: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 36 }}>
          {scalars.map((k) => (
            <Param key={k} k={k} v={cfg[k]} />
          ))}
        </div>
        {groups.map((gk) => (
          <div key={gk} style={{ marginTop: 12 }}>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{gk}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 36 }}>
              {Object.entries(cfg[gk] as Record<string, unknown>).map(([k, v]) => (
                <Param key={k} k={k} v={v} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
