/**
 * Index v2 — the observed-injection layer (the runtime/observed plane, laid
 * over authored truth on a definition's detail page).
 *
 * Ported from the design's `catalog-observed.jsx`. The authored plane
 * (`AuthoringHero` · `InjectionLanes` · `CatEffectiveInput`) answers *"what did
 * I build?"*; this answers *"did what I authored actually fire?"* — composed
 * from the observed-injection read model, consumed **per-definition**.
 *
 * Guiding decision (direction A — *quiet annotation*): authored (iris) stays
 * primary; observed (crux + trace) rides along as a one-line footnote, with the
 * full distribution behind a per-row expand and Branches / Tools behind
 * collapsibles. Runtime detail must never cost cognitive space up front.
 *
 * Cautions baked into the visuals (do not violate):
 *   · `checked ≠ dropped` — a false predicate / untaken branch is *checked*.
 *   · `unobserved ≠ impossible` — a case with no recent trace is "not seen",
 *     never "dead".
 *   · counts depend on the trace window — the window is always printed.
 *   · drift evidence is intentionally NOT surfaced (a Crux self-consistency
 *     signal, not user error — deferred).
 *   · KEY NAMES ONLY — the read model never records values.
 */

import { useState, type ReactNode } from 'react'
import { T, toneColor, type Tone } from './tokens'
import { CatIcon, Icon } from './icons'
import { SectionHead } from './primitives'
import {
  InjectStateBar,
  InjectStateChip,
  INJECT_STATE_ORDER,
  InjectTag,
  KindGlyph,
  dominantInjectState,
  kindMeta,
} from './kit'
import type {
  ContributeItem,
  ContributeResolution,
  InjectableContributions,
  ObservedInjection,
  ObservedSource,
  ViewDef,
} from './adapt'

// ── a small self-contained card (the observed layer is crux-toned) ───────────
function ObsCard({
  title,
  tone = 'crux',
  glyph,
  right,
  children,
}: {
  title: string
  tone?: Tone
  glyph?: string
  right?: ReactNode
  children: ReactNode
}) {
  const c = toneColor(T, tone)
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, background: T.bgElev, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 14px',
          borderBottom: `1px solid ${T.border}`,
          background: T.bg,
        }}
      >
        {glyph && <Icon name={glyph} size={13} color={c.fg} />}
        <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: c.fg, letterSpacing: '0.02em' }}>
          {title}
        </span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  )
}

function WindowNote({ window, runCount }: { window?: string; runCount?: number }) {
  const label = window ?? (runCount != null ? `last ${runCount} runs` : 'recent traces')
  return (
    <span
      title="Observed counts are scoped to this trace window — they are evidence, never authority."
      style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}
    >
      <Icon name="clock" size={10} color={T.fgFaint} style={{ verticalAlign: '-1px', marginRight: 4 }} />
      {label}
    </span>
  )
}

// ── runtime input contract — keys real calls passed (NAMES ONLY) ─────────────
function KeyChips({ keys, tone, glyph }: { keys: string[]; tone: Tone; glyph: string }) {
  const c = toneColor(T, tone)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {keys.map((k) => (
        <span
          key={k}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 4,
            fontFamily: T.mono,
            fontSize: 10.5,
            color: tone === 'muted' ? T.fgMuted : c.fg,
            background: tone === 'muted' ? T.bg : c.soft,
            boxShadow: `inset 0 0 0 1px ${tone === 'muted' ? T.border : c.line}`,
          }}
        >
          <Icon name={glyph} size={9} color={tone === 'muted' ? T.fgFaint : c.fg} />
          {k}
        </span>
      ))}
    </div>
  )
}

export function CatRuntimeInput({ observed }: { observed: ObservedInjection }) {
  const input = observed.input
  if (!input) return null
  const provided = input.provided ?? []
  const missing = input.missingRequired ?? []
  const unexpected = input.unexpected ?? []
  const passRate = input.validatePassRate
  const Group = ({ label, keys, tone, glyph }: { label: string; keys: string[]; tone: Tone; glyph: string }) => {
    if (!keys.length) return null
    return (
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 9.5,
            color: T.fgFaint,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: 5,
          }}
        >
          {label} · {keys.length}
        </div>
        <KeyChips keys={keys} tone={tone} glyph={glyph} />
      </div>
    )
  }
  return (
    <ObsCard
      title="Runtime input contract"
      glyph="inbox"
      right={<WindowNote window={observed.window} runCount={observed.runCount} />}
    >
      <p
        style={{
          margin: '0 0 12px',
          fontFamily: T.serif,
          fontSize: 12,
          lineHeight: 1.5,
          color: T.fgMuted,
          maxWidth: 560,
        }}
      >
        Which keys real calls actually passed, checked against the effective schema.{' '}
        <span style={{ color: T.fg }}>Key names only — values are never recorded.</span>
      </p>
      <Group label="provided" keys={provided} tone="muted" glyph="check" />
      <Group label="missing · required" keys={missing} tone="danger" glyph="alert" />
      <Group label="unexpected" keys={unexpected} tone="warn" glyph="info" />
      {passRate != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint, minWidth: 64 }}>validate</span>
          <span style={{ flex: 1, maxWidth: 160, display: 'inline-flex' }}>
            <span
              style={{
                flex: 1,
                height: 6,
                background: T.bgSubtle,
                borderRadius: 99,
                overflow: 'hidden',
                boxShadow: `inset 0 0 0 1px ${T.border}`,
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${Math.round(passRate * 100)}%`,
                  height: '100%',
                  background: toneColor(T, passRate >= 0.9 ? 'ok' : passRate >= 0.6 ? 'warn' : 'danger').fg,
                }}
              />
            </span>
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgMuted }}>
            {Math.round(passRate * 100)}% pass
            {input.validateCount != null ? ` · ${input.validateCount} calls` : ''}
          </span>
        </div>
      )}
    </ObsCard>
  )
}

// ── observed injection — one row per authored dependency ─────────────────────
function Collapsible({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: T.mono,
          fontSize: 10,
          color: T.fgMuted,
        }}
      >
        <Icon
          name="arrowDown"
          size={8}
          color={T.fgFaint}
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms' }}
        />
        {label}
        {count != null && <span style={{ color: T.fgFaint }}>· {count}</span>}
      </button>
      {open && <div style={{ marginTop: 6, paddingLeft: 14 }}>{children}</div>}
    </div>
  )
}

function ObservedSourceRow({ src }: { src: ObservedSource }) {
  const [open, setOpen] = useState(false)
  const counts = src.states ?? {}
  const total = INJECT_STATE_ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const dominant = dominantInjectState(counts)
  const c = toneColor(T, kindMeta(src.sourceKind ?? 'unknown').tone)
  const branches = src.branches ?? []
  const tools = src.tools ?? []
  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
      {/* authored dependency (iris/family) — primary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <KindGlyph kind={src.sourceKind ?? 'unknown'} size={20} />
        <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: c.fg }}>
          {src.sourceName ?? src.variable ?? src.sourceDefinitionId ?? 'unknown'}
        </span>
        {src.conditionality && <InjectTag conditionality={src.conditionality} branch={undefined} size="xs" />}
      </div>

      {/* observed footnote (crux + trace) — the quiet annotation */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          boxSizing: 'border-box',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          marginTop: 7,
        }}
      >
        <Icon name="trace" size={11} color={T.crux} style={{ flex: '0 0 auto' }} />
        <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint, flex: '0 0 auto' }}>observed</span>
        <span style={{ flex: 1, maxWidth: 180, display: 'inline-flex' }}>
          <InjectStateBar counts={counts} />
        </span>
        {total > 0 ? (
          <InjectStateChip state={dominant} count={counts[dominant]} size="xs" />
        ) : (
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>no traces in window</span>
        )}
        <Icon
          name="arrowDown"
          size={8}
          color={T.fgFaint}
          style={{
            marginLeft: 'auto',
            flex: '0 0 auto',
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform 120ms',
          }}
        />
      </button>

      {open && (
        <div style={{ marginTop: 8, paddingLeft: 20 }}>
          {/* full resolution-state distribution */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {INJECT_STATE_ORDER.filter((s) => counts[s]).map((s) => (
              <InjectStateChip key={s} state={s} count={counts[s]} size="xs" />
            ))}
          </div>

          {/* observed branches vs authored cases */}
          {branches.length > 0 && (
            <Collapsible label="Branches" count={branches.length}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {branches.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="branch" size={10} color={T.fgFaint} />
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: b.seen ? T.fg : T.fgFaint }}>
                      {b.label}
                    </span>
                    {b.isDefault && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.fgFaint }}>default</span>}
                    {b.seen ? (
                      <span style={{ fontFamily: T.mono, fontSize: 10, color: T.crux }}>
                        seen{b.count != null ? ` · ${b.count}` : ''}
                      </span>
                    ) : (
                      <span
                        title="No recent trace — not seen, but not impossible."
                        style={{
                          fontFamily: T.mono,
                          fontSize: 9.5,
                          color: T.fgMuted,
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: `1px dashed ${T.border}`,
                        }}
                      >
                        not seen
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Collapsible>
          )}

          {/* observed tools brought into scope */}
          {tools.length > 0 && (
            <Collapsible label="Tools" count={tools.length}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {tools.map((tl) => (
                  <span
                    key={tl.name}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 7px',
                      borderRadius: 4,
                      fontFamily: T.mono,
                      fontSize: 10.5,
                      color: T.fgMuted,
                      background: T.bg,
                      boxShadow: `inset 0 0 0 1px ${T.border}`,
                    }}
                  >
                    <CatIcon name="tool" size={9} color={toneColor(T, 'ok').fg} />
                    {tl.name}
                    {tl.count != null && <span style={{ color: T.fgFaint }}>· {tl.count}</span>}
                  </span>
                ))}
              </div>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  )
}

export function CatObservedInjection({ observed }: { observed: ObservedInjection }) {
  const sources = observed.sources ?? []
  if (!sources.length) return null
  return (
    <ObsCard
      title="Observed injection"
      glyph="trace"
      right={<WindowNote window={observed.window} runCount={observed.runCount} />}
    >
      <p
        style={{
          margin: '0 0 6px',
          fontFamily: T.serif,
          fontSize: 12,
          lineHeight: 1.5,
          color: T.fgMuted,
          maxWidth: 560,
        }}
      >
        Per authored dependency, what runs actually did with it.{' '}
        <span style={{ color: T.fg }}>checked ≠ dropped; unobserved ≠ impossible.</span>
      </p>
      {sources.map((src, i) => (
        <ObservedSourceRow key={src.sourceDefinitionId ?? src.variable ?? i} src={src} />
      ))}
    </ObsCard>
  )
}

// ── injectable "Contributes" ─────────────────────────────────────────────────
const RESOLUTION_META: Record<ContributeResolution, { tone: Tone; blurb: string }> = {
  static: { tone: 'ok', blurb: 'A literal value — resolved exactly.' },
  spread: { tone: 'blue', blurb: 'A known spread — members resolved, shape stable.' },
  dynamic: { tone: 'muted', blurb: 'Computed at runtime — could not be resolved statically.' },
}

function ResolutionTag({ resolution }: { resolution: ContributeResolution }) {
  const m = RESOLUTION_META[resolution] ?? RESOLUTION_META.dynamic
  const c = toneColor(T, m.tone)
  const dyn = resolution === 'dynamic'
  return (
    <span
      title={m.blurb}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        borderRadius: 4,
        fontFamily: T.mono,
        fontSize: 9,
        letterSpacing: '0.03em',
        color: dyn ? T.fgMuted : c.fg,
        background: dyn ? 'transparent' : c.soft,
        border: dyn ? `1px dashed ${T.border}` : `1px solid ${c.line}`,
      }}
    >
      {resolution}
    </span>
  )
}

function ContributeGroup({ label, items }: { label: string; items?: ContributeItem[] }) {
  if (!items || !items.length) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 9.5,
          color: T.fgFaint,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: 6,
        }}
      >
        {label} · {items.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <Icon name="tag" size={11} color={T.fgFaint} style={{ alignSelf: 'center' }} />
            <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.fg }}>{it.label}</span>
            <ResolutionTag resolution={it.resolution} />
            {it.detail && (
              <span style={{ fontFamily: T.serif, fontSize: 12, color: T.fgMuted, lineHeight: 1.4 }}>{it.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CatContributes({ contributions }: { contributions: InjectableContributions }) {
  return (
    <ObsCard title="Contributes" tone="iris" glyph="layers">
      <p
        style={{
          margin: '0 0 12px',
          fontFamily: T.serif,
          fontSize: 12,
          lineHeight: 1.5,
          color: T.fgMuted,
          maxWidth: 560,
        }}
      >
        The non-tool material this injectable folds in, each tagged by how reliably Crux could resolve it.
      </p>
      <ContributeGroup label="constraints" items={contributions.constraints} />
      <ContributeGroup label="guardrails" items={contributions.guardrails} />
      <ContributeGroup label="metadata" items={contributions.metadata} />
    </ObsCard>
  )
}

// ── drop-in detail sections (registered in INDEX_SECTION_COMP) ────────────────
// Each returns null without data, so it is inert for every other definition.
export function CatObservedSection({ def }: { def: ViewDef }) {
  const observed = def.observed
  if (!observed || (!observed.input && !(observed.sources && observed.sources.length))) return null
  return (
    <>
      <SectionHead
        eyebrow="Observed injection"
        right={<WindowNote window={observed.window} runCount={observed.runCount} />}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
        {observed.input && <CatRuntimeInput observed={observed} />}
        {observed.sources && observed.sources.length > 0 && <CatObservedInjection observed={observed} />}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}
        >
          <Icon name="info" size={10} color={T.fgFaint} />
          Observed evidence is a quiet annotation over authored truth — authored stays primary.
        </div>
      </div>
    </>
  )
}

export function CatContributesSection({ def }: { def: ViewDef }) {
  const contributions = def.contributions
  if (!contributions) return null
  return (
    <>
      <SectionHead eyebrow="Contributes" />
      <div style={{ marginBottom: 22 }}>
        <CatContributes contributions={contributions} />
      </div>
    </>
  )
}
