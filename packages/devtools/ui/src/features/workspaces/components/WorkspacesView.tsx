/**
 * Workspaces route — overview + workspace detail + file inspector.
 *
 * Visual contract: `v4-library.jsx::V4Workspaces` (overview) and
 * `v4-library-detail.jsx::V4WorkspaceDetail` (split-pane detail).
 *
 * Data contract: `/api/workspaces`, `/api/workspaces/{id}`,
 * `/api/workspaces/{id}/files/{path}`. Shapes in `types.ts`.
 *
 * Backend rule honored: missing optional fields = "not captured yet".
 * Columns hide themselves when the underlying field is absent. Never
 * invent zeros, sizes, mimes, or durations.
 */

import { useMemo } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { navTarget } from '@/app/navigation/navTarget'
import { Btn, Chip, Kpi, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useConnected } from '@/app/runtime/runtimeStore'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useWorkspaceDetails, useWorkspaceSuspense, useWorkspacesSuspense } from '@/shared/hooks/useLibraryApi'
import {
  fmtBytes,
  fmtDuration,
  fmtTime,
  shortBreadcrumbId,
  shortTrace,
} from '@/features/workspaces/lib/workspace-format'
import {
  EmptyHint,
  EmptyInline,
  ErrorBanner,
  OpPill,
  PendingBackend,
  Stat,
  TableHeader,
} from '@/features/workspaces/components/WorkspaceAtoms'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard, SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'
import { FileTreePane } from '@/features/workspaces/components/WorkspaceFileTree'
import { FileInspector } from '@/features/workspaces/components/WorkspaceFileInspector'
import type { Workspace, WorkspaceDetail, WorkspaceFileSummary, WorkspaceOpRecord } from '@/types'

// ─── Router ─────────────────────────────────────────────────────────

export function WorkspacesView({ workspaceId, filePath }: { workspaceId?: string; filePath?: string }) {
  if (workspaceId) return <WorkspaceDetailScreen workspaceId={workspaceId} filePath={filePath} />
  return <WorkspacesOverview />
}

// ─── Overview ───────────────────────────────────────────────────────

function WorkspacesOverview() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  // Suspends on first paint — caught by App-level Suspense.
  const list = useWorkspacesSuspense()

  // Parallel-fetch details so we can render file lists per workspace
  // and merge ops across workspaces for the audit trail. Cache shared
  // with `useWorkspace`, so clicking through is a cache hit.
  const detailQueries = useWorkspaceDetails(list.map((w) => w.id))
  const details = useMemo(
    () => detailQueries.map((q) => q.data).filter((d): d is WorkspaceDetail => Boolean(d)),
    [detailQueries],
  )

  const kpis = useMemo(() => {
    let totalFiles = 0
    let totalOps = 0
    let totalErrors = 0
    let totalRuns = 0
    for (const w of list) {
      totalRuns += w.stats?.runs ?? 0
      totalOps += w.stats?.operations ?? 0
      totalErrors += w.stats?.errors ?? 0
    }
    for (const d of details) {
      totalFiles += d.files?.length ?? 0
    }
    return { totalFiles, totalOps, totalErrors, totalRuns }
  }, [list, details])

  const auditOps = useMemo(() => {
    const rows: Array<WorkspaceOpRecord & { workspaceId: string }> = []
    for (const d of details) {
      for (const o of d.recentOps ?? []) {
        rows.push({ ...o, workspaceId: d.id })
      }
    }
    rows.sort((a, b) => b.timestamp - a.timestamp)
    return rows.slice(0, 50)
  }, [details])

  return (
    <QwShell
      activeView="library-workspaces"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Library / Workspaces"
      title="Workspaces"
      subtitle={
        list.length === 0
          ? 'No workspaces observed yet'
          : `${list.length} workspace${list.length === 1 ? '' : 's'} · ${kpis.totalOps.toLocaleString()} ops${kpis.totalErrors > 0 ? ` · ${kpis.totalErrors} error${kpis.totalErrors === 1 ? '' : 's'}` : ''}`
      }
      connected={connected}
      actions={
        <>
          <Btn
            size="sm"
            icon={<Icon name="loop" size={11} />}
            disabled
            title="Tail file ops — backend wiring not yet shipped"
          >
            Tail live
          </Btn>
          <Btn
            size="sm"
            variant="outline"
            icon={<Icon name="arrowDown" size={11} />}
            disabled
            title="Export trail — backend wiring not yet shipped"
          >
            Export trail
          </Btn>
        </>
      }
    >
      <div className="mx-auto w-full max-w-7xl px-8 py-6">
        {/* KPI strip */}
        <div className="mb-6 grid grid-cols-4 gap-3">
          <Kpi
            label="Workspaces"
            value={String(list.length)}
            sublabel={
              kpis.totalRuns > 0 ? `${kpis.totalRuns} run${kpis.totalRuns === 1 ? '' : 's'} touched` : undefined
            }
          />
          <Kpi
            label="Files touched"
            value={kpis.totalFiles.toLocaleString()}
            sublabel={kpis.totalFiles === 0 ? 'no files yet' : undefined}
          />
          <Kpi
            label="Operations"
            value={kpis.totalOps.toLocaleString()}
            sublabel={list.some((w) => w.stats?.p50LatencyMs != null) ? buildLatencySublabel(list) : undefined}
          />
          <Kpi
            label="Errors"
            value={kpis.totalErrors.toLocaleString()}
            sublabel={kpis.totalErrors > 0 ? 'see workspace cards' : 'no failures'}
          />
        </div>

        <SectionHead
          eyebrow="Workspaces"
          right={
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {list.length} of {list.length}
            </span>
          }
        />

        {list.length === 0 ? (
          <EmptyHint>
            No workspaces have been observed yet. They appear here as soon as your app reads o writes any file through a
            Crux workspace.
          </EmptyHint>
        ) : (
          <div className="mb-6 flex flex-col gap-3.5">
            {list.map((w) => {
              const detail = details.find((d) => d.id === w.id)
              return (
                <WorkspaceCard
                  key={w.id}
                  workspace={w}
                  detail={detail}
                  onOpen={() => navigate({ view: 'library-workspaces', workspaceId: w.id })}
                  onOpenFile={(p) => navigate({ view: 'library-workspaces', workspaceId: w.id, filePath: p })}
                />
              )
            })}
          </div>
        )}

        {/* Audit trail */}
        {auditOps.length > 0 && (
          <AuditTrailTable
            ops={auditOps}
            onOpenWorkspace={(id) => navigate({ view: 'library-workspaces', workspaceId: id })}
          />
        )}
      </div>
    </QwShell>
  )
}

function buildLatencySublabel(list: readonly Workspace[]): string | undefined {
  const withP50 = list.filter(
    (w): w is Workspace & { stats: { p50LatencyMs: number } } => typeof w.stats?.p50LatencyMs === 'number',
  )
  if (withP50.length === 0) return undefined
  const avg = withP50.reduce((a, w) => a + w.stats.p50LatencyMs, 0) / withP50.length
  return `P50 ~${Math.round(avg)}ms across workspaces`
}

// ─── Workspace card (overview row) ──────────────────────────────────

function WorkspaceCard({
  workspace,
  detail,
  onOpen,
  onOpenFile,
}: {
  workspace: Workspace
  detail: WorkspaceDetail | undefined
  onOpen: () => void
  onOpenFile: (path: string) => void
}) {
  const errs = workspace.stats?.errors ?? 0
  const files = detail?.files ?? []
  // Group files by mount.
  const filesByMount = useMemo(() => {
    const m = new Map<string, WorkspaceFileSummary[]>()
    for (const f of files) {
      const key = f.mount ?? '(unsourced)'
      const arr = m.get(key) ?? []
      arr.push(f)
      m.set(key, arr)
    }
    return Array.from(m.entries())
  }, [files])

  return (
    <div
      className="overflow-hidden rounded-[10px] border"
      style={{
        background: 'var(--qw-bg-elev)',
        borderColor: 'var(--qw-border)',
        borderLeft: errs > 0 ? '3px solid var(--qw-danger)' : '1px solid var(--qw-border)',
      }}
    >
      {/* Header */}
      <div
        className="grid items-center gap-4 px-4 py-3"
        style={{
          gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) auto',
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
        }}
      >
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2">
            <Icon name="folder" size={14} color="var(--qw-crux)" className="shrink-0" />
            <button
              type="button"
              onClick={onOpen}
              className="truncate font-mono text-[14px] font-semibold transition-opacity hover:opacity-80"
              title={workspace.id}
            >
              {workspace.id}
            </button>
            {errs > 0 && (
              <Chip tone="danger" dot>
                {errs} error{errs === 1 ? '' : 's'}
              </Chip>
            )}
          </div>
          {workspace.namespace && (
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
              namespace · {workspace.namespace}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-5">
          <Stat label="Runs" value={workspace.stats?.runs} />
          <Stat label="Ops" value={workspace.stats?.operations} />
          <Stat label="Errors" value={errs} color={errs > 0 ? 'var(--qw-danger)' : 'var(--qw-fg-faint)'} />
          {workspace.stats?.p50LatencyMs != null && (
            <Stat label="p50" value={fmtDuration(workspace.stats.p50LatencyMs)} />
          )}
          {workspace.stats?.p99LatencyMs != null && (
            <Stat label="p99" value={fmtDuration(workspace.stats.p99LatencyMs)} />
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Btn size="xs" icon={<Icon name="folder" size={10} />} onClick={onOpen}>
            Open
          </Btn>
        </div>
      </div>

      {/* Mounts + files */}
      {filesByMount.length === 0 ? (
        <EmptyInline>{detail ? 'No files touched yet.' : 'Loading files…'}</EmptyInline>
      ) : (
        <div className="flex flex-col">
          {filesByMount.map(([mount, mountFiles], mi) => (
            <div
              key={mount}
              style={{
                borderBottom: mi === filesByMount.length - 1 ? 'none' : '1px solid var(--qw-border)',
              }}
            >
              <div
                className="flex items-center gap-2 px-4 py-2 font-mono text-[11px]"
                style={{
                  background: 'var(--qw-bg)',
                  color: 'var(--qw-fg-muted)',
                  borderBottom: '1px solid var(--qw-border)',
                }}
              >
                <Icon name="folder" size={11} color="var(--qw-fg-faint)" />
                <span style={{ color: 'var(--qw-crux)' }}>{mount}</span>
                <span style={{ color: 'var(--qw-fg-faint)' }}>
                  · {mountFiles.length} file{mountFiles.length === 1 ? '' : 's'}
                </span>
              </div>
              {mountFiles.map((f, i) => (
                <WorkspaceFileRow
                  key={f.path}
                  file={f}
                  last={i === mountFiles.length - 1}
                  onClick={() => onOpenFile(f.path)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkspaceFileRow({ file, last, onClick }: { file: WorkspaceFileSummary; last: boolean; onClick: () => void }) {
  const isErr = file.status === 'err' || file.status === 'denied'
  const hasMime = file.mime != null
  const hasSize = file.size != null
  const hasDur = file.lastOpDurationMs != null
  const hasTime = file.lastOpAt != null
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-(--qw-bg-muted)"
      style={{
        gridTemplateColumns: '24px minmax(0, 1fr) auto auto auto auto auto',
        borderBottom: last ? 'none' : '1px solid var(--qw-border)',
        background: isErr ? 'var(--qw-danger-soft)' : 'transparent',
      }}
    >
      <Icon name="doc" size={12} color={isErr ? 'var(--qw-danger)' : 'var(--qw-fg-faint)'} />
      <div className="min-w-0">
        <span
          className="truncate font-mono text-[12px] font-medium"
          style={{ color: isErr ? 'var(--qw-danger)' : 'var(--qw-fg)' }}
          title={file.path}
        >
          {file.path}
        </span>
        {file.lastError && (
          <div className="mt-0.5 font-mono text-[10.5px]" style={{ color: 'var(--qw-danger)' }}>
            ✕ {file.lastError}
          </div>
        )}
      </div>
      {file.op ? (
        <OpPill op={file.op} />
      ) : (
        <span className="text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          —
        </span>
      )}
      {hasMime && (
        <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {file.mime}
        </span>
      )}
      {hasSize && (
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {fmtBytes(file.size)}
        </span>
      )}
      {hasDur && (
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {fmtDuration(file.lastOpDurationMs)}
        </span>
      )}
      {hasTime && (
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {fmtTime(file.lastOpAt)}
        </span>
      )}
    </button>
  )
}

// ─── Audit trail ────────────────────────────────────────────────────

function AuditTrailTable({
  ops,
  onOpenWorkspace,
}: {
  ops: readonly (WorkspaceOpRecord & { workspaceId: string })[]
  onOpenWorkspace: (id: string) => void
}) {
  const hasDur = ops.some((o) => o.durationMs != null)
  const hasStatus = ops.some((o) => o.status)
  const hasTrace = ops.some((o) => o.traceId)
  return (
    <section>
      <SectionHead
        eyebrow="Audit trail"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            chronological · last {ops.length}
          </span>
        }
      />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        <TableHeader
          cols={[
            { label: 'time', width: '70px' },
            { label: 'op', width: '70px' },
            { label: 'workspace', width: '180px' },
            { label: 'path', width: 'minmax(0, 1fr)' },
            ...(hasDur ? [{ label: 'dur', width: '70px', align: 'right' as const }] : []),
            ...(hasStatus ? [{ label: 'status', width: '70px', align: 'right' as const }] : []),
            ...(hasTrace ? [{ label: 'trace', width: '70px', align: 'right' as const }] : []),
          ]}
        />
        {ops.map((o, i) => (
          <button
            key={o.eventId}
            type="button"
            onClick={() => onOpenWorkspace(o.workspaceId)}
            className="grid w-full items-center gap-2.5 px-4 py-2 text-left font-mono text-[11.5px] transition-colors hover:bg-(--qw-bg-muted)"
            style={{
              gridTemplateColumns: [
                '70px',
                '70px',
                '180px',
                'minmax(0, 1fr)',
                hasDur ? '70px' : '',
                hasStatus ? '70px' : '',
                hasTrace ? '70px' : '',
              ]
                .filter(Boolean)
                .join(' '),
              borderBottom: i === ops.length - 1 ? 'none' : '1px solid var(--qw-border)',
            }}
          >
            <span style={{ color: 'var(--qw-fg-faint)' }}>{fmtTime(o.timestamp)}</span>
            <OpPill op={o.op} />
            <span className="truncate" style={{ color: 'var(--qw-fg-muted)' }} title={o.workspaceId}>
              {o.workspaceId}
            </span>
            <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={o.path}>
              {o.path}
            </span>
            {hasDur && (
              <span className="text-right" style={{ color: 'var(--qw-fg-faint)' }}>
                {fmtDuration(o.durationMs) ?? '—'}
              </span>
            )}
            {hasStatus && (
              <span
                className="text-right font-semibold"
                style={{
                  color:
                    o.status === 'ok' ? 'var(--qw-ok)' : o.status === 'err' ? 'var(--qw-danger)' : 'var(--qw-fg-muted)',
                }}
              >
                {o.status === 'ok' ? '●' : o.status === 'err' ? '✕' : '—'} {o.status ?? ''}
              </span>
            )}
            {hasTrace && (
              <span className="text-right" style={{ color: 'var(--qw-crux)' }}>
                {shortTrace(o.traceId) ?? '—'}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Detail screen (split-pane) ─────────────────────────────────────

function WorkspaceDetailScreen({ workspaceId, filePath }: { workspaceId: string; filePath: string | undefined }) {
  const { navigate } = useNavigation()
  const connected = useConnected()
  // Suspends on first paint — caught by the App-level Suspense.
  // Errors throw to the App-level ErrorBoundary.
  const data = useWorkspaceSuspense(workspaceId)
  const files = data.files ?? []
  const ops = data.recentOps ?? []

  // Default to first file when none selected and files exist.
  const selectedPath = filePath ?? files[0]?.path

  return (
    <QwShell
      activeView="library-workspaces"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Library / Workspaces / ${shortBreadcrumbId(workspaceId)}`}
      title={workspaceId}
      subtitle={buildDetailSubtitle(data)}
      connected={connected}
      noScroll
      actions={
        <>
          <Btn variant="ghost" size="sm" onClick={() => navigate({ view: 'library-workspaces' })}>
            ← All workspaces
          </Btn>
          <Btn
            size="sm"
            icon={<Icon name="loop" size={11} />}
            disabled
            title="Tail file ops — backend wiring not yet shipped"
          >
            Tail
          </Btn>
          <Btn
            size="sm"
            variant="outline"
            icon={<Icon name="arrowDown" size={11} />}
            disabled
            title="Export trail — backend wiring not yet shipped"
          >
            Export
          </Btn>
        </>
      }
    >
      <div className="flex h-full min-h-0">
        <FileTreePane
          files={files}
          mounts={data.mounts ?? []}
          selectedPath={selectedPath}
          onSelect={(p) => navigate({ view: 'library-workspaces', workspaceId, filePath: p })}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {selectedPath ? (
            <FileInspector workspaceId={workspaceId} filePath={selectedPath} files={files} ops={ops} />
          ) : (
            <div
              className="flex h-full items-center justify-center text-[13px]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              Select a file to inspect.
            </div>
          )}
        </div>
      </div>
    </QwShell>
  )
}

function buildDetailSubtitle(d: WorkspaceDetail): string {
  const parts: string[] = []
  if (d.namespace) parts.push(`namespace · ${d.namespace}`)
  parts.push(`${d.files?.length ?? 0} file${(d.files?.length ?? 0) === 1 ? '' : 's'}`)
  if (d.stats?.operations) parts.push(`${d.stats.operations} ops`)
  if (d.stats?.errors && d.stats.errors > 0) {
    parts.push(`${d.stats.errors} error${d.stats.errors === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}
