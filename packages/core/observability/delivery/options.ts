const DEFAULT_MAX_PENDING_DELIVERIES = 1000
const DEFAULT_MAX_QUEUED_RECORDS = 2048
const DEFAULT_RETRY_DELAY_MS = 100
const DEFAULT_MAX_RETRY_DELAY_MS = 5000

export interface ObservabilityDeliveryOptions {
  /**
   * Maximum number of in-flight transport sends. New records stay queued until
   * a delivery slot opens.
   *
   * @default 1000
   */
  maxPendingDeliveries?: number

  /**
   * Maximum number of buffered records retained by the delivery engine,
   * including records already handed to in-flight transports. When the bound is
   * exceeded, the oldest queued records are dropped and counted.
   *
   * @default 2048
   */
  maxQueuedRecords?: number

  /**
   * Base delay for delivery retry backoff after a transport failure.
   *
   * Retries happen without requiring another emitted record. Each consecutive
   * failure doubles the delay until `maxRetryDelayMs`.
   *
   * @default 100
   */
  retryDelayMs?: number

  /**
   * Maximum delivery retry backoff after repeated transport failures.
   *
   * @default 5000
   */
  maxRetryDelayMs?: number
}

export interface NormalizedObservabilityDeliveryOptions {
  readonly maxPendingDeliveries: number
  readonly maxQueuedRecords: number
  readonly retryDelayMs: number
  readonly maxRetryDelayMs: number
}

export interface ObservabilityFlushOptions {
  /**
   * Bound the wait so serverless shutdown paths never hang user code forever.
   *
   * @default wait until all pending deliveries settle
   */
  timeoutMs?: number
}

export function defaultDeliveryOptions(): NormalizedObservabilityDeliveryOptions {
  return {
    maxPendingDeliveries: DEFAULT_MAX_PENDING_DELIVERIES,
    maxQueuedRecords: DEFAULT_MAX_QUEUED_RECORDS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    maxRetryDelayMs: DEFAULT_MAX_RETRY_DELAY_MS,
  }
}

export function normalizeDeliveryOptions(
  options: ObservabilityDeliveryOptions | undefined,
): NormalizedObservabilityDeliveryOptions {
  return {
    maxPendingDeliveries: Math.max(1, options?.maxPendingDeliveries ?? DEFAULT_MAX_PENDING_DELIVERIES),
    maxQueuedRecords: Math.max(1, options?.maxQueuedRecords ?? DEFAULT_MAX_QUEUED_RECORDS),
    retryDelayMs: Math.max(0, options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS),
    maxRetryDelayMs: Math.max(0, options?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS),
  }
}
