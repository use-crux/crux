/**
 * Scorers & gates — derived scorer rows + promotion gate config.
 */

import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, ScoreBar, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityScorersSuspense } from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'

const KIND_TONE: Record<string, { tone: 'iris' | 'ok' | 'crux' | 'muted'; label: string }> = {
  judge: { tone: 'iris', label: 'LLM judge' },
  rule: { tone: 'ok', label: 'rule' },
  metric: { tone: 'crux', label: 'metric' },
}

/**
 * Outer shell — never suspends. The inner `ScorersBody` calls
 * `useQualityScorersSuspense()`, so first-paint suspends inside the
 * SectionBoundary below and shows the skeleton fallback. Once data is
 * in cache, background refetches don't re-suspend.
 */
export function ScorersView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { toast } = useToast()

  return (
    <QwShell
      activeView="scorers"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Settings / Scorers & gates"
      title="Scorers & gates"
      subtitle="derived from experiments"
      connected={connected}
      actions={
        <>
          <Btn
            icon={<Icon name="filter" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Import scorers',
                message: 'Add a scorer to your suite definition (llmJudge / rule / metric).',
              })
            }
          >
            Import
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="play" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'New scorer',
                message: 'Define with llmJudge() or a custom function in your suite source.',
              })
            }
          >
            New scorer
          </Btn>
        </>
      }
    >
      <div className="px-8 pb-10 pt-5">
        <SectionBoundary
          title="Scorers"
          invalidateKeys={[qk.quality.scorers()]}
          fallback={
            <>
              <SectionHead eyebrow="Scorers" />
              <SkeletonRows rows={5} rowHeight={62} />
            </>
          }
        >
          <ScorersBody />
        </SectionBoundary>

        <div className="mt-7">
          <SectionHead
            eyebrow="Promotion gates"
            right={
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                workspace default
              </span>
            }
          />
          <div
            className="rounded-[10px] px-[18px] py-3 text-[12.5px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px dashed var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            Promotion gates aren't editable from the UI yet. They live in the comparison record and are evaluated when
            you promote a candidate; see the Compare screen for the gate panel.
          </div>
        </div>
      </div>
    </QwShell>
  )
}

/**
 * Scorers list body. Suspends on first load — the parent SectionBoundary
 * catches it and renders the skeleton fallback.
 */
function ScorersBody() {
  const { toast } = useToast()
  const list = useQualityScorersSuspense()
  return (
    <>
      <SectionHead
        eyebrow="Scorers"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {list.length} active
          </span>
        }
      />
      <div className="flex flex-col gap-2.5">
        {list.length === 0 && (
          <div
            className="rounded-[10px] px-6 py-10 text-center text-[13px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px dashed var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            No scorers yet. Scorer rows are derived from experiment case scores once you run a suite.
          </div>
        )}
        {list.map((s) => {
          const k = KIND_TONE[s.kind] ?? { tone: 'muted' as const, label: s.kind }
          return (
            <div
              key={s.name}
              className="grid items-center gap-[18px] rounded-[10px] px-[18px] py-3.5"
              style={{
                background: 'var(--qw-bg-elev)',
                border: '1px solid var(--qw-border)',
                gridTemplateColumns: '260px 1fr 230px 180px',
              }}
            >
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-[13.5px] font-semibold">{s.name}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Chip tone={k.tone} mono>
                    {k.label}
                  </Chip>
                </div>
              </div>
              <div>
                <div className="text-[12.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
                  Used by{' '}
                  <span className="font-mono">{s.suiteIds?.length ? s.suiteIds.join(', ') : '(no suites)'}</span>
                </div>
                <div className="mt-1.5 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {s.runCount} runs{s.lastUsedAt ? ` · last used ${new Date(s.lastUsedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div>
                <div
                  className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.1em]"
                  style={{ color: 'var(--qw-fg-faint)' }}
                >
                  Pass rate
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBar
                    score={s.passRate ?? 0}
                    color={
                      (s.passRate ?? 0) >= 0.85
                        ? 'var(--qw-ok)'
                        : (s.passRate ?? 0) >= 0.7
                          ? 'var(--qw-crux)'
                          : 'var(--qw-warn)'
                    }
                  />
                  <span
                    className="w-9 text-right font-mono text-[12.5px] font-semibold"
                    style={{
                      color:
                        (s.passRate ?? 0) >= 0.85
                          ? 'var(--qw-ok)'
                          : (s.passRate ?? 0) >= 0.7
                            ? 'var(--qw-crux)'
                            : 'var(--qw-warn)',
                    }}
                  >
                    {s.passRate != null ? `${Math.round(s.passRate * 100)}%` : '—'}
                  </span>
                </div>
                {s.meanScore != null && (
                  <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    mean · {s.meanScore.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <Btn
                  size="xs"
                  icon={<Icon name="filter" size={11} />}
                  onClick={() =>
                    toast({
                      kind: 'info',
                      title: `Edit ${s.name}`,
                      message: 'Scorer rows are derived — edit the suite source to change config.',
                    })
                  }
                >
                  Edit
                </Btn>
                <Btn
                  size="xs"
                  icon={<Icon name="play" size={11} />}
                  onClick={() =>
                    toast({
                      kind: 'info',
                      title: `Test ${s.name}`,
                      message: 'Run the scorer against a case via `crux quality scorers test`.',
                    })
                  }
                >
                  Test
                </Btn>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
