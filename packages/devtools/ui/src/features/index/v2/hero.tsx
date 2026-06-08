/**
 * Index v2 — per-kind hero.
 *
 * Ported from the design's index-detail.jsx IndexHero. The hero is the
 * primitive-specific diagram that makes each kind feel natively supported:
 * an agent loop, a flow's ordered step chain, a router's route table, a
 * cascade's escalation ladder, a memory store's blocks, etc. Driven by
 * metadata.facts + children + relations. Returns null for kinds with no
 * bespoke hero (the spine still renders the rest).
 */

import { Fragment, type ReactNode } from 'react'
import { T, toneColor, type Tone } from './tokens'
import { CatIcon, Icon } from './icons'
import { Chip } from './primitives'
import {
  Bar,
  InjectTag,
  INJECT_GROUPS,
  INJECT_REL_KIND,
  injectGroupOf,
  KindBadge,
  KindGlyph,
  kindMeta,
  type InjectGroup,
} from './kit'
import type { IndexIndex, CatFacts, ViewDef } from './adapt'
import { useIndexIndex, useIndexSelect } from './context'

/** A single authored `use`/injection reference (a `facts.useEntries[]` item). */
type UseEntry = NonNullable<CatFacts['useEntries']>[number]

// ── hero atoms ───────────────────────────────────────────────────────────────
function HNode({
  kind,
  label,
  sub,
  tone,
  dim,
  onClick,
  external,
}: {
  kind?: string
  label: ReactNode
  sub?: ReactNode
  tone?: Tone
  dim?: boolean
  onClick?: () => void
  external?: boolean
}) {
  const c = toneColor(T, tone ?? (kind ? kindMeta(kind).tone : 'muted'))
  const interactive = Boolean(onClick)
  const baseStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '8px 12px',
    borderRadius: 9,
    background: dim ? T.bg : T.bgElev,
    border: `1px solid ${external ? T.border : dim ? T.border : c.line}`,
    opacity: dim ? 0.85 : external ? 0.6 : 1,
    minWidth: 0,
  } as const
  const inner = (
    <>
      {kind ? (
        <KindGlyph kind={kind} size={24} />
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: 99, background: c.fg }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 12,
            fontWeight: 500,
            color: T.fg,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
        {sub && <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}>{sub}</div>}
      </div>
      {interactive && <Icon name="arrowRight" size={12} color={T.fgFaint} />}
    </>
  )
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={typeof label === 'string' ? `Open ${label}` : undefined}
        style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', ...baseStyle }}
      >
        {inner}
      </button>
    )
  }
  return (
    <div title={external ? 'Not in the index — built-in or external reference' : undefined} style={baseStyle}>
      {inner}
    </div>
  )
}

function HArrow({ down }: { down?: boolean }) {
  return (
    <Icon
      name={down ? 'arrowDown' : 'arrowRight'}
      size={14}
      color={T.fgFaint}
      style={{ flexShrink: 0, margin: down ? '2px 0' : '0 2px' }}
    />
  )
}

function HeroFrame({
  title,
  tone,
  right,
  children,
  pad = true,
}: {
  title: ReactNode
  tone?: Tone
  right?: ReactNode
  children: ReactNode
  pad?: boolean
}) {
  const c = toneColor(T, tone ?? 'crux')
  return (
    <div
      style={{
        background: T.bgElev,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 22,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '11px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: c.soft,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 99, background: c.fg }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.fg }}>{title}</span>
        {right && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</span>}
      </div>
      <div style={{ padding: pad ? '16px 18px' : 0 }}>{children}</div>
    </div>
  )
}

function HStat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: Tone }) {
  return (
    <div>
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 10,
          color: T.fgFaint,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 16,
          fontWeight: 600,
          marginTop: 3,
          color: tone ? toneColor(T, tone).fg : T.fg,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function HWrap({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>
}

function eyebrow(label: ReactNode) {
  return (
    <span
      style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint, textTransform: 'uppercase', letterSpacing: '0.1em' }}
    >
      {label}
    </span>
  )
}

// ── injection (v2): the shared authoring/assembly hero ───────────────────────
// prompt · context · injectable all assemble from injected pieces. The hero
// shows what they inject (grouped by certainty) and the tools that flow into
// scope (own + injected), plus — for an injectable — what it may contribute.
function HeroSub({ label, count }: { label: ReactNode; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 9px' }}>
      <span
        style={{
          fontFamily: T.mono,
          fontSize: 10,
          color: T.fgFaint,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
        }}
      >
        {label}
      </span>
      {count != null && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>{count}</span>}
      <div style={{ flex: 1, height: 1, background: T.border }} />
    </div>
  )
}

// one injected entry as a node chip — links to the resolved definition, or
// renders a muted "unresolved" node when the reference isn't in the index.
function InjectEntry({ entry, showTag }: { entry: UseEntry; showTag?: boolean }) {
  const idx = useIndexIndex()
  const select = useIndexSelect()
  const d = entry.targetDefinitionId
    ? idx.byId(entry.targetDefinitionId)
    : entry.variable
      ? idx.resolve(entry.variable)
      : undefined
  const kind = d ? d.kind : (entry.targetKind ?? INJECT_REL_KIND[entry.relationHint ?? 'unknown'] ?? 'unknown')
  const dynamic = injectGroupOf(entry.conditionality) === 'dynamic'
  const c = toneColor(T, kindMeta(kind).tone)
  const label = d ? d.name : (entry.targetName ?? entry.variable ?? '—')
  const sub = injectionEntrySubtitle(entry, d, kind)
  const onClick = d ? () => select(d.id) : undefined
  const baseStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 11px',
    borderRadius: 9,
    minWidth: 0,
    background: T.bgElev,
    border: dynamic ? `1px dashed ${T.borderStrong ?? T.border}` : `1px solid ${c.line}`,
  } as const
  const inner = (
    <>
      <KindGlyph kind={kind} size={22} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 12,
            fontWeight: 600,
            color: d ? T.fg : T.fgMuted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}>{sub}</div>
      </div>
      {showTag && <InjectTag conditionality={entry.conditionality} branch={entry.branch} showBranch size="xs" />}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Open ${label}`}
        style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', ...baseStyle }}
      >
        {inner}
      </button>
    )
  }
  return <div style={baseStyle}>{inner}</div>
}

function injectionEntrySubtitle(entry: UseEntry, definition: ViewDef | undefined, kind: string): string {
  const kindLabel =
    entry.relationHint && entry.relationHint !== 'unknown' ? entry.relationHint : kindMeta(kind).label.toLowerCase()
  const runtime = entry.via === 'runtime'
  if (definition) return runtime ? `${kindLabel} · prepared at runtime` : kindLabel
  if (entry.targetDefinitionId) return runtime ? 'external · prepared at runtime' : 'external'
  return runtime ? 'unresolved · prepared at runtime' : 'unresolved reference'
}

// the grouped assembly view — always · conditional · dynamic.
function InjectionLanes({ entries }: { entries: UseEntry[] }) {
  const groups: Record<InjectGroup, UseEntry[]> = { always: [], conditional: [], dynamic: [] }
  entries.forEach((e) => groups[injectGroupOf(e.conditionality ?? 'always')].push(e))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {INJECT_GROUPS.filter((g) => groups[g.id].length).map((g) => {
        const c = toneColor(T, g.tone)
        const dashed = g.id === 'dynamic'
        return (
          <div key={g.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 99,
                  background: dashed ? 'transparent' : c.fg,
                  boxShadow: dashed ? `inset 0 0 0 1px ${T.fgFaint}` : 'none',
                }}
              />
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: dashed ? T.fgMuted : c.fg,
                }}
              >
                {g.label}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>{groups[g.id].length}</span>
              <span style={{ fontSize: 11, color: T.fgFaint }}>· {g.note}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {groups[g.id].map((e, i) => (
                <InjectEntry key={(e.variable ?? 'e') + i} entry={e} showTag={g.id !== 'always'} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// the tool surface (own + injected), tagged by source.
interface ToolSurfaceEntry {
  name?: string
  dynamic?: boolean
  direct?: boolean
  source?: string
  conditionality?: string
  branch?: string
}

function toolSurface(def: ViewDef, entries: UseEntry[], idx: IndexIndex): ToolSurfaceEntry[] {
  const out: ToolSurfaceEntry[] = []
  const ownT = def.facts?.tools
  if (ownT?.hasTools) {
    if (ownT.dynamic && !(ownT.names ?? []).length) out.push({ dynamic: true, direct: true })
    ;(ownT.names ?? []).forEach((n) => out.push({ name: n, direct: true }))
  }
  entries.forEach((e) => {
    const d = e.targetDefinitionId ? idx.byId(e.targetDefinitionId) : e.variable ? idx.resolve(e.variable) : undefined
    const tf = d?.facts?.tools
    if (!tf?.hasTools) return
    if (tf.dynamic && !(tf.names ?? []).length)
      out.push({ dynamic: true, source: d!.name, conditionality: e.conditionality, branch: e.branch })
    ;(tf.names ?? []).forEach((n) =>
      out.push({ name: n, source: d!.name, conditionality: e.conditionality, branch: e.branch }),
    )
  })
  return out
}

function ToolSurface({ tools }: { tools: ToolSurfaceEntry[] }) {
  if (!tools.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {tools.map((tl, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 9px',
            borderRadius: 8,
            background: T.bgElev,
            border: tl.dynamic ? `1px dashed ${T.borderStrong ?? T.border}` : `1px solid ${T.border}`,
          }}
        >
          {tl.dynamic ? <CatIcon name="tool" size={13} color={T.fgMuted} /> : <KindGlyph kind="tool" size={20} />}
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: tl.dynamic ? T.fgMuted : T.fg }}>
            {tl.dynamic ? 'dynamic · names unknown' : tl.name}
          </span>
          {tl.direct ? (
            <span
              style={{
                fontFamily: T.mono,
                fontSize: 9,
                color: T.fgFaint,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              declared
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}>via {tl.source}</span>
              <InjectTag conditionality={tl.conditionality} size="xs" />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// the shared authoring/assembly hero (prompt · context · injectable).
function AuthoringHero({ def }: { def: ViewDef }) {
  const idx = useIndexIndex()
  const f = def.facts ?? {}
  const k = def.kind
  const entries: UseEntry[] =
    f.useEntries ??
    (f.use ?? []).map((id) => ({
      variable: id,
      relationHint: 'context' as const,
      conditionality: 'always' as const,
      via: 'direct' as const,
    }))
  const tools = toolSurface(def, entries, idx)
  const title = k === 'prompt' ? 'Prompt assembly' : k === 'injectable' ? 'Injectable' : 'Context assembly'
  const may = f.mayInject ?? []
  const right = (
    <HWrap>
      {k === 'prompt' && f.hasSystem && (
        <Chip tone="iris" mono>
          system
        </Chip>
      )}
      {k === 'prompt' && f.hasMessages && (
        <Chip tone="iris" mono>
          messages
        </Chip>
      )}
      {k === 'context' && (
        <Chip tone="iris" mono>
          {f.isStatic ? 'static' : 'dynamic'}
        </Chip>
      )}
      {f.priority != null && (
        <Chip tone="muted" mono>
          priority {f.priority}
        </Chip>
      )}
    </HWrap>
  )
  return (
    <HeroFrame title={title} tone="iris" right={right}>
      {/* injectable capability summary — what this is allowed to contribute */}
      {k === 'injectable' && may.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <HeroSub label="May inject" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {may.map((cap) => (
              <span
                key={cap}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 6,
                  background: T.irisSoft,
                  color: T.iris,
                  boxShadow: `inset 0 0 0 1px ${T.irisLine ?? T.irisSoft}`,
                  fontFamily: T.mono,
                  fontSize: 11,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: 99, background: T.iris }} />
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* what it injects, grouped by certainty */}
      <HeroSub label="Injects" count={entries.length} />
      {entries.length ? (
        <InjectionLanes entries={entries} />
      ) : (
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgFaint }}>self-contained · injects nothing</span>
      )}

      {/* tools brought into scope — own + injected, in one place */}
      {tools.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <HeroSub label="Tools in scope" count={tools.length} />
          <ToolSurface tools={tools} />
        </div>
      )}
    </HeroFrame>
  )
}

// ── the hero switch ──────────────────────────────────────────────────────────
export function IndexHero({ def }: { def: ViewDef }) {
  const idx = useIndexIndex()
  const select = useIndexSelect()
  const f = def.facts ?? {}
  const kids = idx.childrenOf(def.id)
  const rels = idx.relationsOf(def.id)
  const k = def.kind
  // Resolve references (which may be bare names, not ids) to definitions.
  const lookup = (ref: string) => idx.resolve(ref)
  // Returns a click handler only when the ref resolves to a real definition,
  // navigating by the *resolved* id (so name-based refs work too). Unresolved
  // references — e.g. built-in/external contexts not in the index — stay
  // non-clickable.
  const navTo = (ref?: string): (() => void) | undefined => {
    if (!ref) return undefined
    const d = idx.resolve(ref)
    return d ? () => select(d.id) : undefined
  }
  // A reference card for a bare-name ref: links to the resolved definition, or
  // renders a quiet "external" node (dimmed + tooltip) when the ref isn't a
  // index definition (built-in/external).
  const refNode = (ref: string, fallbackKind: string, sub?: ReactNode) => {
    const d = idx.resolve(ref)
    return (
      <HNode
        key={ref}
        kind={d ? d.kind : fallbackKind}
        label={ref}
        sub={sub}
        onClick={d ? () => select(d.id) : undefined}
        external={!d}
      />
    )
  }

  // AGENT — the loop
  if (k === 'agent') {
    const tools = f.toolNames ?? []
    const handoffs = f.handoffs ?? []
    return (
      <HeroFrame
        title="Agent loop"
        tone="crux"
        right={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>prompt → tools → handoff</span>}
      >
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {eyebrow('system prompt')}
            {f.promptId ? (
              refNode(f.promptId, 'prompt')
            ) : (
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>—</span>
            )}
          </div>
          <HArrow />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 180 }}>
            {eyebrow(`tools · ${tools.length}`)}
            <HWrap>
              {tools.length ? (
                tools.map((tn) => refNode(tn, 'tool'))
              ) : (
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>no tools</span>
              )}
            </HWrap>
          </div>
          <HArrow />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
            {eyebrow(`handoffs · ${handoffs.length}`)}
            <HWrap>
              {handoffs.length ? (
                handoffs.map((h) => refNode(h, 'agent'))
              ) : (
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>terminal</span>
              )}
            </HWrap>
          </div>
        </div>
      </HeroFrame>
    )
  }

  // FLOW — ordered step chain with suspension
  if (k === 'flow') {
    const steps = kids.slice().sort((a, b) => (a.presentation?.order ?? 0) - (b.presentation?.order ?? 0))
    return (
      <HeroFrame
        title="Control flow"
        tone="blue"
        right={
          <HWrap>
            <Chip tone="muted" mono>
              {f.runtime ?? 'node'}
            </Chip>
            {steps.some((s) => s.facts?.suspends) && (
              <Chip tone="warn" dot>
                suspends
              </Chip>
            )}
          </HWrap>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {steps.map((s, i) => {
            const target = s.facts?.targetDefinitionId ? lookup(s.facts.targetDefinitionId) : null
            const susp = s.facts?.suspends
            return (
              <Fragment key={s.id}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: susp ? T.warnSoft : T.bgElev,
                    border: `1px solid ${susp ? T.warnSoft : T.blueLine}`,
                    minWidth: 120,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}>
                      {String(i).padStart(2, '0')}
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: susp ? T.warn : T.fg }}>
                      {s.name}
                    </span>
                    {susp && <Icon name="clock" size={12} color={T.warn} />}
                  </div>
                  {target ? (
                    <button
                      type="button"
                      onClick={navTo(target.id)}
                      title={`Open ${target.name}`}
                      style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <KindGlyph kind={target.kind} size={18} />
                      <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgMuted }}>{target.name}</span>
                    </button>
                  ) : susp ? (
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.warn }}>awaits signal</span>
                  ) : (
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>—</span>
                  )}
                </div>
                {i < steps.length - 1 && <HArrow />}
              </Fragment>
            )
          })}
        </div>
      </HeroFrame>
    )
  }

  // SWARM
  if (k === 'composition.swarm') {
    const parts = f.participants ?? []
    return (
      <HeroFrame
        title="Swarm topology"
        tone="blue"
        right={
          <Chip tone="plum" mono>
            board · {f.sharedBlackboard ?? '—'}
          </Chip>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {eyebrow('coordinator')}
            {f.coordinator ? refNode(f.coordinator, 'agent') : <HNode kind="agent" label="—" tone="crux" />}
          </div>
          <HArrow />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            {eyebrow(`participants · ${parts.length}`)}
            <HWrap>{[...new Set(parts)].map((p) => refNode(p, 'agent'))}</HWrap>
          </div>
        </div>
      </HeroFrame>
    )
  }

  // CONSENSUS / PARALLEL / PIPELINE
  if (k === 'composition.consensus' || k === 'composition.parallel' || k === 'composition.pipeline') {
    const parts = f.participants ?? []
    const ordered = k === 'composition.pipeline'
    return (
      <HeroFrame
        title={ordered ? 'Pipeline stages' : k === 'composition.consensus' ? 'Consensus' : 'Parallel branches'}
        tone="blue"
        right={
          f.judge ? (
            <Chip tone="gold" mono>
              judge · {f.judge}
            </Chip>
          ) : null
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {parts.map((p, i) => (
            <Fragment key={p + i}>
              {refNode(
                p,
                'agent',
                ordered ? `stage ${i}` : k === 'composition.consensus' ? `voter ${i + 1}` : `branch ${i}`,
              )}
              {ordered && i < parts.length - 1 && <HArrow />}
            </Fragment>
          ))}
        </div>
        {k === 'composition.consensus' && !f.judge && (
          <div style={{ marginTop: 12, fontFamily: T.mono, fontSize: 11, color: T.warn }}>
            ⚠ no judge — ties resolve silently
          </div>
        )}
      </HeroFrame>
    )
  }

  // ROUTER
  if (k === 'routing.router') {
    const routes = kids.slice().sort((a, b) => (a.presentation?.order ?? 0) - (b.presentation?.order ?? 0))
    return (
      <HeroFrame
        title="Routes"
        tone="warn"
        right={
          <HWrap>
            <Chip tone="muted" mono>
              {f.routeCount} routes
            </Chip>
            {f.hasClassify && (
              <Chip tone="warn" mono>
                classify
              </Chip>
            )}
            {!f.hasDefaultRoute && (
              <Chip tone="danger" dot>
                no default
              </Chip>
            )}
          </HWrap>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {routes.map((r) => {
            const target = r.facts?.targetDefinitionId ? lookup(r.facts.targetDefinitionId) : null
            return (
              <div
                key={r.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 24px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: 9,
                  background: T.bgElev,
                  border: `1px solid ${T.border}`,
                }}
              >
                <span style={{ fontFamily: T.mono, fontSize: 12, color: T.warn, fontWeight: 600 }}>
                  {r.facts?.routeKey || r.name}
                </span>
                <Icon name="arrowRight" size={14} color={T.fgFaint} />
                {target ? (
                  <HNode kind={target.kind} label={target.name} onClick={navTo(target.id)} />
                ) : (
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgMuted }}>
                    {r.facts?.targetVariable ?? '—'}
                  </span>
                )}
                {r.facts?.isDefault && (
                  <Chip tone="warn" mono>
                    default
                  </Chip>
                )}
              </div>
            )
          })}
        </div>
      </HeroFrame>
    )
  }

  // CASCADE
  if (k === 'routing.cascade') {
    const tiers = kids.slice().sort((a, b) => (a.facts?.tierIndex ?? 0) - (b.facts?.tierIndex ?? 0))
    return (
      <HeroFrame
        title="Escalation ladder"
        tone="warn"
        right={
          f.hasBudget ? (
            <Chip tone="gold" mono>
              budget · ${f.budget?.maxCostUsd}
            </Chip>
          ) : null
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {tiers.map((tier, i) => (
            <Fragment key={tier.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 9,
                  background: T.bgElev,
                  border: `1px solid ${T.border}`,
                  marginLeft: i * 18,
                }}
              >
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>
                  tier {tier.facts?.tierIndex ?? i}
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600 }}>{tier.name}</span>
                {tier.facts?.hasEvaluate && (
                  <Chip tone="ok" mono>
                    evaluate ✓
                  </Chip>
                )}
              </div>
              {i < tiers.length - 1 && (
                <span
                  style={{
                    marginLeft: i * 18 + 18,
                    fontFamily: T.mono,
                    fontSize: 10,
                    color: T.fgFaint,
                    padding: '2px 0',
                  }}
                >
                  ↳ on reject, escalate
                </span>
              )}
            </Fragment>
          ))}
        </div>
      </HeroFrame>
    )
  }

  // RAG pipeline
  if (k === 'rag.pipeline') {
    const ret = rels.outgoing.find((r) => r.type === 'rag.pipeline.uses_retriever')
    return (
      <HeroFrame
        title="Retrieval pipeline"
        tone="ok"
        right={
          <Chip tone="muted" mono>
            topK · {f.topK}
          </Chip>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {['embed', 'search', 'rerank', 'assemble'].map((stage, i, a) => (
            <Fragment key={stage}>
              <HNode label={stage} tone="ok" />
              {i < a.length - 1 && <HArrow />}
            </Fragment>
          ))}
          {ret && (
            <>
              <span style={{ width: 1, height: 24, background: T.border, margin: '0 6px' }} />
              <HNode kind="rag.retriever" label={ret.to} onClick={navTo(ret.to)} />
            </>
          )}
        </div>
      </HeroFrame>
    )
  }

  // MEMORY / BLACKBOARD
  if (k === 'memory' || k === 'blackboard') {
    const blocks = kids.filter((c) => c.kind === 'memory.block')
    const store = kids.find((c) => c.kind === 'memory.store')
    return (
      <HeroFrame
        title={k === 'blackboard' ? 'Shared board' : 'Memory store'}
        tone="plum"
        right={
          <HWrap>
            <Chip tone="muted" mono>
              {f.backend}
            </Chip>
            {f.conflictPolicy ? (
              <Chip tone="plum" mono>
                {f.conflictPolicy}
              </Chip>
            ) : (
              <Chip tone="warn" dot>
                no policy
              </Chip>
            )}
            {f.evictionPolicy ? (
              <Chip tone="plum" mono>
                evict · {f.evictionPolicy}
              </Chip>
            ) : k === 'memory' ? (
              <Chip tone="warn" dot>
                no retention
              </Chip>
            ) : null}
          </HWrap>
        }
      >
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {store && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {eyebrow('store')}
              <HNode kind="memory.store" label={store.name} onClick={navTo(store.id)} />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            {eyebrow(`blocks · ${f.blockCount ?? blocks.length}`)}
            <HWrap>
              {blocks.length ? (
                blocks.map((b) => (
                  <HNode key={b.id} kind="memory.block" label={b.name} sub={b.facts?.blockKind} onClick={navTo(b.id)} />
                ))
              ) : (
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>—</span>
              )}
            </HWrap>
          </div>
        </div>
      </HeroFrame>
    )
  }

  // WORKSPACE
  if (k === 'workspace') {
    return (
      <HeroFrame
        title="Workspace mounts"
        tone="plum"
        right={
          <HWrap>
            {f.hasTools && (
              <Chip tone="plum" mono>
                has tools
              </Chip>
            )}
          </HWrap>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(f.mounts ?? []).map((mnt) => (
            <div
              key={mnt.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 9,
                background: T.bgElev,
                border: `1px solid ${T.border}`,
              }}
            >
              <Icon name="folder" size={14} color={T.plum} />
              <span style={{ fontFamily: T.mono, fontSize: 12, color: T.fg }}>{mnt.path}</span>
              {mnt.mode && (
                <Chip tone={mnt.mode === 'rw' || mnt.mode === 'read-write' ? 'warn' : 'muted'} mono>
                  {mnt.mode}
                </Chip>
              )}
              {f.namespace && (
                <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint, marginLeft: 'auto' }}>
                  namespace · {f.namespace}
                </span>
              )}
            </div>
          ))}
        </div>
      </HeroFrame>
    )
  }

  // GUARDRAIL / CONSTRAINT
  if (k === 'guardrail' || k === 'constraint') {
    // `appliesTo` may arrive as facts, top-level metadata (lifted by the
    // adapter), or only as `*.applies_to` relations — union all three.
    const relApplies = [...rels.outgoing, ...rels.incoming]
      .filter((r) => /applies_to/.test(r.type))
      .map((r) => (r.from === def.id ? r.to : r.from))
    let applies = [...new Set([...(f.appliesTo ?? []), ...relApplies])]
    // When the guardrail doesn't self-declare targets, fall back to its
    // consumers — anything that references it is what it guards.
    if (applies.length === 0) {
      applies = [...new Set(rels.incoming.map((r) => r.from))]
    }
    return (
      <HeroFrame
        title={k === 'guardrail' ? 'Guardrail policy' : 'Constraint'}
        tone="danger"
        right={
          <HWrap>
            {f.policy && (
              <Chip tone="danger" mono>
                {f.policy}
              </Chip>
            )}
            {f.severity && (
              <Chip tone="muted" mono>
                {f.severity}
              </Chip>
            )}
          </HWrap>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {eyebrow(`applies to · ${applies.length}`)}
          {applies.length ? (
            <HWrap>{applies.map((a) => refNode(a, 'tool'))}</HWrap>
          ) : (
            <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
              No targets captured — this {k === 'guardrail' ? 'guardrail' : 'constraint'} isn’t wired to a tool, agent
              or workspace the indexer can resolve.
            </span>
          )}
        </div>
      </HeroFrame>
    )
  }

  // SCORER
  if (k === 'scorer') {
    const hasScale = f.scaleMin != null || f.scaleMax != null
    const hasShape =
      f.hasRubric === true || f.hasDetailSchema === true || f.chainOfThought != null || Boolean(f.criteriaPreview)
    const hasConfig = f.model != null || f.threshold != null || hasScale || hasShape
    // Threshold may be on the authored scale (e.g. 1–5), not 0–1 — scale the bar.
    const thresholdMax = f.scaleMax ?? 1
    return (
      <HeroFrame
        title="Scorer"
        tone="gold"
        right={
          hasConfig ? (
            <HWrap>
              {f.hasRubric === true && (
                <Chip tone="gold" mono>
                  rubric
                </Chip>
              )}
              {f.hasDetailSchema === true && (
                <Chip tone="gold" mono>
                  detail schema
                </Chip>
              )}
              {f.chainOfThought != null && (
                <Chip tone={f.chainOfThought ? 'gold' : 'muted'} mono>
                  {f.chainOfThought ? 'chain of thought' : 'no CoT'}
                </Chip>
              )}
            </HWrap>
          ) : null
        }
      >
        {hasConfig ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 34, alignItems: 'center', flexWrap: 'wrap' }}>
              {f.model && <HStat label="Model" value={f.model} />}
              {f.threshold != null && <HStat label="Threshold" value={f.threshold} tone="gold" />}
              {hasScale && <HStat label="Scale" value={`${f.scaleMin ?? '?'}–${f.scaleMax ?? '?'}`} />}
              {f.threshold != null && (
                <div style={{ flex: 1, minWidth: 180, maxWidth: 280 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint, marginBottom: 6 }}>
                    accept ≥ {f.threshold}
                  </div>
                  <Bar value={f.threshold} max={thresholdMax} tone="gold" height={8} />
                </div>
              )}
            </div>
            {f.criteriaPreview && (
              <div style={{ fontFamily: T.serif, fontSize: 12.5, lineHeight: 1.55, color: T.fgMuted, maxWidth: 760 }}>
                {f.criteriaPreview}
              </div>
            )}
          </div>
        ) : (
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
            Scorer config not captured — authored model, threshold, scale, rubric, or detail schema appear here once the
            indexer resolves them.
          </span>
        )}
      </HeroFrame>
    )
  }

  // DATASET / SUITE
  if (k === 'dataset' || k === 'suite') {
    const cases = kids.filter((c) => c.kind === 'suite.case')
    return (
      <HeroFrame
        title={k === 'suite' ? 'Suite' : 'Dataset'}
        tone="gold"
        right={
          <HWrap>
            <Chip tone="gold" mono>
              {f.caseCount ?? cases.length} cases
            </Chip>
            {(f.scorerIds ?? []).map((s) => (
              <KindBadge key={s} kind="scorer" label={s} />
            ))}
          </HWrap>
        }
      >
        {cases.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cases.map((cs) => (
              <HNode key={cs.id} kind="suite.case" label={cs.name} onClick={navTo(cs.id)} />
            ))}
            {f.caseCount != null && f.caseCount > cases.length && (
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint, paddingLeft: 4 }}>
                +{f.caseCount - cases.length} more cases
              </span>
            )}
          </div>
        ) : f.caseCount ? (
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
            {f.caseCount} case{f.caseCount === 1 ? '' : 's'} declared · per-case results come from the suite’s runs.
          </span>
        ) : (
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>No cases captured.</span>
        )}
      </HeroFrame>
    )
  }

  // EVAL.*
  if (k.startsWith('eval.')) {
    const target = f.targetDefinitionId ? lookup(f.targetDefinitionId) : null
    return (
      <HeroFrame
        title="Eval"
        tone="gold"
        right={(f.scorerIds ?? []).map((s) => (
          <KindBadge key={s} kind="scorer" label={s} />
        ))}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>covers</span>
          {target ? (
            <HNode kind={target.kind} label={target.name} onClick={navTo(target.id)} />
          ) : (
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgMuted }}>{f.targetDefinitionId ?? '—'}</span>
          )}
          {def.quality?.passRate != null && (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 80 }}>
                <Bar value={def.quality.passRate} tone={def.quality.passRate >= 0.9 ? 'ok' : 'crux'} />
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 600 }}>
                {Math.round(def.quality.passRate * 100)}%
              </span>
            </span>
          )}
        </div>
      </HeroFrame>
    )
  }

  // TOOL
  if (k === 'tool') {
    return (
      <HeroFrame
        title="Tool signature"
        tone="ok"
        right={
          <HWrap>
            {f.toolName && (
              <Chip tone="ok" mono>
                {f.toolName}
              </Chip>
            )}
            {f.approvalRequired && (
              <Chip tone="warn" dot>
                approval
              </Chip>
            )}
            {f.hasExecute && (
              <Chip tone="muted" mono>
                execute ✓
              </Chip>
            )}
          </HWrap>
        }
      >
        {def.lint.includes('tool.missing_input_schema') ? (
          <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.warn }}>
            ⚠ no input schema — arguments are not inspectable. Declare params to make call sites traceable.
          </div>
        ) : def.contract?.inputSchema ? (
          <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
            Input schema below · {def.contract.inputSchema.length} parameter
            {def.contract.inputSchema.length === 1 ? '' : 's'} in the typed contract.
          </div>
        ) : (
          <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
            Input schema renders here from <span style={{ color: T.fg }}>intelligence.contract.inputSchema</span> when
            captured.
          </div>
        )}
      </HeroFrame>
    )
  }

  // PROMPT / CONTEXT / INJECTABLE — the shared assembly hero
  if (k === 'prompt' || k === 'context' || k === 'injectable') {
    return <AuthoringHero def={def} />
  }

  // RETRIEVER
  if (k === 'rag.retriever') {
    return (
      <HeroFrame
        title="Retriever"
        tone="ok"
        right={
          <Chip tone="muted" mono>
            topK · {f.topK}
          </Chip>
        }
      >
        <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
          Vector retriever · index health, embedding model and query log appear here when captured.
        </div>
      </HeroFrame>
    )
  }

  // FALLBACK
  if (k === 'routing.fallback') {
    return (
      <HeroFrame
        title="Fallback options"
        tone="warn"
        right={
          <Chip tone="muted" mono>
            {f.optionCount} options
          </Chip>
        }
      >
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
          Tries each option in order until one succeeds.
        </span>
      </HeroFrame>
    )
  }

  return null
}
