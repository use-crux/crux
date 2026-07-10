/**
 * Flow suspend replay state helpers.
 *
 * Pending signals are consumed after delivery, so resumed executions need a
 * compact record of already-delivered suspend payloads. This module keeps that
 * replay bookkeeping separate from the flow executor.
 *
 * @module
 */

import type { JsonValue } from '../storage'
import type { DeliveredFlowSignal, DeliveredFlowSignals, FlowSnapshot } from './types'

/**
 * Build the stable replay key for one source-order suspend occurrence.
 *
 * The signal name remains readable in persisted snapshots, while the ordinal
 * prevents a later same-name suspend from receiving an earlier approval.
 */
export function suspendDeliveryKey(occurrence: number, signalName: string): string {
  return `${occurrence}:${signalName}`
}

/** Clone delivered signal replay state from a loaded snapshot. */
export function cloneDeliveredSignals(snapshot: FlowSnapshot | null | undefined): DeliveredFlowSignals {
  if (!snapshot?.deliveredSignals) return {}
  const cloned: DeliveredFlowSignals = {}
  for (const [key, value] of Object.entries(snapshot.deliveredSignals)) {
    if (!isDeliveredFlowSignal(value)) continue
    cloned[key] = {
      signalName: value.signalName,
      payload: value.payload,
      deliveredAt: value.deliveredAt,
    }
  }
  return cloned
}

/** Return replay payload for a previously delivered suspend occurrence. */
export function deliveredSignalPayload(
  deliveredSignals: DeliveredFlowSignals,
  key: string,
): JsonValue | undefined {
  return deliveredSignals[key]?.payload
}

/** Record a validated signal payload for later resume replay. */
export function recordDeliveredSignal(
  deliveredSignals: DeliveredFlowSignals,
  key: string,
  signalName: string,
  payload: JsonValue,
): void {
  deliveredSignals[key] = {
    signalName,
    payload,
    deliveredAt: Date.now(),
  }
}

/** Return delivered signal replay state only when a snapshot needs to persist it. */
export function deliveredSignalsForSnapshot(
  deliveredSignals: DeliveredFlowSignals,
): DeliveredFlowSignals | undefined {
  return Object.keys(deliveredSignals).length > 0 ? deliveredSignals : undefined
}

function isDeliveredFlowSignal(value: unknown): value is DeliveredFlowSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'payload' in value &&
    typeof (value as { readonly signalName?: unknown }).signalName === 'string' &&
    typeof (value as { readonly deliveredAt?: unknown }).deliveredAt === 'number'
  )
}
