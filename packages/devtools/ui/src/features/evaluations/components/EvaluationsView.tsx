/**
 * Evaluations — the source-defined checks discovered by `crux quality list`
 * (spec-02 EvaluationManifests). Rendered before any run exists: task kind,
 * cases, scorers, variants, replay posture, skip/only flags.
 */

import { QwShell } from '@/qw/shell/QwShell'
import { Chip, SectionHead, type ChipTone } from '@/qw/shell/primitives'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityEvaluationsSuspense } from '@/shared/hooks/useQualityApi'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'

function taskTone(kind: string): ChipTone {
  switch (kind) {
    case 'prompt':
      return 'crux'
    case 'agent':
      return 'iris'
    case 'flow':
      return 'ok'
    case 'retriever':
      return 'warn'
    default:
      return 'muted'
  }
}

export function EvaluationsView() {
  const { navigate } = useNavigation()
  const connected = useConnected()

  return (
    <QwShell
      activeView="evaluations"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Evaluations"
      title="Evaluations"
      subtitle="source-defined checks"
      connected={connected}
    >
      <div className="px-8 pb-10 pt-5">
        <SectionBoundary
          title="Evaluations"
          invalidateKeys={[qk.quality.evaluations()]}
          fallback={
            <>
              <SectionHead eyebrow="Evaluations" />
              <SkeletonRows rows={6} rowHeight={56} />
            </>
          }
        >
          <EvaluationsBody />
        </SectionBoundary>
      </div>
    </QwShell>
  )
}

function EvaluationsBody() {
  const list = useQualityEvaluationsSuspense()
  if (list.length === 0) {
    return (
      <div
        className="rounded-[10px] px-6 py-10 text-center text-[13px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
      >
        No evaluations discovered. Define one with <code className="font-mono">evaluate()</code> in an{' '}
        <code className="font-mono">*.eval.ts</code> file, or colocate <code className="font-mono">tests</code> on a prompt.
      </div>
    )
  }
  return (
    <>
      <SectionHead
        eyebrow="Evaluations"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {list.length} discovered
          </span>
        }
      />
      <div className="flex flex-col gap-2.5">
        {list.map((m) => (
          <div
            key={m.id}
            className="grid items-start gap-5 rounded-[10px] px-[18px] py-3.5"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)', gridTemplateColumns: '320px 1fr 200px' }}
          >
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[13.5px] font-semibold">{m.id}</span>
                {m.flags.skip && <Chip tone="warn">skip</Chip>}
                {m.flags.only && <Chip tone="crux">only</Chip>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone={taskTone(m.task.kind)} mono>
                  {m.task.kind}
                </Chip>
                {m.task.ref && (
                  <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {m.task.ref}
                  </span>
                )}
              </div>
              {m.description && (
                <div className="mt-1.5 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {m.description}
                </div>
              )}
              <div className="mt-1.5 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {m.source === 'prompt-tests' ? '(colocated prompt tests)' : m.file}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
              <span>
                {m.cases.length} case{m.cases.length === 1 ? '' : 's'}
                {m.trials > 1 ? ` · ${m.trials} trials` : ''}
                {m.datasets.length > 0 ? ` · ${m.datasets.length} dataset${m.datasets.length === 1 ? '' : 's'}` : ''}
              </span>
              {m.scorers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.scorers.map((s) => (
                    <Chip key={s.name} tone={s.costClass === 'model' ? 'iris' : 'muted'} mono>
                      {s.name}
                    </Chip>
                  ))}
                </div>
              )}
              {m.variants.length > 0 && (
                <span>
                  variants: {m.variants.map((v) => v.name).join(', ')}
                  {m.baseline ? ` (baseline ${m.baseline})` : ''}
                </span>
              )}
            </div>

            <div className="flex flex-col items-end gap-1.5">
              {m.replay?.mode && (
                <Chip tone="iris" mono>
                  replay {m.replay.mode}
                </Chip>
              )}
              {m.hasEvaluationExpect && <Chip tone="muted">expect</Chip>}
              {!m.explicitId && (
                <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  derived id
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
