/**
 * Renders the Project Catalog quality join for a single definition.
 *
 * The fields come straight off `ProjectDefinition.quality` — the backend
 * computes both the direct quality references and the *transitive*
 * affected eval/suite suggestions through the catalog relation graph,
 * so we render them as-is. No client-side relation walking.
 *
 * - <DefinitionQualityDot/>      compact chip for list/tree rows.
 * - <DefinitionQualitySection/>  detail panel section with the badge,
 *                                short fingerprints, and the affected
 *                                eval/suite chip lists.
 *
 * If `quality` is undefined or all fields are empty, the section renders
 * nothing — "missing means unknown/no suggestion, not an error", per the
 * backend handoff.
 */

import { useNavigation } from '@/app/navigation/useNavigation'
import type { ProjectDefinitionQuality } from '@/types'
import { cn } from '@/shared/lib/utils'

function shortHash(h: string | undefined): string | null {
  if (!h) return null
  const stripped = h.replace(/^sha256:/i, '')
  return stripped.length > 10 ? stripped.slice(0, 10) : stripped
}

export function DefinitionQualityDot({
  quality,
  className,
}: {
  quality: ProjectDefinitionQuality | undefined
  className?: string
}) {
  if (!quality?.changedSinceBaseline) return null
  const affected =
    (quality.affectedEvalIds?.length ?? 0) + (quality.affectedSuiteIds?.length ?? 0)
  const title = affected > 0
    ? `Changed since baseline · ${affected} affected check${affected === 1 ? '' : 's'}`
    : 'Changed since baseline'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-medium uppercase tracking-[0.06em]',
        className,
      )}
      style={{
        background: 'var(--qw-warn-soft)',
        color: 'var(--qw-warn)',
        border: '1px solid var(--qw-warn-soft)',
      }}
      title={title}
    >
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: 'var(--qw-warn)' }}
        aria-hidden
      />
      changed
    </span>
  )
}

export function DefinitionQualitySection({
  quality,
}: {
  quality: ProjectDefinitionQuality | undefined
}) {
  const { navigate } = useNavigation()
  if (!quality) return null

  const changed = quality.changedSinceBaseline === true
  const baseHash = shortHash(quality.baselineFingerprint)
  const currHash = shortHash(quality.currentFingerprint)
  const affEvals = quality.affectedEvalIds ?? []
  const affSuites = quality.affectedSuiteIds ?? []
  const driftEvals = quality.drift?.evals ?? []
  const driftSuites = quality.drift?.suites ?? []
  const hasFingerprints = baseHash != null || currHash != null
  const hasAffected = affEvals.length > 0 || affSuites.length > 0
  const hasDrift = driftEvals.length > 0 || driftSuites.length > 0

  // Per the handoff: empty state = hide the section entirely.
  if (!changed && !hasFingerprints && !hasAffected && !hasDrift) return null

  return (
    <section
      className="mt-6 overflow-hidden rounded-[10px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
      }}
    >
      <header
        className="flex items-center gap-2 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
        style={{
          color: 'var(--qw-fg-faint)',
          background: 'var(--qw-bg-muted)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <span>Affected checks</span>
        {changed && <DefinitionQualityDot quality={quality} />}
      </header>

      <div className="flex flex-col gap-4 px-4 py-3">
        {hasAffected ? (
          <>
            {affEvals.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div
                  className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
                  style={{ color: 'var(--qw-fg-faint)' }}
                >
                  Evals · {affEvals.length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {affEvals.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => navigate({ view: 'experiment-detail', experimentId: id })}
                      className="rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-opacity hover:opacity-90"
                      style={{
                        background: 'var(--qw-bg-muted)',
                        color: 'var(--qw-fg)',
                        boxShadow: 'inset 0 0 0 1px var(--qw-border)',
                      }}
                      title={`Open experiment · ${id}`}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {affSuites.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div
                  className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
                  style={{ color: 'var(--qw-fg-faint)' }}
                >
                  Suites · {affSuites.length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {affSuites.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => navigate({ view: 'dataset-detail', suiteId: id })}
                      className="rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-opacity hover:opacity-90"
                      style={{
                        background: 'var(--qw-bg-muted)',
                        color: 'var(--qw-fg)',
                        boxShadow: 'inset 0 0 0 1px var(--qw-border)',
                      }}
                      title={`Open suite · ${id}`}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : changed ? (
          <div className="text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            No evals or suites currently transitively affected.
          </div>
        ) : null}

        {hasFingerprints && (
          <div
            className="flex flex-col gap-1 pt-3"
            style={{ borderTop: '1px solid var(--qw-border)' }}
          >
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              Fingerprints
            </div>
            <dl className="grid font-mono text-[11.5px]" style={{ gridTemplateColumns: '90px 1fr' }}>
              {baseHash && (
                <>
                  <dt style={{ color: 'var(--qw-fg-faint)' }}>baseline</dt>
                  <dd
                    className="break-all"
                    style={{ color: 'var(--qw-fg)' }}
                    title={quality.baselineFingerprint}
                  >
                    {baseHash}
                  </dd>
                </>
              )}
              {currHash && (
                <>
                  <dt style={{ color: 'var(--qw-fg-faint)' }}>current</dt>
                  <dd
                    className="break-all"
                    style={{ color: changed ? 'var(--qw-warn)' : 'var(--qw-fg)' }}
                    title={quality.currentFingerprint}
                  >
                    {currHash}
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}

        {hasDrift && (
          <div
            className="flex flex-col gap-2 pt-3"
            style={{ borderTop: '1px solid var(--qw-border)' }}
          >
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              Quality impact · drift vs baseline
            </div>
            <DriftTable evals={driftEvals} suites={driftSuites} />
          </div>
        )}
      </div>
    </section>
  )
}

function DriftTable({
  evals,
  suites,
}: {
  evals: NonNullable<ProjectDefinitionQuality['drift']>['evals']
  suites: NonNullable<ProjectDefinitionQuality['drift']>['suites']
}) {
  const { navigate } = useNavigation()
  // Merge into one rendered list for compact display; kind discriminato
  // drives the icon glyph + navigation target.
  const rows: Array<{
    kind: 'eval' | 'suite'
    id: string
    passRate: number
    runs: number
    baselineExperimentId: string
    driftPp: number
  }> = [
    ...evals.map((r) => ({ ...r, kind: 'eval' as const })),
    ...suites.map((r) => ({ ...r, kind: 'suite' as const })),
  ]
  return (
    <div
      className="overflow-hidden rounded-[8px]"
      style={{ border: '1px solid var(--qw-border)' }}
    >
      <div
        className="grid items-center px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
        style={{
          gridTemplateColumns: '16px 1fr 60px 70px 110px 70px',
          gap: 10,
          color: 'var(--qw-fg-faint)',
          background: 'var(--qw-bg-muted)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <span />
        <span>check</span>
        <span style={{ textAlign: 'right' }}>pass</span>
        <span style={{ textAlign: 'right' }}>runs</span>
        <span style={{ textAlign: 'right' }}>baseline</span>
        <span style={{ textAlign: 'right' }}>drift</span>
      </div>
      {rows.map((r, i) => {
        const passPct = Math.round(r.passRate * 100)
        const passColor =
          passPct >= 90 ? 'var(--qw-ok)' : passPct >= 75 ? 'var(--qw-crux)' : 'var(--qw-warn)'
        const driftColor =
          r.driftPp > 0 ? 'var(--qw-ok)' : r.driftPp < 0 ? 'var(--qw-danger)' : 'var(--qw-fg-muted)'
        const sign = r.driftPp > 0 ? '+' : ''
        return (
          <button
            key={`${r.kind}-${r.id}`}
            type="button"
            onClick={() =>
              navigate(
                r.kind === 'eval'
                  ? { view: 'experiment-detail', experimentId: r.id }
                  : { view: 'dataset-detail', suiteId: r.id },
              )
            }
            className="grid w-full items-center px-3 py-2 text-left transition-opacity hover:opacity-80"
            style={{
              gridTemplateColumns: '16px 1fr 60px 70px 110px 70px',
              gap: 10,
              borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--qw-border)',
              fontSize: 12,
              fontFamily: 'var(--qw-mono)',
            }}
            title={`Open ${r.kind} · ${r.id}`}
          >
            <span
              className="size-2 rounded-full"
              style={{
                background:
                  r.kind === 'eval' ? 'var(--qw-crux)' : 'var(--qw-fg-muted)',
              }}
              aria-hidden
            />
            <span style={{ color: 'var(--qw-fg)' }}>{r.id}</span>
            <span style={{ color: passColor, textAlign: 'right', fontWeight: 600 }}>
              {passPct}%
            </span>
            <span style={{ color: 'var(--qw-fg-muted)', textAlign: 'right' }}>{r.runs}</span>
            <span
              style={{ color: 'var(--qw-crux)', textAlign: 'right' }}
              title={`Baseline experiment · ${r.baselineExperimentId}`}
            >
              {r.baselineExperimentId.length > 12
                ? `${r.baselineExperimentId.slice(0, 12)}…`
                : r.baselineExperimentId}
            </span>
            <span style={{ color: driftColor, textAlign: 'right', fontWeight: 500 }}>
              {r.driftPp === 0 ? '0' : `${sign}${r.driftPp.toFixed(1)}pp`}
            </span>
          </button>
        )
      })}
    </div>
  )
}
