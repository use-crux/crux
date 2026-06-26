/** Bounded async scheduler for best-effort static cache writes. */
export interface StaticCacheWriteQueue {
  /** Starts a cache write when a queue slot is available. */
  enqueue(task: () => Promise<void>): Promise<void>
  /** Waits for every enqueued cache write to settle. */
  drain(): Promise<void>
}

/**
 * Creates a small write queue for static extraction cache persistence.
 *
 * Projection should not block on each individual cache write, but extraction
 * still waits for all enqueued writes before resolving so custom stores observe
 * the same durability boundary as the old sequential path.
 */
export function createStaticCacheWriteQueue(concurrency: number): StaticCacheWriteQueue {
  const limit = Math.max(1, Math.floor(concurrency))
  const pending: QueuedCacheWrite[] = []
  const writes: Promise<void>[] = []
  let active = 0

  const schedule = (): void => {
    while (active < limit && pending.length > 0) {
      const item = pending.shift()
      if (!item) return
      active += 1
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1
          schedule()
        })
    }
  }

  return {
    enqueue: (task) => {
      const write = new Promise<void>((resolve, reject) => {
        pending.push({ task, resolve, reject })
        schedule()
      })
      write.catch(() => undefined)
      writes.push(write)
      return write
    },
    drain: async () => {
      let drained = 0
      while (drained < writes.length) {
        const batch = writes.slice(drained)
        drained = writes.length
        await Promise.all(batch)
      }
    },
  }
}

interface QueuedCacheWrite {
  readonly task: () => Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}
