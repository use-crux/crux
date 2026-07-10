/**
 * Small bounded-concurrency helpers shared by runtime primitives.
 *
 * @module
 */

/** Run `fn` for every item with at most `limit` operations in flight. */
export async function mapConcurrent<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  fn: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('mapConcurrent limit must be a positive integer.')
  }
  if (items.length === 0) return []

  const results = new Array<TResult>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await fn(items[index], index)
    }
  }

  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
