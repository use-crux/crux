/**
 * Datasets — eval/test suites with cases.
 *
 * List screen renders cards in a 2-column grid, detail screen shows the
 * case table with input / expected / citations columns.
 */

import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, ScoreBar } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualitySuiteSuspense, useQualitySuitesSuspense } from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard, SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'
import { usePrefetchSuite } from '@/shared/hooks/usePrefetch'

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

export function DatasetsView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { toast } = useToast()
  // Suspends on first paint; the top-level App Suspense catches it.
  const list = useQualitySuitesSuspense()
  const prefetchSuite = usePrefetchSuite()

  const totalCases = list.reduce((s, d) => s + d.caseCount, 0)

  return (
    <QwShell
      activeView="datasets"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Suites"
      title="Suites"
      subtitle={`${list.length} total · ${totalCases} cases`}
      connected={connected}
      actions={
        <>
          <Btn
            icon={<Icon name="layers" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Import cases',
                message: 'Drop a JSON array of {input, expected} into .crux/quality/suites/<id>.json',
              })
            }
          >
            Import cases
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="play" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Create a suite',
                message: 'Run `crux quality suites new` or create .crux/quality/suites/<id>.json directly.',
              })
            }
          >
            New suite
          </Btn>
        </>
      }
    >
      <div className="px-8 pb-10 pt-5">
        {list.length === 0 && (
          <div
            className="rounded-[10px] px-6 py-12 text-center text-[13px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px dashed var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            No suites yet. Save a trace as a case from the Run detail screen, or import a JSON
            suite under <code className="font-mono">.crux/quality/suites/</code>.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3.5">
          {list.map((d) => (
            <button
              key={d.suiteId}
              onClick={() => navigate({ view: 'dataset-detail', suiteId: d.suiteId })}
              onMouseEnter={() => prefetchSuite(d.suiteId)}
              onFocus={() => prefetchSuite(d.suiteId)}
              className="flex flex-col gap-3 rounded-[10px] px-[18px] py-4 text-left transition-colors hover:opacity-95"
              style={{
                background: 'var(--qw-bg-elev)',
                border: '1px solid var(--qw-border)',
              }}
            >
              <div className="flex items-center gap-2">
                <Icon name="layers" size={14} color="var(--qw-crux)" />
                <span className="font-mono text-[15px] font-semibold tracking-[-0.01em]">
                  {d.name ?? d.suiteId}
                </span>
                {d.version && (
                  <Chip tone="muted" mono>
                    {d.version}
                  </Chip>
                )}
                <span
                  className="ml-auto font-mono text-[11px]"
                  style={{ color: 'var(--qw-fg-faint)' }}
                >
                  {d.lastRunAt ? `updated ${timeAgo(d.lastRunAt)}` : 'never run'}
                </span>
              </div>
              <div className="flex gap-[18px] pt-0.5">
                <div>
                  <div
                    className="text-[10px] font-mono uppercase tracking-[0.1em]"
                    style={{ color: 'var(--qw-fg-faint)' }}
                  >
                    Cases
                  </div>
                  <div className="font-mono text-[22px] font-semibold">{d.caseCount}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="mb-1 text-[10px] font-mono uppercase tracking-[0.1em]"
                    style={{ color: 'var(--qw-fg-faint)' }}
                  >
                    Last pass rate
                  </div>
                  {d.lastPassRate != null ? (
                    <div className="flex items-center gap-2">
                      <ScoreBar
                        score={d.lastPassRate}
                        color={
                          d.lastPassRate >= 0.85
                            ? 'var(--qw-ok)'
                            : d.lastPassRate >= 0.7
                              ? 'var(--qw-crux)'
                              : d.lastPassRate >= 0.5
                                ? 'var(--qw-warn)'
                                : 'var(--qw-danger)'
                        }
                      />
                      <span
                        className="font-mono text-[12px] font-semibold"
                        style={{
                          color:
                            d.lastPassRate >= 0.85
                              ? 'var(--qw-ok)'
                              : d.lastPassRate >= 0.7
                                ? 'var(--qw-crux)'
                                : 'var(--qw-warn)',
                        }}
                      >
                        {(d.lastPassRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <div className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
                      not run yet
                    </div>
                  )}
                </div>
              </div>
              {d.scorers && d.scorers.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-0.5">
                  <div
                    className="text-[10px] font-mono uppercase tracking-[0.1em]"
                    style={{ color: 'var(--qw-fg-faint)' }}
                  >
                    Scorers · {d.scorers.length}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {d.scorers.map((s) => (
                      <Chip key={s} tone="iris" mono>
                        {s}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {d.tags && d.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {d.tags.map((t) => (
                    <Chip key={t} tone="muted">
                      {t}
                    </Chip>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </QwShell>
  )
}

// ─── Detail ─────────────────────────────────────────────────────────

interface DatasetDetailProps {
  suiteId: string
}

export function DatasetDetailView({ suiteId }: DatasetDetailProps) {
  const connected = useConnected()
  const { navigate } = useNavigation()
  const { toast } = useToast()
  // Suspends on first paint — caught by the App-level Suspense.
  const suite = useQualitySuiteSuspense(suiteId)


  if (!suite) {
    return (
      <QwShell
        activeView="datasets"
        onNavigate={(v) => navigate(navTarget(v))}
        breadcrumb={`Evaluate / Suites / ${suiteId}`}
        title="Suite not found"
        connected={connected}
      >
        <div className="px-8 py-10 text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
          No suite with id <code className="font-mono">{suiteId}</code>.
        </div>
      </QwShell>
    )
  }

  return (
    <QwShell
      activeView="datasets"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Evaluate / Suites / ${suite.name ?? suite.suiteId}`}
      title={`${suite.name ?? suite.suiteId}${suite.version ? ' @ ' + suite.version : ''}`}
      subtitle={`${suite.caseCount} cases${suite.scorers?.length ? ' · ' + suite.scorers.length + ' scorers' : ''}`}
      connected={connected}
      actions={
        <>
          <Btn
            icon={<Icon name="play" size={13} />}
            onClick={() => navigate({ view: 'experiments' })}
          >
            Run experiment
          </Btn>
          <Btn
            icon={<Icon name="layers" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Add case',
                message: 'POSTs to /api/quality/suites/' + suiteId + '/cases — guided form is next.',
              })
            }
          >
            Add case
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="bookmark" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'New suite version',
                message: 'Bump the version field in .crux/quality/suites/' + suiteId + '.json',
              })
            }
          >
            New version
          </Btn>
        </>
      }
    >
      <div>
        <div
          className="sticky top-0 z-10 grid items-center gap-3 px-8 py-2 text-[10.5px] font-medium uppercase tracking-[0.08em]"
          style={{
            gridTemplateColumns: '60px 1fr 1.4fr 1fr',
            color: 'var(--qw-fg-faint)',
            background: 'var(--qw-bg)',
            borderBottom: '1px solid var(--qw-border)',
          }}
        >
          <div>id</div>
          <div>name &amp; input</div>
          <div>expected (golden)</div>
          <div>tags</div>
        </div>
        {suite.cases.length === 0 && (
          <div className="px-8 py-12 text-center text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
            No cases yet. Add cases from traces, feedback, or import a JSON suite.
          </div>
        )}
        {suite.cases.map((c) => (
          <div
            key={c.caseId}
            className="grid items-start gap-3 px-8 py-3.5 text-[12.5px]"
            style={{
              gridTemplateColumns: '60px 1fr 1.4fr 1fr',
              borderBottom: '1px solid var(--qw-border)',
            }}
          >
            <span className="pt-1 font-mono text-[11px]" style={{ color: 'var(--qw-crux)' }}>
              {c.caseId.slice(0, 8)}
            </span>
            <div className="min-w-0">
              <div className="mb-1.5 font-medium">{c.name ?? c.caseId}</div>
              <div
                className="font-serif text-[11.5px] italic leading-[1.5]"
                style={{ color: 'var(--qw-fg-muted)' }}
              >
                {typeof c.input === 'object' && c.input != null
                  ? JSON.stringify(c.input)
                  : String(c.input ?? '')}
              </div>
            </div>
            <div className="font-serif text-[12.5px] leading-[1.55]">
              <Icon
                name="check"
                size={11}
                color="var(--qw-ok)"
                className="mr-1 inline-block align-middle"
              />
              {c.expected != null
                ? typeof c.expected === 'object'
                  ? JSON.stringify(c.expected)
                  : String(c.expected)
                : '—'}
            </div>
            <div className="flex flex-wrap gap-1">
              {(c.tags ?? []).map((t) => (
                <Chip key={t} tone="muted">
                  {t}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </div>
    </QwShell>
  )
}
