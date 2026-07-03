const DEFAULT_MAX_PENDING_DELIVERIES = 1000
const DEFAULT_MAX_QUEUED_RECORDS = 2048

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
}

export interface NormalizedObservabilityDeliveryOptions {
  readonly maxPendingDeliveries: number
  readonly maxQueuedRecords: number
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
  }
}

export function normalizeDeliveryOptions(
  options: ObservabilityDeliveryOptions | undefined,
): NormalizedObservabilityDeliveryOptions {
  return {
    maxPendingDeliveries: Math.max(1, options?.maxPendingDeliveries ?? DEFAULT_MAX_PENDING_DELIVERIES),
    maxQueuedRecords: Math.max(1, options?.maxQueuedRecords ?? DEFAULT_MAX_QUEUED_RECORDS),
  }
}
