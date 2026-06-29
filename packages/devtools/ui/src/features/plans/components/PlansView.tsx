/**
 * Plans & Tasks route — overview + plan detail.
 *
 * Visual contract: `v4-library.jsx::V4Plans` (overview) and
 * `v4-library-detail.jsx::V4PlanDetail` (detail).
 *
 * Data contract: `/api/plans`, `/api/plans/{planId}`. Shapes in
 * `types.ts` (`PlanSummary`, `PlanDetail`, `PlanTask`, `PlanVersion`,
 * `PlanEventRecord`).
 *
 * Backend rule honored: missing optional fields = "not captured yet".
 * Columns hide themselves when the underlying field is absent. Never
 * invent zeros, durations, models, or trace ids.
 */

import { useMemo, useState } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { navTarget } from '@/app/navigation/navTarget'
import { Btn, Chip, Kpi, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { Checkbox, EmptyHint, ErrorBanner, KindBadge, ProgressBar } from './PlanAtoms'
import { usePrefetchPlan } from '@/shared/hooks/usePrefetch'
import { PlanDetailScreen } from './PlanDetailScreen'
import { useConnected } from '@/app/runtime/runtimeStore'
import { useNavigation } from '@/app/navigation/useNavigation'
import { usePlan, usePlansSuspense } from '@/shared/hooks/useLibraryApi'
import {
  eventTone,
  fmtDuration,
  fmtRelative,
  fmtTime,
  pickActivePlan,
  planStatusTone,
  shortBreadcrumbId,
  shortTrace,
  taskStatusTone,
  totalActive,
} from '@/features/plans/lib/plan-format'
import type { PlanDetail, PlanEventRecord, PlanSummary, PlanTask, PlanVersion } from '@/types'

// ─── Router ─────────────────────────────────────────────────────────

type PlanStatusTab = 'active' | 'suspended' | 'completed' | 'discarded'

export function PlansView({ planId }: { planId?: string }) {
  if (planId) return <PlanDetailScreen planId={planId} />
  return <PlansOverview />
}

// ─── Overview ───────────────────────────────────────────────────────

function PlansOverview() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  // Suspends on first paint — caught by App-level Suspense.
  const list = usePlansSuspense()
  const [statusTab, setStatusTab] = useState<PlanStatusTab>('active')

  const buckets = useMemo(() => {
    const b: Record<PlanStatusTab, PlanSummary[]> = {
      active: [],
      suspended: [],
      completed: [],
      discarded: [],
    }
    for (const p of list) {
      if (p.status === 'active' || p.status === 'in_progress') b.active.push(p)
      else if (p.status === 'suspended') b.suspended.push(p)
      else if (p.status === 'completed') b.completed.push(p)
      else if (p.status === 'discarded') b.discarded.push(p)
      else b.active.push(p)
    }
    return b
  }, [list])

  const filtered = buckets[statusTab]
  const featured = useMemo(() => pickActivePlan(filtered) ?? pickActivePlan(list), [filtered, list])
  const featuredDetail = usePlan(featured?.id)

  // Featured plan detail powers the "Avg task dur" KPI (and the
  // featured card body + event timeline). usePlan above already loads
  // the most recent active plan's detail; reuse it here.
  const kpis = useMemo(() => {
    let pending = 0
    let inProgress = 0
    let doneRecent = 0
    let totalTasks = 0
    for (const p of buckets.active) {
      const c = p.taskCounts
      if (!c) continue
      pending += c.pending
      inProgress += c.inProgress
      doneRecent += c.done
      totalTasks += c.done + c.inProgress + c.pending
    }
    // Avg + p99 task duration across the featured plan's tasks.
    const featuredTasks = featuredDetail.data?.tasks ?? []
    const taskDurs = featuredTasks
      .map((t) => (typeof t.durationMs === 'number' ? t.durationMs : null))
      .filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
    let avgDur: number | null = null
    let p99Dur: number | null = null
    if (taskDurs.length > 0) {
      avgDur = taskDurs.reduce((a, b) => a + b, 0) / taskDurs.length
      const sorted = [...taskDurs].sort((a, b) => a - b)
      p99Dur = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1]
    }
    return {
      activeCount: buckets.active.length,
      pending,
      inProgress,
      doneRecent,
      totalTasks,
      avgDur,
      p99Dur,
    }
  }, [buckets, featuredDetail.data])

  return (
    <QwShell
      activeView="library-plans"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Library / Plans"
      title="Plans & tasks"
      subtitle={
        list.length === 0
          ? 'No plans observed yet'
          : `${buckets.active.length} active · ${buckets.suspended.length} suspended · ${buckets.completed.length} completed`
      }
      connected={connected}
      actions={
        <>
          <Btn size="sm" icon={<Icon name="diff" size={11} />} disabled title="Diff versions — pending backend">
            Diff versions
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            icon={<Icon name="check" size={11} />}
            disabled
            title="Approve plan — pending backend"
          >
            Approve plan
          </Btn>
        </>
      }
      tabs={[
        {
          label: 'Active',
          count: buckets.active.length,
          iconName: 'play',
          active: statusTab === 'active',
          onClick: () => setStatusTab('active'),
        },
        {
          label: 'Suspended',
          count: buckets.suspended.length,
          iconName: 'clock',
          active: statusTab === 'suspended',
          onClick: () => setStatusTab('suspended'),
        },
        {
          label: 'Completed',
          count: buckets.completed.length,
          iconName: 'check',
          active: statusTab === 'completed',
          onClick: () => setStatusTab('completed'),
        },
        {
          label: 'Discarded',
          count: buckets.discarded.length,
          active: statusTab === 'discarded',
          onClick: () => setStatusTab('discarded'),
        },
      ]}
    >
      <div className="mx-auto w-full max-w-7xl px-8 py-6">
        {/* KPI strip */}
        <div className="mb-6 grid grid-cols-5 gap-3">
          <Kpi
            label="Active plans"
            value={String(kpis.activeCount)}
            sublabel={
              featured?.version != null
                ? `v${featured.version}${featured.lastUpdatedAt ? ` · ${fmtRelative(featured.lastUpdatedAt)}` : ''}`
                : undefined
            }
          />
          <Kpi
            label="Tasks pending"
            value={kpis.pending.toLocaleString()}
            sublabel={kpis.pending === 0 ? '0 blocked' : undefined}
          />
          <Kpi label="In progress" value={kpis.inProgress.toLocaleString()} />
          <Kpi
            label="Done"
            value={kpis.doneRecent.toLocaleString()}
            sublabel={kpis.totalTasks > 0 ? `of ${kpis.totalTasks}` : undefined}
          />
          <Kpi
            label="Avg task dur"
            value={kpis.avgDur != null ? (fmtDuration(kpis.avgDur) ?? '—') : '—'}
            sublabel={kpis.p99Dur != null ? `P99 · ${fmtDuration(kpis.p99Dur)}` : undefined}
          />
        </div>

        {list.length === 0 ? (
          <EmptyHint>
            No plans have been observed yet. They appear here as soon as your app creates a plan through the Crux plan
            primitive.
          </EmptyHint>
        ) : filtered.length === 0 ? (
          <EmptyHint>No {statusTab} plans.</EmptyHint>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)' }}>
            {/* Left column: featured plan card + task list */}
            <div className="flex min-w-0 flex-col gap-3.5">
              {featured && (
                <FeaturedPlanCard
                  plan={featured}
                  detail={featuredDetail.data ?? null}
                  onOpen={() => navigate({ view: 'library-plans', planId: featured.id })}
                />
              )}
              {featured && (
                <TaskListCard
                  plan={featuredDetail.data ?? ({ ...featured, tasks: [] } as PlanDetail)}
                  onOpen={() => navigate({ view: 'library-plans', planId: featured.id })}
                />
              )}
              {/* Other plans list */}
              {filtered.length > 1 && (
                <OtherPlansList
                  plans={filtered.filter((p) => p.id !== featured?.id)}
                  onOpen={(id) => navigate({ view: 'library-plans', planId: id })}
                />
              )}
            </div>

            {/* Right column: event timeline */}
            <EventTimelinePanel
              events={featuredDetail.data?.events ?? []}
              loading={featuredDetail.loading && !featuredDetail.data}
            />
          </div>
        )}
      </div>
    </QwShell>
  )
}

// ─── Featured plan card ─────────────────────────────────────────────

function FeaturedPlanCard({
  plan,
  detail,
  onOpen,
}: {
  plan: PlanSummary
  detail: PlanDetail | null
  onOpen: () => void
}) {
  const versions = detail?.versions ?? []
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-crux-line)' }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-opacity hover:opacity-95"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-crux-soft)',
        }}
      >
        <KindBadge name="tasks" color="var(--qw-crux)" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className="min-w-0 truncate font-mono text-[11px]"
              style={{ color: 'var(--qw-crux)' }}
              title={plan.id}
            >
              {plan.id}
            </span>
            {plan.version != null && (
              <Chip tone="crux" mono>
                v{plan.version}
              </Chip>
            )}
            <Chip tone={planStatusTone(plan.status)} dot>
              {plan.status}
            </Chip>
            <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {plan.versionCount != null ? `${plan.versionCount} version${plan.versionCount === 1 ? '' : 's'}` : ''}
              {plan.lastUpdatedAt ? ` · last ${fmtTime(plan.lastUpdatedAt) ?? fmtRelative(plan.lastUpdatedAt)}` : ''}
            </span>
          </div>
          {plan.title && (
            <div
              className="text-[16px] font-semibold tracking-[-0.01em] leading-[1.35]"
              style={{
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden',
              }}
              title={plan.title}
            >
              {plan.title}
            </div>
          )}
        </div>
      </button>

      <div className="grid gap-5 px-4 py-3.5" style={{ gridTemplateColumns: 'minmax(0, 1fr) 220px' }}>
        {detail?.content || plan.contentPreview ? (
          <p
            className="m-0 text-[13.5px] leading-[1.55]"
            style={{
              color: 'var(--qw-fg)',
              fontFamily: 'var(--qw-serif, Georgia, serif)',
            }}
          >
            {detail?.content ? truncate(detail.content, 480) : plan.contentPreview}
          </p>
        ) : (
          <p className="m-0 text-[12.5px] italic" style={{ color: 'var(--qw-fg-muted)' }}>
            Plan body not captured yet.
          </p>
        )}
        <VersionMiniRail versions={versions} currentVersion={plan.version} />
      </div>
    </div>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max).trimEnd()}…`
}

function VersionMiniRail({
  versions,
  currentVersion,
}: {
  versions: readonly PlanVersion[]
  currentVersion: number | undefined
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: 'var(--qw-fg-faint)' }}>
        Versions
      </div>
      {versions.length === 0 ? (
        <span className="text-[11.5px] italic" style={{ color: 'var(--qw-fg-faint)' }}>
          Not captured yet.
        </span>
      ) : (
        versions.map((v) => (
          <div
            key={v.version}
            className="grid items-center gap-2 py-1"
            style={{
              gridTemplateColumns: '36px minmax(0, 1fr) 38px',
              borderBottom: '1px dashed var(--qw-border)',
            }}
          >
            <Chip tone={v.version === currentVersion ? 'crux' : 'muted'} mono>
              v{v.version}
            </Chip>
            <div className="min-w-0">
              <div className="truncate text-[11.5px]" style={{ color: 'var(--qw-fg)' }} title={v.summary ?? undefined}>
                {v.summary ?? '—'}
              </div>
              {v.author && (
                <div className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {v.author}
                </div>
              )}
            </div>
            <span className="text-right font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {fmtTime(v.timestamp) ?? '—'}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Task list card ─────────────────────────────────────────────────

function TaskListCard({ plan, onOpen }: { plan: PlanDetail; onOpen: () => void }) {
  const tasks = plan.tasks ?? []
  const counts = useMemo(() => {
    let done = 0
    let inProgress = 0
    let pending = 0
    let removed = 0
    for (const t of tasks) {
      if (t.status === 'completed') done++
      else if (t.status === 'in_progress') inProgress++
      else if (t.status === 'pending') pending++
      else if (t.status === 'removed') removed++
    }
    return { done, inProgress, pending, removed }
  }, [tasks])

  // Build parent → children map.
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
  const countsLabel = [
    counts.done > 0 ? `${counts.done} done` : null,
    counts.inProgress > 0 ? `${counts.inProgress} in progress` : null,
    counts.pending > 0 ? `${counts.pending} pending` : null,
    counts.removed > 0 ? `${counts.removed} removed` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
        }}
      >
        <Icon name="list" size={14} color="var(--qw-fg-muted)" />
        <span className="text-[13px] font-semibold">Task list ·</span>
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 truncate font-mono text-[11.5px] transition-opacity hover:opacity-80"
          style={{ color: 'var(--qw-crux)' }}
          title={plan.id}
        >
          {plan.id}
        </button>
        <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {tasks.length === 0 ? '0 tasks' : countsLabel || `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {tasks.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          <div
            className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            No tasks captured yet
          </div>
          Tasks appear here when this plan's
          <span className="font-mono"> tasks() </span>
          starts emitting <span className="font-mono">task.added</span> events at runtime.
        </div>
      ) : (
        <>
          <TaskTableHeader />
          {roots.map((t) => (
            <TaskRowGroup key={t.id} task={t} byParent={byParent} />
          ))}
        </>
      )}
    </div>
  )
}

function TaskTableHeader() {
  return (
    <div
      className="grid items-center gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
      style={{
        gridTemplateColumns: '24px 110px minmax(0, 1fr) 130px 130px auto',
        color: 'var(--qw-fg-faint)',
        borderBottom: '1px solid var(--qw-border)',
      }}
    >
      <div />
      <div>status</div>
      <div>task</div>
      <div>progress</div>
      <div>assignee</div>
      <div className="text-right">dur</div>
    </div>
  )
}

function TaskRowGroup({
  task,
  byParent,
  depth = 0,
}: {
  task: PlanTask
  byParent: Map<string | null, PlanTask[]>
  depth?: number
}) {
  const children = byParent.get(task.id) ?? []
  return (
    <>
      <TaskRow task={task} depth={depth} />
      {children.map((c) => (
        <TaskRowGroup key={c.id} task={c} byParent={byParent} depth={depth + 1} />
      ))}
    </>
  )
}

function TaskRow({ task, depth }: { task: PlanTask; depth: number }) {
  const m = taskStatusTone(task.status)
  const isSub = depth > 0
  const removed = task.status === 'removed'
  const pct = task.progress != null ? Math.round(task.progress * 100) : null
  const progressColor =
    task.status === 'completed'
      ? 'var(--qw-ok)'
      : task.status === 'in_progress'
        ? 'var(--qw-crux)'
        : 'var(--qw-fg-faint)'
  const progressLabel = task.progressMessage ?? (pct != null ? `${pct}%` : '—')
  return (
    <div
      className="grid items-center gap-2.5 px-4 py-2.5 text-[12.5px]"
      style={{
        gridTemplateColumns: '24px 110px minmax(0, 1fr) 130px 130px auto',
        borderBottom: '1px solid var(--qw-border)',
        background: isSub ? 'var(--qw-bg-muted)' : 'transparent',
        opacity: removed ? 0.5 : 1,
      }}
    >
      <Checkbox done={task.status === 'completed'} />
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
      <div className="flex min-w-0 items-center gap-2" title={task.progressMessage}>
        <ProgressBar percent={pct ?? 0} color={progressColor} />
        <span className="min-w-[26px] truncate text-right font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {progressLabel}
        </span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span
          className="truncate font-mono text-[11.5px]"
          style={{ color: 'var(--qw-fg)' }}
          title={task.assignee ?? undefined}
        >
          {task.assignee ?? '—'}
        </span>
        {task.model && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {task.model}
          </span>
        )}
      </div>
      <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {fmtDuration(task.durationMs) ?? '—'}
      </span>
    </div>
  )
}

// ─── Other plans list (compact rows) ────────────────────────────────

function OtherPlansList({ plans, onOpen }: { plans: readonly PlanSummary[]; onOpen: (id: string) => void }) {
  const prefetch = usePrefetchPlan()
  if (plans.length === 0) return null
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
        }}
      >
        <Icon name="tasks" size={12} color="var(--qw-fg-muted)" />
        <span className="text-[12px] font-semibold">Other plans</span>
        <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {plans.length}
        </span>
      </div>
      {plans.map((p, i) => {
        const tot = totalActive(p.taskCounts)
        const done = p.taskCounts?.done ?? 0
        const pct = tot > 0 ? Math.round((done / tot) * 100) : 0
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.id)}
            onMouseEnter={() => prefetch(p.id)}
            onFocus={() => prefetch(p.id)}
            className="grid w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-(--qw-bg-muted)"
            style={{
              gridTemplateColumns: 'minmax(0, 1fr) 90px 110px 70px',
              borderBottom: i === plans.length - 1 ? 'none' : '1px solid var(--qw-border)',
            }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] font-medium">{p.id}</span>
                {p.version != null && (
                  <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    v{p.version}
                  </span>
                )}
              </div>
              {p.title && (
                <div className="truncate text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {p.title}
                </div>
              )}
            </div>
            <Chip tone={planStatusTone(p.status)} dot>
              {p.status}
            </Chip>
            {tot > 0 ? (
              <div className="flex items-center gap-1.5">
                <ProgressBar percent={pct} color="var(--qw-crux)" />
                <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {done}/{tot}
                </span>
              </div>
            ) : (
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                —
              </span>
            )}
            <span className="text-right font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {fmtRelative(p.lastUpdatedAt) ?? '—'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Event timeline (vertical, right column on overview) ────────────

function EventTimelinePanel({ events, loading }: { events: readonly PlanEventRecord[]; loading: boolean }) {
  return (
    <div
      className="self-start overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
        }}
      >
        <Icon name="clock" size={14} color="var(--qw-fg-muted)" />
        <span className="text-[13px] font-semibold">Plan &amp; task events</span>
        <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {events.length} events
        </span>
      </div>
      <div className="px-4 py-3">
        {loading ? (
          <div className="py-4 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            Loading…
          </div>
        ) : events.length === 0 ? (
          <div className="py-4 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            No events recorded yet.
          </div>
        ) : (
          events.map((e, i) => <TimelineRow key={e.eventId} event={e} isLast={i === events.length - 1} />)
        )}
      </div>
    </div>
  )
}

function TimelineRow({ event, isLast }: { event: PlanEventRecord; isLast: boolean }) {
  const t = eventTone(event.kind)
  return (
    <div className="grid items-start gap-2.5 py-1.5" style={{ gridTemplateColumns: '54px 18px minmax(0, 1fr)' }}>
      <span className="pt-1 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
        {fmtTime(event.timestamp) ?? '—'}
      </span>
      <div className="relative flex justify-center pt-1.5">
        <span
          className="z-[1] inline-block size-2 rounded-full"
          style={{
            background: t.color,
            boxShadow: `0 0 0 3px var(--qw-bg-elev), 0 0 0 4px color-mix(in oklab, ${t.color} 30%, transparent)`,
          }}
        />
        {!isLast && (
          <span
            className="absolute left-1/2 top-3.5 w-px"
            style={{
              background: 'var(--qw-border)',
              bottom: '-10px',
              transform: 'translateX(-50%)',
            }}
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.04em]" style={{ color: t.color }}>
          {event.kind}
        </div>
        <div className="text-[12px]" style={{ color: 'var(--qw-fg)' }}>
          {event.label ?? <span style={{ color: 'var(--qw-fg-muted)' }}>—</span>}
          {event.agent && (
            <span className="ml-1.5 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              · {event.agent}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
