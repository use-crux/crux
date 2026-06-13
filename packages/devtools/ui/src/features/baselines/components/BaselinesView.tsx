/**
 * Baselines — promoted reference experiments per target.
 */

import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityBaselinesSuspense } from '@/shared/hooks/useQualityApi'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'

function timeAgo(iso: string | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!ts) return ''
  const diff = Date.now() - ts
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function BaselinesView() {
  const { navigate } = useNavigation()
  const connected = useConnected()

  return (
    <QwShell
      activeView="baselines"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Baselines"
      title="Promoted baselines"
      subtitle="derived from experiments"
      connected={connected}
    >
      <div className="flex flex-col gap-3.5 px-8 pb-10 pt-6">
        <SectionBoundary
          title="Baselines"
          invalidateKeys={[qk.quality.baselines()]}
          fallback={
            <div className="flex flex-col gap-3.5">
              <SkeletonCard bodyLines={3} height={120} />
              <SkeletonCard bodyLines={3} height={120} />
            </div>
          }
        >
          <BaselinesBody onOpenExperiment={(id) => navigate({ view: 'experiment-detail', experimentId: id })} />
        </SectionBoundary>
      </div>
    </QwShell>
  )
}

function BaselinesBody({ onOpenExperiment }: { onOpenExperiment: (experimentId: string) => void }) {
  const baselines = useQualityBaselinesSuspense()
  if (baselines.length === 0) {
    return (
      <div
        className="rounded-[10px] px-6 py-10 text-center text-[13px]"
        style={{
          background: 'var(--qw-bg-elev)',
          border: '1px dashed var(--qw-border)',
          color: 'var(--qw-fg-muted)',
        }}
      >
        No baselines promoted yet. Run an experiment and{' '}
        <code className="font-mono">crux quality promote &lt;experimentId&gt;</code> a passing variant.
      </div>
    )
  }
  return (
    <>
      {baselines.map((b) => {
        const referenceCases = Object.keys(b.reference)
        return (
          <div
            key={b.baselineId}
            className="grid items-start gap-5 rounded-[12px] px-5 py-[18px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
              gridTemplateColumns: '260px 1fr 200px',
            }}
          >
            <div>
              <div
                className="mb-1 text-[10px] font-mono uppercase tracking-[0.12em]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                Evaluation
              </div>
              <div className="font-mono text-[15px] font-semibold tracking-[-0.01em]">{b.evaluationId}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {b.variantName && (
                  <Chip tone="crux" mono>
                    {b.variantName}
                  </Chip>
                )}
                <Chip tone="muted">{timeAgo(b.promotedAt)}</Chip>
                {b.promotedBy && <Chip tone="muted">{b.promotedBy}</Chip>}
              </div>
              <div className="mt-2 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                fp {b.configFingerprint.slice(0, 12)}
              </div>
            </div>

            <div>
              <div
                className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.1em]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                Reference · {referenceCases.length} case{referenceCases.length === 1 ? '' : 's'}
              </div>
              <div className="flex flex-col gap-1">
                {referenceCases.slice(0, 6).map((caseId) => (
                  <div key={caseId} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="truncate" style={{ color: 'var(--qw-fg-muted)' }}>
                      {caseId}
                    </span>
                    <span style={{ color: 'var(--qw-fg-faint)' }}>
                      {Object.entries(b.reference[caseId])
                        .map(([name, value]) => `${name} ${value.toFixed(2)}`)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
                {referenceCases.length > 6 && (
                  <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    +{referenceCases.length - 6} more
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Btn size="xs" icon={<Icon name="flask" size={11} />} onClick={() => onOpenExperiment(b.experimentId)}>
                Open experiment
              </Btn>
            </div>
          </div>
        )
      })}
    </>
  )
}
