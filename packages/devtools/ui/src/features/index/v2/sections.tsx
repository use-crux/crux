/**
 * Index v2 — mid/low-tier detail sections.
 *
 * Ported from the design's index-sections.jsx:
 *   · IndexQuality       — exhaustive definition.quality (pass rate, run
 *     breakdown, coverage, linked artifacts, fingerprints, drift table)
 *   · IndexObservability — runtimeJoin span correlation card
 *   · IndexDiagnostics    — intelligence.diagnostics
 *   · IndexHealthSection  — lint findings (direct + via deps)
 *   · IndexProvenance     — the quiet "everything else" card
 *
 * Sections render only when their data exists.
 */

import type { ReactNode } from 'react'
import { T, toneColor, type Tone } from './tokens'
import { Icon } from './icons'
import { Btn, Chip, SectionHead } from './primitives'
import { Bar, KindBadge, KindGlyph, kindMeta } from './kit'
import type { ViewDef } from './adapt'
import { useIndexIndex } from './context'

function statusTone(s?: string): Tone {
  return s === 'active' ? 'ok' : s === 'stale' ? 'warn' : s === 'missing' ? 'danger' : 'muted'
}

function fmtRunAt(ts?: number): string | undefined {
  if (ts == null) return undefined
  const diff = Date.now() - ts
  if (diff < 0 || !Number.isFinite(diff)) return new Date(ts).toLocaleString()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── QUALITY (exhaustive) ─────────────────────────────────────────────────────
export function IndexQuality({ def }: { def: ViewDef }) {
  const q = def.quality
  if (!q || (q.passRate == null && !q.runCount && !q.evalIds && !q.suiteIds)) return null
  const pr = q.passRate
  const prTone: Tone = pr == null ? 'muted' : pr >= 0.9 ? 'ok' : pr >= 0.75 ? 'crux' : 'warn'
  const c = toneColor(T, prTone)
  const runs = q.runCount ?? 0
  const comp = q.completedRunCount
  const fail = q.failedRunCount
  const run = q.runningRunCount
  const lastRunAt = fmtRunAt(q.lastRunAt)
  const artifacts: Array<[string, number | undefined, string]> = [
    ['runs', q.runCount, 'trace'],
    ['traces', q.traceIds?.length, 'trace'],
    ['experiments', q.experimentCount ?? q.experimentIds?.length, 'flask'],
    ['baselines', q.baselineCount ?? q.baselineIds?.length, 'bookmark'],
    ['comparisons', q.comparisonCount ?? q.comparisonIds?.length, 'diff'],
    ['feedback', q.feedbackCount ?? q.feedbackIds?.length, 'inbox'],
    ['cassettes', q.cassetteCount ?? q.cassettePaths?.length, 'cassette'],
  ]
  const usedArtifacts = artifacts.filter(([, n]) => Boolean(n))
  const drift = q.drift && [
    ...(q.drift.evals ?? []).map((d) => ({ ...d, kind: 'eval' as const })),
    ...(q.drift.suites ?? []).map((d) => ({ ...d, kind: 'suite' as const })),
  ]

  return (
    <>
      <SectionHead
        eyebrow="Quality"
        right={
          <span style={{ display: 'flex', gap: 6 }}>
            {q.lastStatus && (
              <Chip
                tone={
                  q.lastStatus === 'pass' || q.lastStatus === 'ok'
                    ? 'ok'
                    : q.lastStatus === 'running'
                      ? 'crux'
                      : 'danger'
                }
                dot
              >
                {q.lastStatus}
              </Chip>
            )}
            {q.changedSinceBaseline && (
              <Chip tone="warn" dot>
                changed vs baseline
              </Chip>
            )}
          </span>
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          overflow: 'hidden',
          marginBottom: 22,
        }}
      >
        {/* headline */}
        <div style={{ display: 'flex', gap: 24, padding: '16px 18px', flexWrap: 'wrap', alignItems: 'center' }}>
          {pr != null && (
            <div style={{ minWidth: 116 }}>
              <div style={{ fontFamily: T.mono, fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: c.fg }}>
                {Math.round(pr * 100)}%
              </div>
              <div style={{ fontSize: 11, color: T.fgFaint, fontFamily: T.mono, marginBottom: 7 }}>
                pass rate{q.caseCount ? ` · ${q.caseCount} cases` : ''}
              </div>
              <Bar value={pr} tone={prTone} height={7} />
            </div>
          )}
          {(comp != null || fail != null || run != null) && (
            <>
              <div style={{ width: 1, background: T.border, alignSelf: 'stretch' }} />
              <div style={{ minWidth: 150 }}>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 10,
                    color: T.fgFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 8,
                  }}
                >
                  {runs} runs
                </div>
                <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                  {comp ? <div style={{ width: `${(comp / runs) * 100}%`, background: T.ok }} /> : null}
                  {run ? <div style={{ width: `${(run / runs) * 100}%`, background: T.crux }} /> : null}
                  {fail ? <div style={{ width: `${(fail / runs) * 100}%`, background: T.danger }} /> : null}
                </div>
                <div style={{ display: 'flex', gap: 12, fontFamily: T.mono, fontSize: 10.5 }}>
                  {comp != null && <span style={{ color: T.ok }}>● {comp} done</span>}
                  {run ? <span style={{ color: T.crux }}>● {run} running</span> : null}
                  {fail ? <span style={{ color: T.danger }}>● {fail} failed</span> : null}
                </div>
              </div>
            </>
          )}
          {lastRunAt && (
            <>
              <div style={{ width: 1, background: T.border, alignSelf: 'stretch' }} />
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.fgMuted,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span>
                  <span style={{ color: T.fgFaint }}>last run · </span>
                  {lastRunAt}
                </span>
                {q.lastRunId && <span style={{ color: T.crux }}>{q.lastRunId}</span>}
              </div>
            </>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {q.runCount ? (
              <Btn
                size="sm"
                icon="trace"
                variant="soft"
                disabled
                title="Run navigation isn’t available from the index yet"
              >
                View {q.runCount} runs
              </Btn>
            ) : null}
          </div>
        </div>

        {/* coverage + artifacts */}
        {(q.evalIds || q.suiteIds || usedArtifacts.length > 0) && (
          <div
            style={{
              borderTop: `1px solid ${T.border}`,
              padding: '12px 18px',
              display: 'flex',
              gap: 26,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {q.evalIds && (
              <div>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9.5,
                    color: T.fgFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 5,
                  }}
                >
                  evals
                </div>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {q.evalIds.map((e) => (
                    <KindBadge key={e} kind="eval.quality" label={e} />
                  ))}
                </span>
              </div>
            )}
            {q.suiteIds && (
              <div>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9.5,
                    color: T.fgFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 5,
                  }}
                >
                  suites
                </div>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {q.suiteIds.map((s) => (
                    <KindBadge key={s} kind="suite" label={s} />
                  ))}
                </span>
              </div>
            )}
            {usedArtifacts.length > 0 && (
              <div style={{ marginLeft: 'auto' }}>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9.5,
                    color: T.fgFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 5,
                  }}
                >
                  linked
                </div>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {usedArtifacts.map(([label, n, icon]) => (
                    <span
                      key={label}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '2px 8px',
                        borderRadius: 5,
                        background: T.bg,
                        border: `1px solid ${T.border}`,
                        fontFamily: T.mono,
                        fontSize: 10.5,
                        color: T.fgMuted,
                      }}
                    >
                      <Icon name={icon} size={11} color={T.fgFaint} />
                      <span style={{ color: T.fg, fontWeight: 600 }}>{n}</span> {label}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        {/* fingerprints */}
        {(q.currentFingerprint || q.baselineFingerprint) && (
          <div
            style={{
              borderTop: `1px solid ${T.border}`,
              padding: '10px 18px',
              display: 'flex',
              gap: 18,
              alignItems: 'center',
              fontFamily: T.mono,
              fontSize: 11,
            }}
          >
            <span style={{ color: T.fgFaint }}>fingerprint</span>
            <span style={{ color: T.fg }}>{q.currentFingerprint}</span>
            {q.baselineFingerprint && (
              <>
                <Icon name="arrowRight" size={12} color={T.fgFaint} style={{ transform: 'rotate(180deg)' }} />
                <span style={{ color: T.fgFaint }}>baseline</span>
                <span style={{ color: T.fgMuted }}>{q.baselineFingerprint}</span>
              </>
            )}
            {q.changedSinceBaseline && (
              <Chip tone="warn" dot>
                drifted
              </Chip>
            )}
          </div>
        )}

        {/* drift table */}
        {drift && drift.length > 0 && (
          <div style={{ borderTop: `1px solid ${T.border}` }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 90px 90px 70px 70px',
                padding: '8px 18px',
                gap: 10,
                fontSize: 9.5,
                color: T.fgFaint,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                background: T.bgMuted,
              }}
            >
              <div />
              <div>check</div>
              <div style={{ textAlign: 'right' }}>baseline</div>
              <div style={{ textAlign: 'right' }}>now</div>
              <div style={{ textAlign: 'right' }}>runs</div>
              <div style={{ textAlign: 'right' }}>drift</div>
            </div>
            {drift.map((d, i) => (
              <div
                key={d.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr 90px 90px 70px 70px',
                  padding: '9px 18px',
                  gap: 10,
                  alignItems: 'center',
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  borderTop: i ? `1px solid ${T.border}` : 'none',
                }}
              >
                <KindGlyph kind={d.kind === 'suite' ? 'suite' : 'eval.quality'} size={20} />
                <span style={{ color: T.fg }}>{d.id}</span>
                <span style={{ textAlign: 'right', color: T.fgMuted }}>{Math.round(d.baselinePassRate * 100)}%</span>
                <span style={{ textAlign: 'right', color: T.fg, fontWeight: 600 }}>
                  {Math.round(d.passRate * 100)}%
                </span>
                <span style={{ textAlign: 'right', color: T.fgFaint }}>{d.runs}</span>
                <span
                  style={{
                    textAlign: 'right',
                    fontWeight: 600,
                    color: d.driftPp < 0 ? T.danger : d.driftPp > 0 ? T.ok : T.fgMuted,
                  }}
                >
                  {d.driftPp > 0 ? '+' : ''}
                  {d.driftPp}pp
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── OBSERVABILITY (runtimeJoin) ──────────────────────────────────────────────
export function IndexObservability({ def }: { def: ViewDef }) {
  const rjn = def.runtimeJoin
  if (!rjn) return null
  const idKeys = [
    'promptId',
    'contextId',
    'agentId',
    'toolName',
    'retrieverId',
    'memoryId',
    'memoryStoreId',
    'ragPipelineId',
    'workspaceId',
    'routingId',
    'routeKey',
    'flowName',
    'stepLabel',
  ] as const
  const ids = idKeys.filter((k) => rjn[k]).map((k) => [k, String(rjn[k])] as const)
  const kv = (k: string, v: ReactNode) =>
    v ? (
      <div style={{ display: 'flex', gap: 10, fontFamily: T.mono, fontSize: 11.5 }}>
        <span style={{ color: T.fgFaint, minWidth: 110 }}>{k}</span>
        <span style={{ color: T.fg }}>{v}</span>
      </div>
    ) : null
  return (
    <>
      <SectionHead
        eyebrow="Observability"
        right={
          def.quality && def.quality.runCount ? (
            <Btn size="xs" icon="trace" disabled title="Run navigation isn’t available from the index yet">
              View {def.quality.runCount} runs
            </Btn>
          ) : null
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${T.crux}`,
          borderRadius: 11,
          padding: '14px 18px',
          marginBottom: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <Icon name="trace" size={15} color={T.crux} />
          <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 600, color: T.fg }}>
            {rjn.spanName || rjn.primitive}
          </span>
          {rjn.primitive && (
            <Chip tone="crux" mono>
              {rjn.primitive}
            </Chip>
          )}
          {rjn.backend && (
            <Chip tone="muted" mono>
              {rjn.backend}
            </Chip>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {kv('primitive', rjn.primitive)}
            {kv('backend', rjn.backend)}
            {kv('resource', rjn.resource)}
            {kv('id prefix', rjn.runtimeIdPrefix)}
            {ids.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 10, fontFamily: T.mono, fontSize: 11.5 }}>
                <span style={{ color: T.fgFaint, minWidth: 110 }}>{k}</span>
                <span style={{ color: T.fg }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rjn.correlationAttributes && (
              <div>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9.5,
                    color: T.fgFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 6,
                  }}
                >
                  correlation attributes
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {rjn.correlationAttributes.map((a) => (
                    <span
                      key={a}
                      style={{
                        fontFamily: T.mono,
                        fontSize: 10.5,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: T.cruxSoft,
                        color: T.crux,
                      }}
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {rjn.spanAttributes && (
              <div>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9.5,
                    color: T.fgFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 6,
                  }}
                >
                  span attributes
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(rjn.spanAttributes).map(([k, v]) => (
                    <div key={k} style={{ fontFamily: T.mono, fontSize: 10.5 }}>
                      <span style={{ color: T.fgFaint }}>{k}=</span>
                      <span style={{ color: T.fg }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── DIAGNOSTICS (intelligence.diagnostics) ───────────────────────────────────
export function IndexDiagnostics({ def }: { def: ViewDef }) {
  const ds = def.diagnostics
  if (!ds || !ds.length) return null
  return (
    <div style={{ marginBottom: 22 }}>
      {ds.map((d, i) => {
        const c = toneColor(T, d.severity === 'error' ? 'danger' : d.severity === 'warning' ? 'warn' : 'crux')
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 14px',
              background: T.bg,
              border: `1px dashed ${c.line}`,
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            <Icon name="sparkle" size={13} color={c.fg} style={{ marginTop: 2 }} />
            <div>
              <span style={{ fontFamily: T.mono, fontSize: 10.5, color: c.fg }}>{d.code || d.severity}</span>
              <div style={{ fontSize: 12.5, color: T.fgMuted, marginTop: 2 }}>{d.message}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── HEALTH (lint) ────────────────────────────────────────────────────────────
export function IndexHealthSection({ def }: { def: ViewDef }) {
  const idx = useIndexIndex()
  const lints = idx.lintsForDef(def.id)
  const direct = lints.filter((f) => f.primaryDefinitionId === def.id)
  const transitive = lints.filter((f) => f.primaryDefinitionId !== def.id)
  if (!direct.length && !transitive.length) return null
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
        {[...direct, ...transitive].map((fnd) => {
          const isDirect = fnd.primaryDefinitionId === def.id
          const lc = toneColor(T, fnd.severity === 'warning' ? 'warn' : fnd.severity === 'error' ? 'danger' : 'iris')
          return (
            <div
              key={fnd.id}
              style={{
                background: T.bgElev,
                border: `1px solid ${T.border}`,
                borderLeft: `3px solid ${lc.fg}`,
                borderRadius: 10,
                padding: '12px 16px',
                opacity: isDirect ? 1 : 0.92,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: lc.fg }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{fnd.title}</span>
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9.5,
                    color: lc.fg,
                    background: lc.soft,
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}
                >
                  {fnd.category}
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}>
                  {fnd.confidence} confidence · {fnd.maturity}
                </span>
                {!isDirect && (
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>
                    · on {fnd.primaryDefinitionId}
                  </span>
                )}
                <span style={{ marginLeft: 'auto' }}>
                  <Btn size="xs" icon="github" disabled title="Opening source files isn’t available yet">
                    Open file
                  </Btn>
                </span>
              </div>
              <div style={{ fontFamily: T.serif, fontSize: 13, color: T.fgMuted, lineHeight: 1.5, marginBottom: 8 }}>
                {fnd.rationale}
              </div>
              {fnd.fix && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    background: T.bg,
                    border: `1px solid ${T.border}`,
                    borderRadius: 7,
                  }}
                >
                  <span
                    style={{
                      fontFamily: T.mono,
                      fontSize: 9.5,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: lc.fg,
                      fontWeight: 600,
                    }}
                  >
                    fix
                  </span>
                  <span style={{ fontSize: 12, color: T.fg }}>{fnd.fix}</span>
                  {fnd.suppression && (
                    <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>
                      {fnd.suppression.directive}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── PROVENANCE (the quiet "everything else") ─────────────────────────────────
export function IndexProvenance({ def }: { def: ViewDef }) {
  const idx = useIndexIndex()
  const m = kindMeta(def.kind)
  const indexing = idx.indexing
  const Row = ({ k, children }: { k: string; children?: ReactNode }) =>
    children != null && children !== '' ? (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          gap: 12,
          padding: '6px 0',
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 10.5,
            color: T.fgFaint,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {k}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fg }}>{children}</span>
      </div>
    ) : null
  return (
    <>
      <SectionHead
        eyebrow="Provenance & indexing"
        right={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>read-model metadata</span>}
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          padding: '6px 18px 14px',
          marginBottom: 8,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          columnGap: 36,
        }}
      >
        <div>
          <Row k="kind">{def.kind}</Row>
          <Row k="family">{m.familyLabel}</Row>
          <Row k="status">
            <span style={{ color: toneColor(T, statusTone(def.status ?? 'active')).fg }}>{def.status ?? 'active'}</span>
          </Row>
          <Row k="fidelity">{def.fidelity}</Row>
          <Row k="confidence">{def.confidence}</Row>
          <Row k="fingerprint">{def.fingerprint}</Row>
          <Row k="tags">{def.tags && def.tags.join(' · ')}</Row>
        </div>
        <div>
          <Row k="source">
            {def.file}:{def.line}
            {def.raw.source?.function ? ` · ${def.raw.source.function}()` : ''}
          </Row>
          <Row k="module path">{def.path && def.path.join('.')}</Row>
          <Row k="import-safe">{def.sourceStatus ? String(def.sourceStatus.importSafe) : undefined}</Row>
          <Row k="partial reason">{def.sourceStatus?.partialReason}</Row>
          <Row k="updated">{def.updated}</Row>
          {indexing && (
            <Row k="ast index">
              {indexing.ast.status}
              {indexing.ast.indexedAt ? ` · ${indexing.ast.indexedAt}` : ''}
            </Row>
          )}
          {indexing && (
            <Row k="semantic index">
              {indexing.semantic.status}
              {indexing.semantic.indexedAt ? ` · ${indexing.semantic.indexedAt}` : ''}
            </Row>
          )}
        </div>
      </div>
    </>
  )
}
