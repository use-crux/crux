/**
 * Compares strings by ECMAScript codepoint order.
 *
 * Use this for cache identities, serialized facts, registry precedence, and
 * other compiler output where locale- or ICU-dependent ordering would make the
 * same project index differently on different machines.
 */
export function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Compares string sequences lexicographically using `compareCodepoint`.
 *
 * Use this for authored path segments and other ordered identity tuples where
 * joining with a delimiter could make distinct segment lists collide.
 */
export function compareCodepointSequence(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const order = compareCodepoint(left[index] as string, right[index] as string)
    if (order !== 0) return order
  }
  return left.length < right.length ? -1 : left.length > right.length ? 1 : 0
}
