import type { ChipTone } from '@/qw/shell/primitives'

export interface ReliabilitySignals {
  status?: string
  segmentCount?: number
  gapCount?: number
  orderingConfidence?: string
  traceAliasConflict?: boolean
  deliveryHealth?: string
}

export function deliveryHealthTone(status: string | undefined): ChipTone {
  if (status === 'healthy') return 'ok'
  if (status === 'degraded') return 'warn'
  return 'muted'
}

export function reliabilityParts(run: ReliabilitySignals): string[] {
  const parts: string[] = []
  if ((run.segmentCount ?? 1) > 1) parts.push(`${run.segmentCount} segments`)
  if ((run.gapCount ?? 0) > 0) parts.push(`${run.gapCount} sequence gap${run.gapCount === 1 ? '' : 's'}`)
  if (run.traceAliasConflict) parts.push('conflicting trace alias')
  if (run.orderingConfidence === 'partial') parts.push('partial ordering')
  if (run.deliveryHealth === 'degraded') parts.push('delivery degraded')
  return parts
}

export function reliabilityTone(run: ReliabilitySignals): ChipTone {
  if (run.traceAliasConflict) return 'danger'
  if (run.deliveryHealth === 'degraded') return deliveryHealthTone('degraded')
  return 'crux'
}

export function explainRunReliability(run: ReliabilitySignals): string | undefined {
  const segments = run.segmentCount ?? 1
  const gaps = run.gapCount ?? 0
  if (run.status === 'suspended') {
    return segments > 1
      ? `This run is durably suspended, waiting on a signal, event, or timer. ${segments} execution segments have been observed so far.`
      : 'This run is durably suspended, waiting on a signal, event, or timer.'
  }
  if (run.status === 'incomplete') {
    return gaps > 0
      ? `Telemetry ended without a run:end record, and ${gaps} sequence gap${gaps === 1 ? '' : 's'} or missing parent reference${gaps === 1 ? '' : 's'} were observed — the run may still be executing out of view, or its process exited before reporting a terminal status.`
      : 'Telemetry ended without a run:end record — the run may still be executing out of view, or its process exited before reporting a terminal status.'
  }
  if (run.status === 'conflicted') {
    return run.traceAliasConflict
      ? 'A trace alias identifies more than one logical run, so the server could not establish one immutable identity for this trace.'
      : 'The stored terminal evidence for this run conflicts with what was previously recorded, so its identity could not be resolved.'
  }
  if (run.deliveryHealth === 'degraded') {
    return run.orderingConfidence === 'partial'
      ? 'Delivery/export health is degraded, and the server could not establish one causal display order across segments — some records may be missing or rejected.'
      : 'Delivery/export health is degraded — some records were rejected during export.'
  }
  return undefined
}
