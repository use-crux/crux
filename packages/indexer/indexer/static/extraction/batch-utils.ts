const DEFAULT_CACHE_MISS_RECORD_BATCH_SIZE = 32

export interface CacheMissRecordBatchOptions {
  readonly missRecordBatchSize?: number
}

/** Returns the configured native/provided cache-miss record batch size. */
export function cacheMissRecordBatchSize(cache: CacheMissRecordBatchOptions): number {
  return Math.max(1, Math.floor(cache.missRecordBatchSize ?? DEFAULT_CACHE_MISS_RECORD_BATCH_SIZE))
}

/** Splits an array-like input into stable contiguous chunks. */
export function chunksOf<T>(items: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
