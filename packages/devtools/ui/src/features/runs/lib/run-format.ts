import type { ChipTone } from '@/qw/shell/primitives'
import type { RunKind } from '../types'

export const KIND_TONE: Record<RunKind, ChipTone> = {
  flow: 'crux',
  swarm: 'iris',
  pipeline: 'warn',
  consensus: 'iris',
  agent: 'iris',
  retrieval: 'ok',
  generate: 'warn',
  resolve: 'muted',
  trace: 'muted',
}

export const KIND_DOT_COLOR: Record<RunKind, string> = {
  flow: 'var(--qw-crux)',
  swarm: 'var(--qw-iris)',
  pipeline: 'var(--qw-warn)',
  consensus: 'var(--qw-iris)',
  agent: 'var(--qw-iris)',
  retrieval: 'var(--qw-ok)',
  generate: 'var(--qw-warn)',
  resolve: 'var(--qw-fg-muted)',
  trace: 'var(--qw-fg-muted)',
}

/**
 * Full 9-state run/span status vocabulary → chip tone, mirroring the design's
 * canonical `STATUS_TONE` (see `.design-ref/project/v5-atoms.jsx`). The backend
 * now emits canonical `ok` (not `success`); legacy aliases are kept so older
 * records still render. Unknown statuses fall back to `muted`, like the design.
 */
const STATUS_TONE: Record<string, ChipTone> = {
  running: 'crux',
  ok: 'ok',
  success: 'ok', // legacy alias
  warn: 'warn',
  error: 'danger',
  fail: 'danger', // legacy alias
  failed: 'danger', // legacy alias
  blocked: 'iris', // guardrail/constraint stop — semantically not an error
  cancelled: 'muted',
  suspended: 'crux', // durable flow paused on signal/event/timer/child
  skipped: 'muted',
  incomplete: 'warn', // telemetry gap (start without end)
  stale: 'warn', // live run stopped emitting records
}

export function statusTone(status: string): ChipTone {
  return STATUS_TONE[status] ?? 'muted'
}

/** A run is "live" (warrants the pulsing indicator) only while running. */
export function isLiveStatus(status: string): boolean {
  return status === 'running'
}

export function formatLatency(ms: number | undefined): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatCost(n: number | undefined): string {
  if (n == null) return '-'
  if (n < 0.001) return `$${n.toFixed(6)}`
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(3)}`
}
