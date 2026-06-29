import type { ChipTone } from '@/qw/shell/primitives'
import type { PlanSummary } from '@/types'

export function fmtTime(ms: number | undefined | null): string | null {
  if (ms == null) return null
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function fmtRelative(ms: number | undefined | null): string | null {
  if (ms == null) return null
  const diff = Date.now() - ms
  if (diff < 0) return fmtTime(ms)
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function fmtDuration(ms: number | undefined | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${Math.round(s - m * 60)}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m - h * 60}m`
}

export function shortTrace(id: string | undefined | null): string | null {
  if (!id) return null
  if (id.length <= 10) return id
  return `${id.slice(0, 4)}…${id.slice(-2)}`
}

export function shortBreadcrumbId(id: string): string {
  if (id.length <= 36) return id
  const colon = id.indexOf(':')
  if (colon > 0 && colon < 32) {
    return `${id.slice(0, colon + 1)}${id.slice(colon + 1, colon + 9)}…`
  }
  return `${id.slice(0, 28)}…`
}

export function planStatusTone(status: string): ChipTone {
  switch (status) {
    case 'active':
    case 'in_progress':
      return 'crux'
    case 'completed':
      return 'ok'
    case 'suspended':
      return 'warn'
    case 'discarded':
      return 'danger'
    default:
      return 'muted'
  }
}

export function taskStatusTone(status: string): ChipTone {
  switch (status) {
    case 'completed':
      return 'ok'
    case 'in_progress':
      return 'crux'
    case 'failed':
      return 'danger'
    case 'skipped':
      return 'warn'
    case 'cancelled':
    case 'pending':
      return 'muted'
    case 'removed':
      return 'danger'
    default:
      return 'muted'
  }
}

export function eventTone(kind: string): { tone: ChipTone; color: string } {
  if (kind === 'plan.created') return { tone: 'iris', color: 'var(--qw-iris)' }
  if (kind === 'plan.updated') return { tone: 'crux', color: 'var(--qw-crux)' }
  if (kind === 'task.added') return { tone: 'iris', color: 'var(--qw-iris)' }
  if (kind === 'task.updated') return { tone: 'ok', color: 'var(--qw-ok)' }
  if (kind === 'task.removed') return { tone: 'muted', color: 'var(--qw-fg-muted)' }
  return { tone: 'muted', color: 'var(--qw-fg-muted)' }
}

interface TaskCountsLike {
  done: number
  inProgress: number
  pending: number
  removed: number
}

export function totalActive(c?: TaskCountsLike): number {
  if (!c) return 0
  return c.done + c.inProgress + c.pending
}

export function pickActivePlan(list: readonly PlanSummary[]): PlanSummary | undefined {
  const active = list.find((p) => p.status === 'active' || p.status === 'in_progress')
  if (active) return active
  return list[0]
}
