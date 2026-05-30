/**
 * Baselines — promoted reference experiments per target.
 */

import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityBaselinesSuspense } from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'

function formatPct(n: number | undefined): string {
  return n != null ? `${(n * 100).toFixed(0)}%` : '—'
}

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
  const { toast } = useToast()

  return (
    <QwShell
      activeView="baselines"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Baselines"
      title="Promoted baselines"
      subtitle="derived from experiments"
      connected={connected}
      actions={
        <>
          <Btn
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Promotion rules',
                message: 'Configured in your suite definition. UI editor coming next.',
              })
            }
          >
            Promotion rules
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="compare" size={13} />}
            onClick={() => navigate({ view: 'compare' })}
          >
            New comparison
          </Btn>
        </>
      }
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
          <BaselinesBody onNavigateCompare={() => navigate({ view: 'compare' })} onOpenExperiment={(id) => navigate({ view: 'experiment-detail', experimentId: id })} />
        </SectionBoundary>
      </div>
    </QwShell>
  )
}

function BaselinesBody({
  onNavigateCompare,
  onOpenExperiment,
}: {
  onNavigateCompare: () => void
  onOpenExperiment: (experimentId: string) => void
}) {
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
        No baselines promoted yet. Run an experiment and promote a winning variant.
      </div>
    )
  }
  return (
    <>
      {baselines.map((b) => (
          <div
            key={b.id}
            className="grid items-center gap-5 rounded-[12px] px-5 py-[18px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
              gridTemplateColumns: '220px 1fr 280px',
            }}
          >
            <div>
              <div
                className="mb-1 text-[10px] font-mono uppercase tracking-[0.12em]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                Target
              </div>
              <div className="font-mono text-[17px] font-semibold tracking-[-0.01em]">
                {b.label ?? b.experimentId}
              </div>
              <div className="mt-2 flex gap-1.5">
                <Chip tone="crux" mono>
                  {b.experimentId}
                </Chip>
                <Chip tone="muted">{timeAgo(b.promotedAt)}</Chip>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[13.5px] font-medium">
                {b.summary.label ?? b.summary.experimentId}
              </div>
              <div className="flex gap-[18px] font-mono text-[12px]">
                <Stat label="Pass rate" value={formatPct(b.summary.passRate)} color="var(--qw-ok)" />
                <Stat label="Cases" value={`${b.summary.passed}/${b.summary.total}`} />
                <Stat
                  label="P50"
                  value={`${b.summary.avgDurationMs.toFixed(0)}ms`}
                  color="var(--qw-fg-muted)"
                />
              </div>
            </div>

            <div className="flex justify-end gap-1.5">
              <Btn
                size="xs"
                icon={<Icon name="compare" size={11} />}
                onClick={onNavigateCompare}
              >
                Compare latest
              </Btn>
              <Btn
                size="xs"
                icon={<Icon name="flask" size={11} />}
                onClick={() => onOpenExperiment(b.experimentId)}
              >
                Open experiment
              </Btn>
            </div>
          </div>
        ))}
    </>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.1em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        {label}
      </div>
      <div className="mt-0.5 text-[22px] font-semibold" style={{ color: color ?? 'var(--qw-fg)' }}>
        {value}
      </div>
    </div>
  )
}
