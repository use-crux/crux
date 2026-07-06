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
