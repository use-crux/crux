import type { CruxHostLifecycle } from '../../runtime/api/host-lifecycle'
import type { CruxDeliverySourceHealth } from './receipt'

const DEFAULT_MAX_PENDING_DELIVERIES = 8
const DEFAULT_MAX_QUEUED_RECORDS = 2048
const DEFAULT_MAX_QUEUED_BYTES = 4 * 1024 * 1024
const DEFAULT_SCHEDULED_DELAY_MS = 200
const DEFAULT_MAX_BATCH_SIZE = 512
const DEFAULT_RETRY_DELAY_MS = 100
const DEFAULT_MAX_RETRY_DELAY_MS = 5000
const DEFAULT_RETRY_JITTER_RATIO = 0.2

export interface ObservabilityDeliveryOptions {
  /** Maximum concurrent transport sends. @default 8 */
  maxPendingDeliveries?: number
  /** Maximum queued and in-flight records. Oldest queued records drop first. @default 2048 */
  maxQueuedRecords?: number
  /** Maximum queued and in-flight serialized record bytes. @default 4194304 */
  maxQueuedBytes?: number
  /** Batching window before dispatch. Flush bypasses it. @default 200 */
  scheduledDelayMs?: number
  /** Maximum records removed for one engine delivery attempt. @default 512 */
  maxBatchSize?: number
  /** Base exponential retry delay in milliseconds. @default 100 */
  retryDelayMs?: number
  /** Maximum exponential retry delay in milliseconds. @default 5000 */
  maxRetryDelayMs?: number
  /** Fractional symmetric jitter applied to retry backoff. @default 0.2 */
  retryJitterRatio?: number
  /** Receive bounded cumulative health snapshots. Callback failures are isolated. */
  onDiagnostics?: (snapshot: CruxDeliverySourceHealth) => void
  /** Deterministic random source for tests. Defaults to `Math.random`. */
  random?: () => number
  /**
   * Host lifetime capability for the current physical execution segment.
   *
   * When provided, every async send/retry task the delivery engine creates
   * is bound to `hostLifecycle.defer()`, and `flush()`/`shutdown()` bound
   * their wait against `hostLifecycle.deadline()` in addition to any
   * explicit `timeoutMs`. Batching timers are never deferred.
   */
  hostLifecycle?: CruxHostLifecycle
}

export interface NormalizedObservabilityDeliveryOptions {
  readonly maxPendingDeliveries: number
  readonly maxQueuedRecords: number
  readonly maxQueuedBytes: number
  readonly scheduledDelayMs: number
  readonly maxBatchSize: number
  readonly retryDelayMs: number
  readonly maxRetryDelayMs: number
  readonly retryJitterRatio: number
  readonly onDiagnostics?: (snapshot: CruxDeliverySourceHealth) => void
  readonly random: () => number
  readonly hostLifecycle?: CruxHostLifecycle
}

export interface ObservabilityFlushOptions {
  /** Bound the wait without clearing retry state. */
  timeoutMs?: number
}

/** Structured result returned by `observe.flush()` and `observe.shutdown()`. */
export interface ObservabilityFlushResult {
  readonly status: 'drained' | 'deadline' | 'failed'
  readonly delivered: number
  readonly rejected: number
  readonly remaining: number
  readonly deadlineExceeded: boolean
}

export function defaultDeliveryOptions(): NormalizedObservabilityDeliveryOptions {
  return normalizeDeliveryOptions(undefined)
}

export function normalizeDeliveryOptions(
  options: ObservabilityDeliveryOptions | undefined,
): NormalizedObservabilityDeliveryOptions {
  return {
    maxPendingDeliveries: positiveInteger(options?.maxPendingDeliveries, DEFAULT_MAX_PENDING_DELIVERIES),
    maxQueuedRecords: positiveInteger(options?.maxQueuedRecords, DEFAULT_MAX_QUEUED_RECORDS),
    maxQueuedBytes: positiveInteger(options?.maxQueuedBytes, DEFAULT_MAX_QUEUED_BYTES),
    scheduledDelayMs: nonNegative(options?.scheduledDelayMs, DEFAULT_SCHEDULED_DELAY_MS),
    maxBatchSize: positiveInteger(options?.maxBatchSize, DEFAULT_MAX_BATCH_SIZE),
    retryDelayMs: nonNegative(options?.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
    maxRetryDelayMs: nonNegative(options?.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS),
    retryJitterRatio: Math.min(1, nonNegative(options?.retryJitterRatio, DEFAULT_RETRY_JITTER_RATIO)),
    ...(options?.onDiagnostics ? { onDiagnostics: options.onDiagnostics } : {}),
    random: options?.random ?? Math.random,
    ...(options?.hostLifecycle ? { hostLifecycle: options.hostLifecycle } : {}),
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.trunc(Number.isFinite(value) ? value! : fallback))
}

function nonNegative(value: number | undefined, fallback: number): number {
  return Math.max(0, Number.isFinite(value) ? value! : fallback)
}
