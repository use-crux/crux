/**
 * Boundary selector matching over readiness events.
 *
 * A structured boundary selects a canonical path (`boundary.output.object().path('a.b')`)
 * or the items of an array path (`.items()`). This module matches emitted
 * {@link ReadinessEvent} paths against those selectors — kept separate from the
 * scanner so gating (RFC #173) composes readiness with selection without the
 * scanner knowing about boundaries.
 *
 * @module
 */

import type { ReadinessPath } from './events'

/** Parse a dot-path selector (`'a.b.c'`) into canonical segments. */
export function selectorSegments(dotPath: string): readonly string[] {
  return dotPath.length === 0 ? [] : dotPath.split('.')
}

/** Whether a readiness event path is exactly the selected scalar/string/object path. */
export function pathMatchesSelector(eventPath: ReadinessPath, selector: readonly string[]): boolean {
  return eventPath.length === selector.length && selector.every((segment, index) => String(eventPath[index]) === segment)
}

/**
 * Whether a readiness event path is one array item of the selected array path
 * (the selector path followed by a numeric index).
 */
export function itemMatchesSelector(eventPath: ReadinessPath, selector: readonly string[]): boolean {
  if (eventPath.length !== selector.length + 1) return false
  if (typeof eventPath[eventPath.length - 1] !== 'number') return false
  return selector.every((segment, index) => String(eventPath[index]) === segment)
}
