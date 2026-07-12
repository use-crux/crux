/**
 * Index v2 — full-width detail view (right pane of the browser).
 *
 * Ported from the design's index-detail.jsx. Fixed anatomy:
 * identity → properties band → diagnostics → per-kind ordered sections →
 * provenance. `indexSectionOrder` returns the section keys in priority order
 * for a kind; each section component returns null when its data is absent,
 * so a `partial` definition collapses to identity + hero + provenance.
 */

import { Fragment, type ComponentType, type ReactNode } from 'react'
import { T, toneColor, type Tone } from './tokens'
import { Icon } from './icons'
import { Btn, Chip, SectionHead } from './primitives'
import { Bar, ConfidenceMeter, FamilyDot, FidelityChip, KindBadge, KindGlyph, MetaRow, kindMeta } from './kit'
import type { ViewDef } from './adapt'
import { indexFactChips } from './adapt'
import { useIndexIndex, useIndexSelect } from './context'
import { IndexHero } from './hero'
import { IndexConfig, IndexContract, IndexControl, IndexData, IndexDependencies, IndexSource } from './intel'
import { IndexDiagnostics, IndexObservability, IndexProvenance, IndexQuality } from './sections'
import { CatContributesSection, CatObservedSection } from './observed'
import { IndexHealthSection } from './health'
import { IndexStorage } from './storage-section'
import { IndexMedia } from './media-section'

// ── relations block (two columns, full width) ────────────────────────────────
function CatRelations({ def }: { def: ViewDef }) {
  const idx = useIndexIndex()
  const select = useIndexSelect()
  const rels = idx.relationsOf(def.id)
  if (!rels.incoming.length && !rels.outgoing.length) return null
  const Col = ({ title, edges, dir }: { title: string; edges: typeof rels.incoming; dir: 'in' | 'out' }) => (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: T.fgFaint,
          fontWeight: 500,
          marginBottom: 10,
        }}
      >
        {title} · {edges.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {edges.length ? (
          edges.map((r) => {
            const otherId = dir === 'out' ? r.to : r.from
            const other = idx.byId(otherId)
            return (
              <button
                key={r.id}
                type="button"
                onClick={other ? () => select(otherId) : undefined}
                title={other ? `Open ${otherId}` : undefined}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  cursor: other ? 'pointer' : 'default',
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '7px 10px',
                  background: T.bg,
                  border: `1px solid ${T.border}`,
                  borderRadius: 7,
                }}
              >
                {other ? <KindGlyph kind={other.kind} size={22} /> : <span style={{ width: 22 }} />}
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 12,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {otherId}
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint, whiteSpace: 'nowrap' }}>
                  {r.type.replace(/_/g, ' ')}
                  {r.fidelity === 'partial' ? ' ·partial' : ''}
                </span>
              </button>
            )
          })
        ) : (
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>none</span>
        )}
      </div>
    </div>
  )
  return (
    <>
      <SectionHead
        eyebrow="Relations"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {rels.incoming.length} in · {rels.outgoing.length} out
          </span>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 22 }}>
        <Col title="Used by · incoming" edges={rels.incoming} dir="in" />
        <Col title="Depends on · outgoing" edges={rels.outgoing} dir="out" />
      </div>
    </>
  )
}

// ── per-kind section order (importance → prominence) ─────────────────────────
const INDEX_SECTION_COMP: Record<string, ComponentType<{ def: ViewDef }>> = {
  hero: IndexHero,
  config: IndexConfig,
  contract: IndexContract,
  source: IndexSource,
  control: IndexControl,
  data: IndexData,
  deps: IndexDependencies,
  storage: IndexStorage,
  media: IndexMedia,
  // observed-injection layer (prompt/context) + injectable "Contributes";
  // each returns null without data, so they are inert for every other kind.
  observed: CatObservedSection,
  contributes: CatContributesSection,
  observability: IndexObservability,
  relations: CatRelations,
  quality: IndexQuality,
  health: IndexHealthSection,
}

function indexSectionOrder(def: ViewDef): string[] {
  const k = def.kind
  const map: Record<string, string[]> = {
    prompt: [
      'hero',
      'config',
      'contract',
      'observed',
      'source',
      'deps',
      'quality',
      'observability',
      'relations',
      'health',
    ],
    context: ['hero', 'config', 'contract', 'observed', 'source', 'deps', 'relations', 'health'],
    injectable: ['hero', 'contributes', 'contract', 'config', 'source', 'deps', 'relations', 'health'],
    tool: ['hero', 'contract', 'config', 'observability', 'source', 'data', 'relations', 'quality', 'health'],
    agent: ['hero', 'config', 'deps', 'control', 'source', 'data', 'observability', 'quality', 'relations', 'health'],
    flow: [
      'hero',
      'control',
      'contract',
      'config',
      'data',
      'deps',
      'source',
      'observability',
      'quality',
      'relations',
      'health',
    ],
    evaluation: ['hero', 'config', 'quality', 'relations', 'source', 'health'],
  }
  if (map[k]) return map[k]
  if (k.startsWith('routing.'))
    return ['hero', 'config', 'control', 'deps', 'source', 'observability', 'relations', 'health', 'quality']
  if (k.startsWith('composition.'))
    return ['hero', 'control', 'config', 'deps', 'data', 'observability', 'relations', 'quality', 'health']
  if (k.startsWith('rag.'))
    return ['hero', 'config', 'deps', 'data', 'source', 'observability', 'quality', 'relations', 'health']
  if (k.startsWith('storage.')) return ['hero', 'storage', 'source', 'observability', 'relations', 'health']
  if (k === 'media.operation' || k === 'ingest.source')
    return ['hero', 'media', 'source', 'observability', 'relations', 'health']
  if (k.startsWith('eval.')) return ['hero', 'quality', 'config', 'source', 'relations', 'health']
  if (k === 'memory' || k === 'blackboard')
    return ['hero', 'config', 'contract', 'data', 'source', 'observability', 'relations', 'health']
  if (k === 'workspace') return ['hero', 'config', 'data', 'source', 'relations', 'health']
  if (k === 'guardrail' || k === 'constraint') return ['hero', 'config', 'source', 'deps', 'relations', 'health']
  if (k === 'scorer') return ['hero', 'config', 'source', 'relations', 'quality']
  if (k === 'dataset' || k === 'suite') return ['hero', 'quality', 'relations', 'health']
  return [
    'hero',
    'contract',
    'config',
    'source',
    'control',
    'data',
    'deps',
    'observability',
    'relations',
    'quality',
    'health',
  ]
}

const KIND_ACTIONS: Record<string, string[]> = {
  agent: ['Run eval', 'Playground'],
  prompt: ['Run eval', 'Playground'],
  flow: ['Run', 'Trace'],
  tool: ['Test', 'Trace'],
  'eval.prompt': ['Run eval'],
  suite: ['Run suite'],
}

// ── the detail view ──────────────────────────────────────────────────────────
export function IndexDetail({ def, onExpand }: { def: ViewDef | undefined; onExpand?: () => void }) {
  const idx = useIndexIndex()
  if (!def)
    return <div style={{ padding: 40, color: T.fgFaint, fontFamily: T.mono, fontSize: 13 }}>Select a definition</div>
  const m = kindMeta(def.kind)
  const chips = indexFactChips(def)
  const q = def.quality
  const directLints = idx.lintsForDef(def.id).filter((f) => f.primaryDefinitionId === def.id)
  const order = indexSectionOrder(def)
  const actions = KIND_ACTIONS[def.kind] ?? ['Open in runs']

  // quick-reference properties band — the at-a-glance health of the entry
  const props: ReactNode[] = []
  props.push(<ConfidenceMeter key="conf" value={def.confidence} />)
  if (def.status && def.status !== 'active') {
    props.push(
      <Chip key="status" tone={def.status === 'stale' ? 'warn' : 'danger'} dot>
        {def.status}
      </Chip>,
    )
  }
  if (q && q.passRate != null) {
    const tone: Tone = q.passRate >= 0.9 ? 'ok' : q.passRate >= 0.75 ? 'crux' : 'warn'
    props.push(
      <span
        key="pr"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: T.mono,
          fontSize: 11,
          color: T.fgMuted,
        }}
      >
        <span style={{ width: 40 }}>
          <Bar value={q.passRate} tone={tone} height={4} />
        </span>
        {Math.round(q.passRate * 100)}% · {q.runCount ?? 0} runs
      </span>,
    )
  }
  if (def.runtimeJoin) {
    props.push(
      <span
        key="rj"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: T.mono,
          fontSize: 11,
          color: T.crux,
          background: T.cruxSoft,
          padding: '2px 8px',
          borderRadius: 5,
        }}
      >
        <Icon name="trace" size={11} color={T.crux} />
        {def.runtimeJoin.spanName || def.runtimeJoin.primitive}
      </span>,
    )
  }
  if (directLints.length) {
    // Neutral by default; warn-toned only when a warning/error is present.
    // `info` never saturates the band (see the Index health handover §8).
    const actionable = directLints.some((l) => l.severity === 'warning' || l.severity === 'error')
    props.push(
      <span
        key="lint"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: T.mono,
          fontSize: 11,
          color: actionable ? T.warn : T.fgMuted,
        }}
      >
        <Icon name="sparkle" size={11} color={actionable ? T.warn : T.fgFaint} />
        {directLints.length} finding{directLints.length > 1 ? 's' : ''}
      </span>,
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: T.bg }}>
      {/* identity */}
      <div style={{ padding: '22px 30px 16px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <KindGlyph kind={def.kind} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: T.mono, fontSize: 23, fontWeight: 600, letterSpacing: '-0.02em' }}>
                {def.name}
              </span>
              <KindBadge kind={def.kind} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: T.fgMuted }}>
                <FamilyDot family={m.family} /> {m.familyLabel}
              </span>
              <FidelityChip value={def.fidelity} />
              {def.changedSinceBaseline && (
                <Chip tone="warn" dot>
                  changed vs baseline
                </Chip>
              )}
            </div>
            {def.description && (
              <p
                style={{
                  margin: '8px 0 0',
                  fontFamily: T.serif,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: T.fgMuted,
                  maxWidth: 760,
                }}
              >
                {def.description}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {actions.map((a, i) => (
              <Btn key={a} size="sm" variant={i === 0 ? 'primary' : 'ghost'} icon={i === 0 ? 'play' : undefined}>
                {a}
              </Btn>
            ))}
            <Btn size="sm" icon="github" variant="outline">
              Source
            </Btn>
            {onExpand && (
              <Btn size="sm" icon="grid" variant="outline" onClick={onExpand}>
                Expand
              </Btn>
            )}
          </div>
        </div>
        {/* properties band */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
          <MetaRow
            items={[
              def.file ? { label: 'source', value: `${def.file}:${def.line}` } : null,
              def.fingerprint ? { label: 'fp', value: def.fingerprint } : null,
              def.tags && def.tags.length ? { value: def.tags.map((x) => '#' + x).join(' ') } : null,
            ]}
          />
          {props.map((p, i) => (
            <Fragment key={i}>{p}</Fragment>
          ))}
        </div>
      </div>

      <div style={{ padding: '22px 30px 40px' }}>
        {/* at a glance */}
        {chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
            {chips.map(([key, v]) => (
              <span
                key={key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: T.bgElev,
                  border: `1px solid ${T.border}`,
                  fontFamily: T.mono,
                  fontSize: 11,
                }}
              >
                <span style={{ color: T.fgFaint }}>{key}</span>
                <span style={{ color: T.fg, fontWeight: 500 }}>{String(v)}</span>
              </span>
            ))}
          </div>
        )}

        {/* intelligence diagnostics (notable, near top) */}
        <IndexDiagnostics def={def} />

        {/* per-kind ordered sections */}
        {order.map((key) => {
          const C = INDEX_SECTION_COMP[key]
          return C ? <C key={key} def={def} /> : null
        })}

        {/* provenance — the quiet "everything else" */}
        <IndexProvenance def={def} />
      </div>
    </div>
  )
}
