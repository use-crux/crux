/**
 * Development-only notice for a custom output-text guardrail that resolves to
 * adaptive per-delta streaming.
 *
 * A custom guardrail (one with no bundled strategy metadata) on an unrefined
 * streaming text boundary evaluates each canonical provider delta, so a
 * multi-character match may straddle a delta boundary. This notice points that
 * out once per guardrail definition. It never fires at definition time or during
 * generate-only execution (contract: only a real stream execution that resolves
 * the guardrail to `{ source: 'adaptive', unit: 'delta' }` triggers it), any
 * explicit refinement — including `.deltas()` — suppresses it, and production
 * emits nothing.
 *
 * @module
 */

/** Guard ids already notified this process — dedup is once per definition. */
const notified = new Set<string>()

function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
}

/**
 * Emit the adaptive-delta development notice for one custom output-text guardrail,
 * at most once per guardrail id and never in production.
 */
export function emitAdaptiveDeltaNotice(guardId: string): void {
  if (isProduction() || notified.has(guardId)) return
  notified.add(guardId)
  // eslint-disable-next-line no-console
  console.warn(
    `[crux safety] Guardrail "${guardId}" evaluates each streaming text delta by default, ` +
      `so a match spanning multiple characters may cross a provider delta boundary. Refine the ` +
      `output-text boundary (for example \`.sentences()\`) to evaluate larger units, or call ` +
      `\`.deltas()\` to accept per-delta evaluation and silence this notice.`,
  )
}

/** Reset the once-per-definition dedup set. @internal test-only */
export function resetAdaptiveDeltaNotices(): void {
  notified.clear()
}
