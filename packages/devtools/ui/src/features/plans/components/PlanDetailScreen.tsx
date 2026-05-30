import { useMemo, useState } from 'react'
import { Streamdown } from 'streamdown'
import { QwShell } from '@/qw/shell/QwShell'
import { navTarget } from '@/app/navigation/navTarget'
import { Btn, Chip, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useConnected } from '@/app/runtime/runtimeStore'
import { useNavigation } from '@/app/navigation/useNavigation'
import { usePlanSuspense } from '@/shared/hooks/useLibraryApi'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard, SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'
import {
  eventTone,
  fmtDuration,
  fmtRelative,
  fmtTime,
  planStatusTone,
  shortBreadcrumbId,
  shortTrace,
  taskStatusTone,
} from '@/features/plans/lib/plan-format'
import type { PlanDetail, PlanEventRecord, PlanTask, PlanVersion } from '@/types'
import { Checkbox, EmptyHint, ErrorBanner, KindBadge, PendingBackend, ProgressBar } from './PlanAtoms'

// ─── Detail screen ──────────────────────────────────────────────────

type DetailTab = 'plan' | 'tasks' | 'versions' | 'events'

export function PlanDetailScreen({ planId }: { planId: string }) {
  const { navigate } = useNavigation()
  const connected = useConnected()
  // Suspends on first paint — caught by the App-level Suspense.
  const data = usePlanSuspense(planId)
  const [tab, setTab] = useState<DetailTab>('plan')

  const tasks = data.tasks ?? []
  const versions = data.versions ?? []
  const events = data.events ?? []

  return (
    <QwShell
      activeView="library-plans"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Library / Plans / ${shortBreadcrumbId(planId)}`}
      title={data.title || planId}
      subtitle={buildDetailSubtitle(data)}
      connected={connected}
      actions={
        <>
          <Btn variant="ghost" size="sm" onClick={() => navigate({ view: 'library-plans' })}>
            ← All plans
          </Btn>
          <Btn size="sm" icon={<Icon name="diff" size={11} />} disabled title="Diff versions — pending backend">
            Diff
          </Btn>
          <Btn size="sm" icon={<Icon name="loop" size={11} />} disabled title="Resume — pending backend">
            Resume
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            icon={<Icon name="check" size={11} />}
            disabled
            title="Approve — pending backend"
          >
            Approve
          </Btn>
        </>
      }
      tabs={[
        { label: 'Plan', active: tab === 'plan', onClick: () => setTab('plan') },
        {
          label: 'Tasks',
          count: tasks.length || null,
          iconName: 'list',
          active: tab === 'tasks',
          onClick: () => setTab('tasks'),
        },
        {
          label: 'Versions',
          count: versions.length || null,
          active: tab === 'versions',
          onClick: () => setTab('versions'),
        },
        {
          label: 'Events',
          count: events.length || null,
          iconName: 'clock',
          active: tab === 'events',
          onClick: () => setTab('events'),
        },
      ]}
    >
      <div className="mx-auto w-full max-w-7xl px-8 py-6">
        <SectionBoundary
          title="Plan"
          resetKey={`${planId}:${tab}`}
          invalidateKeys={[qk.plans.plan(planId)]}
          fallback={
            <div className="flex flex-col gap-4">
              <SkeletonCard bodyLines={3} />
              <SkeletonRows rows={6} rowHeight={36} />
            </div>
          }
        >
          {tab === 'plan' && <PlanContentTab plan={data} />}
          {tab === 'tasks' && <PlanTasksTab plan={data} />}
          {tab === 'versions' && <PlanVersionsTab versions={versions} />}
          {tab === 'events' && <PlanEventsTab events={events} />}
        </SectionBoundary>
      </div>
    </QwShell>
  )
}

function buildDetailSubtitle(d: PlanDetail): string {
  const parts: string[] = []
  parts.push(d.id)
  if (d.version != null) parts.push(`v${d.version}`)
  parts.push(d.status)
  if (d.startedAt) parts.push(`started ${fmtRelative(d.startedAt)}`)
  return parts.join(' · ')
}

// ─── Detail · Plan tab (content + version rail + diff) ──────────────

function PlanContentTab({ plan }: { plan: PlanDetail }) {
  const [mode, setMode] = useState<'pretty' | 'raw'>('pretty')
  const body = plan.content ?? plan.contentPreview ?? ''
  // Older plan records return `content` identical to `contentPreview` (both
  // capped at 500 chars). Detect that case so we can warn the user this is
  // a truncated record, not the full plan body.
  const isPreviewOnly =
    (!plan.content && Boolean(plan.contentPreview)) ||
    (plan.content != null &&
      plan.contentPreview != null &&
      plan.content === plan.contentPreview &&
      plan.content.length <= 500)
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-crux-line)' }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{
            borderBottom: '1px solid var(--qw-border)',
            background: 'var(--qw-crux-soft)',
          }}
        >
          <KindBadge name="tasks" color="var(--qw-crux)" size={20} />
          <span className="min-w-0 truncate font-mono text-[12px]" style={{ color: 'var(--qw-crux)' }} title={plan.id}>
            {plan.id}
          </span>
          {plan.version != null && (
            <Chip tone="crux" mono className="shrink-0">
              v{plan.version}
            </Chip>
          )}
          <Chip tone={planStatusTone(plan.status)} dot className="shrink-0">
            {plan.status}
          </Chip>
          {/* Pretty/Raw toggle — segmented control on the right of the header. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {plan.author && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {plan.author}
              </span>
            )}
            {body && <ContentModeToggle mode={mode} onChange={setMode} />}
          </div>
        </div>
        <div className="px-6 py-5">
          {plan.title && (
            <h2
              className="m-0 mb-3 text-[19px] font-semibold tracking-[-0.015em]"
              style={{
                fontFamily: 'var(--qw-serif, Georgia, serif)',
                color: 'var(--qw-fg)',
              }}
            >
              {plan.title}
            </h2>
          )}
          {body ? (
            mode === 'pretty' ? (
              <div
                className="qw-markdown text-[14px] leading-[1.65]"
                style={{
                  color: 'var(--qw-fg)',
                  fontFamily: 'var(--qw-serif, Georgia, serif)',
                }}
              >
                <Streamdown>{body}</Streamdown>
              </div>
            ) : (
              <div
                className="whitespace-pre-wrap text-[14px] leading-[1.65]"
                style={{
                  color: 'var(--qw-fg)',
                  fontFamily: 'var(--qw-serif, Georgia, serif)',
                }}
              >
                {body}
              </div>
            )
          ) : (
            <PendingBackend
              title="Plan body not captured"
              body="The backend hasn't shipped the plan's full content for this version yet."
            />
          )}
          {isPreviewOnly && body && (
            <div
              className="mt-3 text-[11.5px]"
              style={{
                color: 'var(--qw-fg-faint)',
                fontFamily: 'var(--qw-sans)',
              }}
            >
              Showing preview — older plan records cap content at the first 500 chars. New runs ship full content.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <VersionsCard versions={plan.versions ?? []} currentVersion={plan.version} />
        <DiffStubCard versions={plan.versions ?? []} currentVersion={plan.version} />
      </div>
    </div>
  )
}

function ContentModeToggle({ mode, onChange }: { mode: 'pretty' | 'raw'; onChange: (m: 'pretty' | 'raw') => void }) {
  return (
    <div
      className="flex overflow-hidden rounded-[5px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
      }}
    >
      {(['pretty', 'raw'] as const).map((m) => {
        const on = mode === m
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className="px-2 py-[2px] font-mono text-[10.5px] transition-colors"
            style={{
              background: on ? 'var(--qw-crux-soft)' : 'transparent',
              color: on ? 'var(--qw-crux)' : 'var(--qw-fg-muted)',
              fontWeight: on ? 600 : 450,
            }}
          >
            {m}
          </button>
        )
      })}
    </div>
  )
}

function VersionsCard({
  versions,
  currentVersion,
}: {
  versions: readonly PlanVersion[]
  currentVersion: number | undefined
}) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2.5"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
        }}
      >
        <span className="size-[7px] rounded-full" style={{ background: 'var(--qw-crux)' }} />
        <span className="text-[12px] font-semibold">Versions</span>
        <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {versions.length}
        </span>
      </div>
      {versions.length === 0 ? (
        <PendingBackend
          title="Versions not captured"
          body="The backend hasn't shipped version snapshots for this plan yet."
        />
      ) : (
        versions.map((v, i) => (
          <div
            key={v.version}
            className="px-3.5 py-2.5"
            style={{
              borderBottom: i === versions.length - 1 ? 'none' : '1px solid var(--qw-border)',
              background: v.version === currentVersion ? 'var(--qw-crux-soft)' : 'transparent',
            }}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Chip tone={v.version === currentVersion ? 'crux' : 'muted'} mono>
                v{v.version}
              </Chip>
              {v.timestamp && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {fmtTime(v.timestamp) ?? '—'}
                </span>
              )}
              {v.author && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  · {v.author}
                </span>
              )}
              {v.diff && (
                <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  <span style={{ color: 'var(--qw-ok)' }}>+{v.diff.added}</span>
                  {' / '}
                  <span style={{ color: 'var(--qw-danger)' }}>-{v.diff.removed}</span>
                </span>
              )}
            </div>
            {v.summary && (
              <div className="text-[12px]" style={{ color: 'var(--qw-fg)' }}>
                {v.summary}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

function DiffStubCard({
  versions,
  currentVersion,
}: {
  versions: readonly PlanVersion[]
  currentVersion: number | undefined
}) {
  if (versions.length < 2 || currentVersion == null) return null
  const prev = versions.find((v) => v.version === currentVersion - 1)
  if (!prev) return null
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2.5"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
        }}
      >
        <span className="size-[7px] rounded-full" style={{ background: 'var(--qw-warn)' }} />
        <span className="text-[12px] font-semibold">
          Diff · v{prev.version} → v{currentVersion}
        </span>
      </div>
      <PendingBackend
        title="Per-version diff not captured"
        body="The backend hasn't shipped content diffs between plan versions yet."
      />
    </div>
  )
}

// ─── Detail · Tasks tab ─────────────────────────────────────────────

function PlanTasksTab({ plan }: { plan: PlanDetail }) {
  const tasks = plan.tasks ?? []
  if (tasks.length === 0) {
    return <EmptyHint>No tasks captured for this plan yet.</EmptyHint>
  }
  const byParent = useMemo(() => {
    const m = new Map<string | null, PlanTask[]>()
    for (const t of tasks) {
      const key = t.parentId ?? null
      const bucket = m.get(key) ?? []
      bucket.push(t)
      m.set(key, bucket)
    }
    return m
  }, [tasks])
  const roots = byParent.get(null) ?? []
  const counts = useMemo(() => {
    let done = 0,
      inProgress = 0,
      pending = 0,
      removed = 0
    for (const t of tasks) {
      if (t.status === 'done') done++
      else if (t.status === 'in_progress') inProgress++
      else if (t.status === 'pending') pending++
      else if (t.status === 'removed') removed++
    }
    return { done, inProgress, pending, removed }
  }, [tasks])
  const hasSpan = tasks.some((t) => t.spanId)
  const hasTrace = tasks.some((t) => t.traceId)
  return (
    <section>
      <SectionHead
        eyebrow={`Tasks · ${tasks.length}`}
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {[
              counts.done > 0 ? `${counts.done} done` : null,
              counts.inProgress > 0 ? `${counts.inProgress} in progress` : null,
              counts.pending > 0 ? `${counts.pending} pending` : null,
              counts.removed > 0 ? `${counts.removed} removed` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        }
      />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        <div
          className="grid items-center gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
          style={{
            gridTemplateColumns: [
              '24px',
              '60px',
              '110px',
              'minmax(0, 1fr)',
              '130px',
              '130px',
              hasSpan ? 'minmax(0, 160px)' : '',
              ...(hasTrace ? ['70px'] : []),
              '50px',
            ]
              .filter(Boolean)
              .join(' '),
            color: 'var(--qw-fg-faint)',
            borderBottom: '1px solid var(--qw-border)',
            background: 'var(--qw-bg-muted)',
          }}
        >
          <div />
          <div>id</div>
          <div>status</div>
          <div>task</div>
          <div>progress</div>
          <div>assignee</div>
          {hasSpan && <div>source span</div>}
          {hasTrace && <div className="text-right">trace</div>}
          <div className="text-right">dur</div>
        </div>
        {roots.map((t) => (
          <TaskRowDetailGroup key={t.id} task={t} byParent={byParent} hasSpan={hasSpan} hasTrace={hasTrace} />
        ))}
      </div>
    </section>
  )
}

function TaskRowDetailGroup({
  task,
  byParent,
  depth = 0,
  hasSpan,
  hasTrace,
}: {
  task: PlanTask
  byParent: Map<string | null, PlanTask[]>
  depth?: number
  hasSpan: boolean
  hasTrace: boolean
}) {
  const children = byParent.get(task.id) ?? []
  return (
    <>
      <TaskRowDetail task={task} depth={depth} hasSpan={hasSpan} hasTrace={hasTrace} />
      {children.map((c) => (
        <TaskRowDetailGroup
          key={c.id}
          task={c}
          byParent={byParent}
          depth={depth + 1}
          hasSpan={hasSpan}
          hasTrace={hasTrace}
        />
      ))}
    </>
  )
}

function TaskRowDetail({
  task,
  depth,
  hasSpan,
  hasTrace,
}: {
  task: PlanTask
  depth: number
  hasSpan: boolean
  hasTrace: boolean
}) {
  const m = taskStatusTone(task.status)
  const isSub = depth > 0
  const removed = task.status === 'removed'
  const pct = task.progress != null ? Math.round(task.progress * 100) : null
  const progressColor =
    task.status === 'done' ? 'var(--qw-ok)' : task.status === 'in_progress' ? 'var(--qw-crux)' : 'var(--qw-fg-faint)'
  const cols = [
    '24px',
    '60px',
    '110px',
    'minmax(0, 1fr)',
    '130px',
    '130px',
    hasSpan ? 'minmax(0, 160px)' : '',
    hasTrace ? '70px' : '',
    '50px',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className="grid items-center gap-2.5 px-4 py-2.5 text-[12.5px]"
      style={{
        gridTemplateColumns: cols,
        borderBottom: '1px solid var(--qw-border)',
        background: isSub ? 'var(--qw-bg-muted)' : 'transparent',
        opacity: removed ? 0.5 : 1,
      }}
    >
      <Checkbox done={task.status === 'done'} />
      <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-crux)' }}>
        {task.id}
      </span>
      <Chip tone={m} dot>
        {task.status === 'in_progress' ? 'in progress' : task.status}
      </Chip>
      <span
        className="min-w-0 truncate"
        style={{
          paddingLeft: depth > 0 ? 14 : 0,
          textDecoration: removed ? 'line-through' : 'none',
          fontWeight: task.status === 'in_progress' ? 500 : 400,
        }}
        title={task.label}
      >
        {task.label}
      </span>
      <div className="flex items-center gap-2">
        <ProgressBar percent={pct ?? 0} color={progressColor} />
        <span className="min-w-[26px] text-right font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {pct != null ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-fg)' }}>
          {task.assignee ?? '—'}
        </span>
        {task.model && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {task.model}
          </span>
        )}
      </div>
      {hasSpan && (
        <span
          className="truncate font-mono text-[10.5px]"
          style={{ color: 'var(--qw-fg-muted)' }}
          title={task.spanId ?? undefined}
        >
          {task.spanId ?? '—'}
        </span>
      )}
      {hasTrace && (
        <span className="text-right font-mono text-[10.5px]" style={{ color: 'var(--qw-crux)' }}>
          {shortTrace(task.traceId) ?? '—'}
        </span>
      )}
      <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {fmtDuration(task.durationMs) ?? '—'}
      </span>
    </div>
  )
}

// ─── Detail · Versions tab ──────────────────────────────────────────

function PlanVersionsTab({ versions }: { versions: readonly PlanVersion[] }) {
  if (versions.length === 0) {
    return (
      <PendingBackend
        title="Version history not captured"
        body="The backend hasn't shipped version snapshots for this plan yet."
      />
    )
  }
  return (
    <section>
      <SectionHead eyebrow={`Versions · ${versions.length}`} />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        {versions.map((v, i) => (
          <div
            key={v.version}
            className="px-4 py-3"
            style={{
              borderBottom: i === versions.length - 1 ? 'none' : '1px solid var(--qw-border)',
            }}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Chip tone="crux" mono>
                v{v.version}
              </Chip>
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {fmtRelative(v.timestamp) ?? '—'}
              </span>
              {v.author && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  · {v.author}
                </span>
              )}
              {v.diff && (
                <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  <span style={{ color: 'var(--qw-ok)' }}>+{v.diff.added}</span>
                  {' / '}
                  <span style={{ color: 'var(--qw-danger)' }}>-{v.diff.removed}</span>
                </span>
              )}
            </div>
            {v.summary && (
              <div className="text-[12.5px]" style={{ color: 'var(--qw-fg)' }}>
                {v.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Detail · Events tab ────────────────────────────────────────────

function PlanEventsTab({ events }: { events: readonly PlanEventRecord[] }) {
  if (events.length === 0) {
    return <EmptyHint>No events recorded for this plan yet.</EmptyHint>
  }
  const hasAgent = events.some((e) => e.agent)
  return (
    <section>
      <SectionHead
        eyebrow={`Events · ${events.length}`}
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            live
          </span>
        }
      />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        {events.map((e, i) => {
          const t = eventTone(e.kind)
          const cols = ['80px', '24px', '160px', hasAgent ? '120px' : '', 'minmax(0, 1fr)'].filter(Boolean).join(' ')
          return (
            <div
              key={e.eventId}
              className="grid items-center gap-3 px-4 py-2 font-mono text-[11.5px]"
              style={{
                gridTemplateColumns: cols,
                borderBottom: i === events.length - 1 ? 'none' : '1px solid var(--qw-border)',
              }}
            >
              <span style={{ color: 'var(--qw-fg-faint)' }}>{fmtTime(e.timestamp) ?? '—'}</span>
              <span
                className="justify-self-center"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: t.color,
                  boxShadow: `0 0 0 3px var(--qw-bg-elev), 0 0 0 4px color-mix(in oklab, ${t.color} 30%, transparent)`,
                }}
              />
              <span style={{ color: t.color }}>{e.kind}</span>
              {hasAgent && <span style={{ color: 'var(--qw-fg-muted)' }}>{e.agent ?? '—'}</span>}
              <span
                className="truncate text-[12.5px]"
                style={{
                  color: 'var(--qw-fg)',
                  fontFamily: 'var(--qw-sans)',
                }}
                title={e.label ?? ''}
              >
                {e.label ?? '—'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
