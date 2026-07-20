/**
 * Flow lifecycle utilities — ID generation, duration parsing, and record operations
 * for signaling, cancelling, and listing flows.
 *
 * Extracted from scope.ts — these functions depend on runtime record persistence
 * but not on the flow execution engine itself.
 *
 * @module
 */

import { getHooks, resolveRecords } from '../runtime/runtime'
import type { JsonValue, RecordStore } from '../storage'
import { observe, sanitizePropagationCarrier } from '../observability'
import type { FlowSnapshot, ListFlowsOptions, FlowSummary } from './types'
import {
  assertFlowJsonValue,
  flowSnapshotForPersistence,
  flowValueForPersistence,
} from './serialization'

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

/** Store key prefix for flow snapshots. */
export const FLOW_KEY_PREFIX = 'crux:flow:'

/** Store key prefix for flow signals. */
export const SIGNAL_KEY_PREFIX = 'crux:signal:'

/** Flow statuses that close a persisted snapshot and cannot be resumed. */
export const TERMINAL_FLOW_STATUSES = ['completed', 'cancelled', 'expired'] as const

/** Persisted terminal status values for completed flow instances. */
export type TerminalFlowStatus = (typeof TERMINAL_FLOW_STATUSES)[number]

// ─────────────────────────────────────────────────────────────────
// ID generators & utilities
// ─────────────────────────────────────────────────────────────────

/** Generate a unique flow ID for cross-boundary correlation. */
export function createFlowId(): string {
  return `flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Parse a duration string (e.g., '24h', '30m', '5s', '100ms') into milliseconds. */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(ms|s|m|h|d)$/)
  if (!match) throw new Error(`Invalid duration format: ${duration}`)
  const [, value, unit] = match
  const num = parseInt(value, 10)
  switch (unit) {
    case 'ms':
      return num
    case 's':
      return num * 1000
    case 'm':
      return num * 60 * 1000
    case 'h':
      return num * 60 * 60 * 1000
    case 'd':
      return num * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}

/**
 * Check whether a persisted flow status is terminal.
 *
 * Terminal snapshots remain useful for inspection and listing, but they are no
 * longer executable resume targets.
 */
export function isTerminalFlowStatus(status: unknown): status is TerminalFlowStatus {
  return TERMINAL_FLOW_STATUSES.includes(status as TerminalFlowStatus)
}

/**
 * Assert that a loaded snapshot can be resumed.
 *
 * This keeps lifecycle rejection ahead of handler execution, so terminal
 * snapshots cannot accidentally run user code or rewrite their terminal state.
 */
export function assertFlowSnapshotResumable(snapshot: FlowSnapshot): void {
  if (isTerminalFlowStatus(snapshot.status)) {
    throw new Error(`Flow ${snapshot.flowId} is ${snapshot.status} and cannot be resumed.`)
  }
}

// ─────────────────────────────────────────────────────────────────
// Store operations
// ─────────────────────────────────────────────────────────────────

/**
 * Send a signal to a suspended flow.
 *
 * Writes the signal payload to the store. The flow will pick it up
 * on the next `flow().resume(flowId)` call.
 *
 * Uses the RecordStore from runtime config (`config({ persistence: { records } })`).
 */
export async function signalFlow(flowId: string, name: string, payload: JsonValue = {}): Promise<void> {
  const store = resolveRecords()
  const persistedPayload = flowValueForPersistence(payload, {
    boundary: 'signal payload',
  })
  await store.put(`${SIGNAL_KEY_PREFIX}${flowId}:${name}`, {
    payload: persistedPayload,
    signaledAt: Date.now(),
    updatedAt: Date.now(),
  })
}

/**
 * Consume one pending signal after it has been validated for delivery.
 *
 * Delivery is a single-use boundary: once `flow.suspend(name)` accepts a
 * persisted payload, later same-name suspend points must wait for a fresh
 * signal instead of observing stale state.
 */
export async function consumeFlowSignal(store: RecordStore, flowId: string, name: string): Promise<void> {
  await store.delete(`${SIGNAL_KEY_PREFIX}${flowId}:${name}`)
}

/** Load a persisted flow snapshot by ID. */
export async function getFlowSnapshot(flowId: string): Promise<FlowSnapshot | null> {
  const store = resolveRecords()
  return (await store.get(`${FLOW_KEY_PREFIX}${flowId}`)) as FlowSnapshot | null
}

/**
 * List flows from the store, optionally filtered by status.
 *
 * Uses the RecordStore from runtime config (`config({ persistence: { records } })`).
 */
export async function listFlows(options?: ListFlowsOptions): Promise<FlowSummary[]> {
  const store = resolveRecords()
  const filter = options?.status ? { status: options.status } : undefined
  const result = await store.list(FLOW_KEY_PREFIX, { filter })
  return result.entries.map((entry) => ({
    flowId: entry.value.flowId as string,
    name: entry.value.name as string,
    status: entry.value.status as string,
    suspendedAt: entry.value.suspendedAt as string,
    createdAt: entry.value.createdAt as number,
    updatedAt: entry.value.updatedAt as number,
    ...(entry.value.timeoutAt !== undefined ? { timeoutAt: entry.value.timeoutAt as number } : {}),
  }))
}

/**
 * Cancel a suspended flow externally.
 *
 * Updates the flow snapshot status to 'cancelled' in the store.
 * Uses the RecordStore from runtime config (`config({ persistence: { records } })`).
 */
export async function cancelFlow(flowId: string, reason?: string): Promise<void> {
  const store = resolveRecords()
  const snapshot = await store.get(`${FLOW_KEY_PREFIX}${flowId}`)
  if (!snapshot || isTerminalFlowStatus(snapshot.status)) {
    return
  }

  const cancelledAt = Date.now()
  if (reason !== undefined) {
    assertFlowJsonValue(reason, { boundary: 'flow snapshot metadata', path: '$.cancelReason' })
  }
  const cancelledSnapshot = {
    ...snapshot,
    status: 'cancelled',
    ...(reason !== undefined ? { cancelReason: reason } : {}),
    cancelledAt,
    updatedAt: cancelledAt,
  } as FlowSnapshot
  await store.put(`${FLOW_KEY_PREFIX}${flowId}`, flowSnapshotForPersistence(cancelledSnapshot))

  if (snapshot.continuation) {
    const run = observe.resumeRun(sanitizePropagationCarrier(snapshot.continuation), {
      reason: 'flow.cancel',
      attributes: { flowId },
    })
    run.end({
      status: 'cancelled',
      ...(reason ? { attributes: { cancelReason: reason } } : {}),
    })
    await observe.flush()
  }
}
