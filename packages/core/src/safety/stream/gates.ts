/**
 * Release-gate vocabulary for the streaming release conjunction (RFC #173, H).
 *
 * A stream chunk is released only when the conjunction of all gates permits it —
 * boundary readiness AND guardrails passed/rewritten AND no ordered-prefix
 * serialization dependency AND no unresolved selected `assert` constraint
 * occurrence AND no validation-retry commit gate AND no adapter/protocol gate.
 * These are the gate kinds; the highest-precedence active gate is the single
 * content-free `bufferedBy` reason surfaced to the consumer. Attempt-level gates
 * (constraint, validation retry, adapter) outrank the local per-occurrence gates.
 *
 * @module
 */

/** The kinds of gate that can withhold stream release, most local → most attempt-wide. */
export type ReleaseGateKind =
  | 'boundary'
  | 'guardrail'
  | 'serialization'
  | 'constraint'
  | 'validation-retry'
  | 'adapter'

// Highest precedence last: an active attempt-level gate outranks a local one, so
// the user-visible `bufferedBy` never reports a local reason while an attempt gate holds.
const PRECEDENCE: readonly ReleaseGateKind[] = [
  'boundary',
  'guardrail',
  'serialization',
  'constraint',
  'validation-retry',
  'adapter',
]

/** The highest-precedence active gate, or `undefined` when nothing is holding. */
export function highestGate(active: Iterable<ReleaseGateKind>): ReleaseGateKind | undefined {
  let best: ReleaseGateKind | undefined
  let bestRank = -1
  for (const gate of active) {
    const rank = PRECEDENCE.indexOf(gate)
    if (rank > bestRank) {
      bestRank = rank
      best = gate
    }
  }
  return best
}
