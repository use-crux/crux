/**
 * Index v2 — Health surfaces (research-grounded redesign).
 *
 * Ported from the original Index health prototype. Patterns lifted from the
 * best-in-class analogs:
 *   · SonarQube — lead with a verdict (quality gate); findings are a triageable,
 *     severity-led LIST with actions.
 *   · Backstage Tech Insights — Checks over Facts, surfaced as scorecards that
 *     report "how many checks pass", rolled up across the index.
 *
 * So Health is now (1) a per-definition SUMMARY verdict + progressive-disclosure
 * triage list (`IndexHealthSection`, the old stacked-card section is retired),
 * (2) an Index-level OVERVIEW scorecard (`IndexHealthOverview`), and (3) the
 * Index-wide findings list (`IndexHealthList`) that the Health screen mounts.
 *
 * Severity is the only saturated lint signal, and only the two that demand
 * action (error → danger, warning → warn). `info` is neutral (a hollow dot),
 * zero findings reads ok-green. Vocabulary atoms live in `kit.tsx`.
 *
 * See the Index health implementation handover.
 */

import { useState, type ReactNode } from 'react'
import { T, toneColor } from './tokens'
import { Icon } from './icons'
import { Btn, SectionHead } from './primitives'
import {
  Bar,
  KindBadge,
  LintExtBadge,
  LintFixKind,
  LintMetaTag,
  LintSevDot,
  lintSevMeta,
  type LintSeverity,
} from './kit'
import type { HealthFinding, ViewDef } from './adapt'
import { useIndexIndex } from './context'

const SEV_ORDER: Record<string, number> = { error: 3, warning: 2, info: 1 }

function byKind(list: readonly HealthFinding[], key: keyof HealthFinding): Record<string, number> {
  const m: Record<string, number> = {}
  for (const x of list) {
    const k = String(x[key])
    m[k] = (m[k] ?? 0) + 1
  }
  return m
}

// ── severity tally pill — a count led by the severity dot ────────────────────
function HealthTally({ counts }: { counts: Record<string, number> }) {
  const order: LintSeverity[] = ['error', 'warning', 'info']
  const shown = order.filter((s) => counts[s])
  if (!shown.length) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {shown.map((s) => {
        const m = lintSevMeta(s)
        const c = toneColor(T, m.tone)
        return (
          <span
            key={s}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: T.mono, fontSize: 12 }}
          >
            <LintSevDot severity={s} size={7} />
            <span style={{ color: m.solid ? c.fg : T.fgMuted, fontWeight: 600 }}>{counts[s]}</span>
            <span style={{ color: T.fgFaint }}>
              {m.label}
              {counts[s] > 1 && s !== 'info' ? 's' : ''}
            </span>
          </span>
        )
      })}
    </span>
  )
}

// ── the expanded detail of one finding ───────────────────────────────────────
function FindingDetail({ fnd }: { fnd: HealthFinding }) {
  const ev = fnd.evidence ?? []
  const paths = fnd.propagationPaths ?? []
  const Eyebrow = ({ children }: { children: ReactNode }) => (
    <div
      style={{
        fontFamily: T.mono,
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: T.fgFaint,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  )
  return (
    <div style={{ padding: '2px 14px 14px 32px' }}>
      <div style={{ fontSize: 12.5, color: T.fg, lineHeight: 1.5, marginBottom: 5 }}>{fnd.message}</div>
      <div style={{ fontFamily: T.serif, fontSize: 13, color: T.fgMuted, lineHeight: 1.55, marginBottom: 12 }}>
        {fnd.rationale}
      </div>
      {ev.length || paths.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: ev.length && paths.length ? '1fr 1fr' : '1fr',
            gap: 12,
            marginBottom: 12,
          }}
        >
          {ev.length ? (
            <div>
              <Eyebrow>evidence · why it fired</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {ev.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 8,
                      padding: '5px 9px',
                      background: T.bgElev,
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                    }}
                  >
                    <Icon name="search" size={11} color={T.fgFaint} style={{ marginTop: 2, flex: '0 0 auto' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.fgMuted }}>{e.location}</div>
                      <div style={{ fontSize: 11.5, color: T.fg, lineHeight: 1.4 }}>{e.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {paths.length ? (
            <div>
              <Eyebrow>propagation · where it spreads</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {paths.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      flexWrap: 'wrap',
                      padding: '5px 9px',
                      background: T.bgElev,
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                    }}
                  >
                    <KindBadge kind={p.fromKind} label={p.from} />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Icon name="arrowRight" size={12} color={T.fgFaint} />
                      <span style={{ fontFamily: T.mono, fontSize: 9, color: T.fgFaint }}>{p.rel}</span>
                    </span>
                    <KindBadge kind={p.toKind} label={p.to} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '8px 12px',
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 7,
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: T.fgFaint,
          }}
        >
          fix
        </span>
        {(fnd.fixes ?? []).map((fx, i) => (
          <LintFixKind key={i} kind={fx.kind} />
        ))}
        <span style={{ fontSize: 12, color: T.fg }}>{fnd.fix}</span>
        {fnd.suppressedBy?.reason ? (
          <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>
            suppressed · {fnd.suppressedBy.reason}
          </span>
        ) : fnd.suppression?.directive ? (
          <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>
            {fnd.suppression.directive}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ── one collapsible finding row (per-definition triage list item) ────────────
function FindingRow({
  fnd,
  isDirect,
  open,
  onToggle,
}: {
  fnd: HealthFinding
  isDirect: boolean
  open: boolean
  onToggle: () => void
}) {
  const sup = fnd.suppressed
  return (
    <div style={{ borderBottom: `1px solid ${T.border}`, opacity: sup ? 0.55 : 1 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          all: 'unset',
          cursor: 'pointer',
          boxSizing: 'border-box',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '10px 14px',
        }}
      >
        <Icon
          name="arrowDown"
          size={9}
          color={T.fgFaint}
          style={{
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform 120ms',
            flex: '0 0 auto',
            marginTop: open ? 4 : 0,
            alignSelf: open ? 'flex-start' : 'center',
          }}
        />
        <LintSevDot severity={fnd.severity} size={8} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: sup ? T.fgMuted : T.fg,
            textDecoration: sup ? 'line-through' : 'none',
            whiteSpace: open ? 'normal' : 'nowrap',
            overflow: open ? 'visible' : 'hidden',
            textOverflow: 'ellipsis',
            flex: '1 1 auto',
            minWidth: 0,
            lineHeight: 1.35,
          }}
        >
          {fnd.title}
        </span>
        <LintMetaTag tone={fnd.category === 'safety' ? 'danger' : undefined}>{fnd.category}</LintMetaTag>
        {fnd.source === 'extension' ? <LintExtBadge extension={fnd.extension} /> : null}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          {!isDirect && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: T.mono,
                fontSize: 10,
                color: T.fgFaint,
              }}
            >
              via <KindBadge kind={fnd.primaryKind} label={fnd.primaryDefinitionId ?? '—'} />
            </span>
          )}
          {!open && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {(fnd.fixes ?? []).slice(0, 1).map((fx, i) => (
                <LintFixKind key={i} kind={fx.kind} />
              ))}
            </span>
          )}
        </span>
      </button>
      {open && <FindingDetail fnd={fnd} />}
    </div>
  )
}

// ── per-definition Health: summary verdict + triage list ─────────────────────
// Wired into the detail page via `INDEX_SECTION_COMP.health`.
export function IndexHealthSection({ def, startOpen = true }: { def: ViewDef; startOpen?: boolean }) {
  const idx = useIndexIndex()
  const lints = idx.healthForDef(def.id)
  const direct = lints.filter((f) => f.primaryDefinitionId === def.id)
  const transitive = lints.filter((f) => f.primaryDefinitionId !== def.id)

  const sorted = [...lints].sort((a, b) => {
    const da = a.primaryDefinitionId === def.id ? 1 : 0
    const db = b.primaryDefinitionId === def.id ? 1 : 0
    if (da !== db) return db - da // direct before transitive
    return (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0) // then severity desc
  })
  const counts = byKind(lints, 'severity')
  const ruleCount = Object.keys(byKind(lints, 'ruleId')).length
  const [open, setOpen] = useState<Set<string>>(() => new Set(startOpen && sorted[0] ? [sorted[0].id] : []))
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // clean verdict — Backstage/SonarQube both surface "passing", not silence.
  if (!direct.length && !transitive.length) {
    return (
      <>
        <SectionHead
          eyebrow="Health"
          right={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>all checks pass</span>}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '13px 16px',
            background: T.okSoft,
            border: `1px solid ${T.okSoft}`,
            borderRadius: 10,
            marginBottom: 22,
          }}
        >
          <Icon name="check" size={15} color={T.ok} />
          <span style={{ fontSize: 13, color: T.fg, fontWeight: 600 }}>Clean</span>
          <span style={{ fontSize: 12.5, color: T.fgMuted }}>
            No findings — every applicable rule passes on this definition.
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <SectionHead
        eyebrow="Health"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {direct.length} direct · {transitive.length} via deps
          </span>
        }
      />
      {/* summary verdict bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '11px 16px',
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          marginBottom: 10,
        }}
      >
        <HealthTally counts={counts} />
        <span style={{ width: 1, height: 16, background: T.border }} />
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
          {lints.length} finding{lints.length > 1 ? 's' : ''} across {ruleCount} rule{ruleCount > 1 ? 's' : ''}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <Btn size="xs" icon="github" variant="outline" disabled title="Opening source files isn’t available yet">
            Open in editor
          </Btn>
        </span>
      </div>
      {/* triage list — progressive disclosure */}
      <div
        style={{
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 22,
        }}
      >
        {sorted.map((fnd) => (
          <FindingRow
            key={fnd.id}
            fnd={fnd}
            isDirect={fnd.primaryDefinitionId === def.id}
            open={open.has(fnd.id)}
            onToggle={() => toggle(fnd.id)}
          />
        ))}
      </div>
    </>
  )
}

// ── Index-level Health overview scorecard ────────────────────────────────────
export function IndexHealthOverview() {
  const idx = useIndexIndex()
  const all = idx.healthFindings.filter((f) => !f.suppressed)
  const rules = idx.ruleDescriptors
  const bySev = byKind(all, 'severity')
  const byCat = byKind(all, 'category')

  // most-affected definitions
  const byDef: Record<string, { id: string; kind: string; items: HealthFinding[] }> = {}
  for (const f of all) {
    const id = f.primaryDefinitionId ?? '—'
    if (!byDef[id]) byDef[id] = { id, kind: f.primaryKind, items: [] }
    byDef[id].items.push(f)
  }
  const affected = Object.values(byDef)
    .map((d) => ({
      ...d,
      count: d.items.length,
      max: [...d.items.map((f) => f.severity)].sort((a, b) => (SEV_ORDER[b] ?? 0) - (SEV_ORDER[a] ?? 0))[0] ?? 'info',
    }))
    .sort((a, b) => b.count - a.count || (SEV_ORDER[b.max] ?? 0) - (SEV_ORDER[a.max] ?? 0))
    .slice(0, 6)

  const catList = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])
  const catMax = Math.max(1, ...catList.map((c) => byCat[c]))

  const Big = ({ severity, n }: { severity: LintSeverity; n: number }) => {
    const m = lintSevMeta(severity)
    const c = toneColor(T, m.tone)
    const numColor = n === 0 ? T.fgFaint : m.solid ? c.fg : T.fg
    return (
      <div
        style={{
          flex: 1,
          padding: '14px 16px',
          background: T.bgElev,
          border: `1px solid ${n > 0 && m.solid ? c.line : T.border}`,
          borderRadius: 11,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          <LintSevDot severity={severity} />
          <span
            style={{
              fontFamily: T.mono,
              fontSize: 11,
              color: T.fgFaint,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {m.label}
            {n === 1 || severity === 'info' ? '' : 's'}
          </span>
        </div>
        <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em', color: numColor }}>{n}</div>
      </div>
    )
  }

  return (
    <div style={{ background: T.bg, color: T.fg, fontFamily: T.sans }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Index health</h2>
        <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>
          {all.length} finding{all.length === 1 ? '' : 's'} · {rules.length} rule{rules.length === 1 ? '' : 's'} firing
        </span>
      </div>
      {/* verdict row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Big severity="error" n={bySev.error || 0} />
        <Big severity="warning" n={bySev.warning || 0} />
        <Big severity="info" n={bySev.info || 0} />
        {/* rules-firing card — until the backend ships descriptors for
            zero-finding rules too, we report rules firing, not passing. */}
        <div
          style={{
            flex: 1.4,
            padding: '14px 16px',
            background: T.bgElev,
            border: `1px solid ${T.border}`,
            borderRadius: 11,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span
              style={{
                fontFamily: T.mono,
                fontSize: 11,
                color: T.fgFaint,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              rules firing
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 12, color: rules.length ? T.warn : T.ok }}>
              {rules.length}
            </span>
          </div>
          <Bar value={rules.length} max={Math.max(1, rules.length)} tone={rules.length ? 'warn' : 'ok'} height={8} />
          <div style={{ marginTop: 8, fontSize: 11.5, color: T.fgMuted }}>
            {rules.length
              ? `${rules.length} distinct rule${rules.length === 1 ? '' : 's'} matched`
              : 'no rules matched — clean'}
          </div>
        </div>
      </div>
      {/* two columns: by category · most-affected */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ padding: '14px 16px', background: T.bgElev, border: `1px solid ${T.border}`, borderRadius: 11 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>Findings by category</div>
          {catList.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {catList.map((cat) => (
                <div
                  key={cat}
                  style={{ display: 'grid', gridTemplateColumns: '110px 1fr 22px', gap: 10, alignItems: 'center' }}
                >
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: cat === 'safety' ? T.danger : T.fgMuted }}>
                    {cat}
                  </span>
                  <Bar value={byCat[cat]} max={catMax} tone={cat === 'safety' ? 'danger' : 'muted'} height={6} />
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fg, textAlign: 'right' }}>
                    {byCat[cat]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>no findings</span>
          )}
        </div>
        <div style={{ padding: '14px 16px', background: T.bgElev, border: `1px solid ${T.border}`, borderRadius: 11 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>Most-affected definitions</div>
          {affected.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {affected.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
                  <LintSevDot severity={d.max} size={7} />
                  <KindBadge kind={d.kind} label={d.id} />
                  <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 11, color: T.fgMuted }}>
                    {d.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>no findings</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── one Index-wide finding row (target shown as the subject) ─────────────────
function TargetFindingRow({ fnd, open, onToggle }: { fnd: HealthFinding; open: boolean; onToggle: () => void }) {
  const sup = fnd.suppressed
  return (
    <div style={{ borderBottom: `1px solid ${T.border}`, opacity: sup ? 0.55 : 1 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          all: 'unset',
          cursor: 'pointer',
          boxSizing: 'border-box',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
        }}
      >
        <Icon
          name="arrowDown"
          size={9}
          color={T.fgFaint}
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms', flex: '0 0 auto' }}
        />
        <LintSevDot severity={fnd.severity} />
        <span style={{ flex: '0 0 auto' }}>
          <KindBadge kind={fnd.primaryKind} label={fnd.primaryDefinitionId ?? '—'} />
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: sup ? T.fgMuted : T.fg,
            textDecoration: sup ? 'line-through' : 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {fnd.title}
        </span>
        <LintMetaTag tone={fnd.category === 'safety' ? 'danger' : undefined}>{fnd.category}</LintMetaTag>
        {fnd.source === 'extension' ? <LintExtBadge extension={fnd.extension} /> : null}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          {!open && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              {(fnd.fixes ?? []).slice(0, 1).map((fx, i) => (
                <LintFixKind key={i} kind={fx.kind} />
              ))}
            </span>
          )}
          {fnd.requires ? (
            <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}>{fnd.requires}</span>
          ) : null}
        </span>
      </button>
      {open && <FindingDetail fnd={fnd} />}
    </div>
  )
}

type SevFilter = 'all' | LintSeverity

// ── Index-wide findings list (overview + filterable triage) ──────────────────
// Mounted inside the Health screen's QwShell (see `IndexHealth`).
export function IndexHealthList() {
  const idx = useIndexIndex()
  const all = idx.healthFindings
  const [sev, setSev] = useState<SevFilter>('all')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const counts = byKind(
    all.filter((f) => !f.suppressed),
    'severity',
  )
  const filtered = all
    .filter((f) => sev === 'all' || f.severity === sev)
    .sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0) || a.category.localeCompare(b.category))

  const Filter = ({ id, label, n }: { id: SevFilter; label: string; n: number }) => {
    const on = sev === id
    return (
      <button
        type="button"
        onClick={() => setSev(id)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 11px',
          borderRadius: 6,
          fontFamily: T.mono,
          fontSize: 11,
          background: on ? T.cruxSoft : 'transparent',
          color: on ? T.crux : T.fgMuted,
          boxShadow: on ? `inset 0 0 0 1px ${T.cruxLine}` : `inset 0 0 0 1px ${T.border}`,
        }}
      >
        {id !== 'all' && <LintSevDot severity={id} size={6} />}
        {label}
        <span style={{ color: on ? T.crux : T.fgFaint }}>{n}</span>
      </button>
    )
  }

  return (
    <div style={{ background: T.bg, color: T.fg, fontFamily: T.sans }}>
      <IndexHealthOverview />
      <div style={{ height: 1, background: T.border, margin: '28px 0 20px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>All findings</span>
        <span style={{ display: 'inline-flex', gap: 7, marginLeft: 'auto' }}>
          <Filter id="all" label="all" n={all.length} />
          {counts.error ? <Filter id="error" label="errors" n={counts.error} /> : null}
          <Filter id="warning" label="warnings" n={counts.warning || 0} />
          <Filter id="info" label="info" n={counts.info || 0} />
        </span>
      </div>
      {filtered.length ? (
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
          {filtered.map((fnd) => (
            <TargetFindingRow key={fnd.id} fnd={fnd} open={open.has(fnd.id)} onToggle={() => toggle(fnd.id)} />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '40px',
            justifyContent: 'center',
            background: T.bgElev,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            color: T.fgMuted,
            fontSize: 13,
          }}
        >
          <Icon name="check" size={15} color={T.ok} />
          {all.length === 0
            ? 'Clean — every indexed definition passes its applicable rules.'
            : 'No findings match the current filter.'}
        </div>
      )}
    </div>
  )
}
