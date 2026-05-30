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

export function statusTone(status: string): ChipTone {
  if (status === 'success' || status === 'ok') return 'ok'
  if (status === 'running') return 'crux'
  if (status === 'error' || status === 'fail') return 'danger'
  return 'warn'
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
