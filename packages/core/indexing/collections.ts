/**
 * Small collection helpers for indexing.
 *
 * @module
 */

/** Materialize an async iterable or array into an array. */
export async function collect<T>(input: AsyncIterable<T> | T[]): Promise<T[]> {
  if (Array.isArray(input)) {
    return input
  }

  const items: T[] = []
  for await (const item of input) {
    items.push(item)
  }
  return items
}

/** De-duplicate a string array, preserving first-seen order. */
export function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

/** De-duplicate a number array, preserving first-seen order. */
export function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values))
}
