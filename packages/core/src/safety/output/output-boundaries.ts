/**
 * Boundary-first output builders for streaming Safety (RFC #173).
 *
 * A boundary answers one question: "when is this unit ready to evaluate and
 * release?" These builders let a guardrail or constraint select that unit through
 * a fluent chain whose every result is still a frozen {@link BoundaryDef} — the
 * refinement is stored as serializable descriptor data, and the fluent methods are
 * installed as non-enumerable own properties so configuration/trace serialization
 * and `isBoundaryDef` see data, not functions. Each refinement returns a fresh
 * frozen descriptor; a shared builder is never mutated.
 *
 * This module is the isolated prototype of the descriptor/builder intersection
 * and the depth-four-known / string-fallback `path` overload. It is wired into
 * `boundary.output` and the guardrail result typing during consumer migration.
 *
 * @module
 */

import type { BoundaryDef, DotPath, PathValue } from '../boundary'

/** Serializable refinement unit stored on an output boundary descriptor. */
export type SafetyUnitKind =
  | 'delta'
  | 'complete'
  | 'sentence'
  | 'line'
  | 'segment'
  | 'object'
  | 'path'
  | 'item'

/** Bounded hold limits for a growing text unit. */
export interface HoldLimits {
  /** Maximum retained UTF-16 code units. @default 2000 */
  readonly chars?: number
  /** Optional elapsed monotonic milliseconds; no implicit default. */
  readonly ms?: number
}

/** Options for sentence segmentation of a growing text unit. */
export interface SentenceOptions {
  /** Bounded hold limits applied while a sentence is still growing. */
  readonly maxHold?: HoldLimits
}

/** Options for newline-delimited segmentation of a growing text unit. */
export interface LineOptions {
  readonly maxHold?: HoldLimits
}

/**
 * Advanced deterministic custom segmentation.
 *
 * `next(buffer, { final })` returns the length of the next complete leading unit,
 * or `undefined` to retain more input. `final` is true only during EOF flushing,
 * letting a segmenter complete a trailing unterminated unit. It must be pure for
 * the same `buffer` and `final`. `maxCharacters` is mandatory and positive.
 */
export interface SegmentOptions {
  readonly maxCharacters: number
  readonly next: (buffer: string, ctx: { readonly final: boolean }) => number | undefined
  readonly maxHold?: HoldLimits
}

/**
 * Compile-time hold-capability carrier. Growing text units permit `hold`; closed
 * units (`.complete()`, root object, scalar path, array item) exclude it. Read by
 * the guardrail result typing; never assigned at runtime.
 */
export type HoldCapability = 'permitted' | 'excluded'

/** Intersection marker recording whether a boundary's unit permits `hold`. */
export interface HoldMarker<H extends HoldCapability> {
  /** @internal Compile-time hold-capability carrier; never assigned. */
  readonly __hold: H
}

type TextState = 'unset' | 'growing' | 'complete'

/** Methods legal for a text boundary in a given refinement state. */
type TextMethodsFor<S extends TextState> = S extends 'unset'
  ? HoldMarker<'permitted'> & {
      /** Each canonical adapter text delta; no promise of linguistic meaning. Permits `hold`. */
      deltas(): TextBoundary<'growing'>
      /** The full generated text; stream release waits for completion. Excludes `hold`. */
      complete(): TextBoundary<'complete'>
      /** Deterministic sentence units with punctuation/EOF completion. Permits `hold`. */
      sentences(options?: SentenceOptions): TextBoundary<'growing'>
      /** Newline-delimited units; the final unterminated line completes at EOF. Permits `hold`. */
      lines(options?: LineOptions): TextBoundary<'growing'>
      /** Advanced deterministic custom segmentation. Permits `hold`. */
      segments(options: SegmentOptions): TextBoundary<'growing'>
    }
  : S extends 'growing'
    ? HoldMarker<'permitted'>
    : HoldMarker<'excluded'>

/**
 * A text output boundary. The unrefined form (`text()`) evaluates once per
 * canonical text delta on a stream and once when complete on generate, and
 * exposes the refinement methods; a refined form exposes none.
 */
export type TextBoundary<S extends TextState = 'unset'> = BoundaryDef<'model.output.text', string> &
  TextMethodsFor<S>

/** An array item boundary: each complete array item in document order. Excludes `hold`. */
export type ItemsBoundary<E> = BoundaryDef<'model.output.object', E> & HoldMarker<'excluded'>

/** A string-path sentence boundary: a growing decoded string segmented into sentences. Permits `hold`. */
export type StringPathSentencesBoundary = BoundaryDef<'model.output.object', string> & HoldMarker<'permitted'>

/**
 * A structured path boundary. A scalar path completes at a legal delimiter; a
 * string path additionally exposes `.sentences()`, and an array path exposes
 * `.items()`. All closed forms exclude `hold`.
 */
export type PathBoundary<V> = BoundaryDef<'model.output.object', V> &
  HoldMarker<'excluded'> &
  ([V] extends [readonly (infer E)[]] ? { items(): ItemsBoundary<E> } : unknown) &
  ([V] extends [string] ? { sentences(options?: SentenceOptions): StringPathSentencesBoundary } : unknown)

/**
 * A root object boundary. Evaluates the complete root object, and selects a path
 * via `.path()` (known paths autocomplete to depth four; deeper string paths are
 * runtime-valid with subject `unknown`). Excludes `hold`.
 */
export type ObjectBoundary<T> = BoundaryDef<'model.output.object', T> &
  HoldMarker<'excluded'> & {
    path<P extends DotPath<T>>(path: P): PathBoundary<PathValue<T, P>>
    path(path: string): PathBoundary<unknown>
  }

/** Freeze a descriptor, installing fluent methods as non-enumerable own properties. */
function freezeBoundary<B>(data: Record<string, unknown>, methods?: Record<string, unknown>): B {
  const target: Record<string, unknown> = { ...data }
  if (methods) {
    for (const [key, value] of Object.entries(methods)) {
      Object.defineProperty(target, key, {
        value,
        enumerable: false,
        writable: false,
        configurable: false,
      })
    }
  }
  return Object.freeze(target) as B
}

const OBJECT_ID = 'model.output.object' as const
const TEXT_ID = 'model.output.text' as const

/**
 * Validate a custom segmenter's configuration at definition time: `maxCharacters`
 * must be a positive integer and `next` must be a function. `next` must also be
 * pure for the same `(buffer, final)` — a contract the engine relies on but
 * cannot check.
 */
function validateSegmentOptions(options: SegmentOptions): SegmentOptions {
  const { maxCharacters, next } = options
  if (typeof maxCharacters !== 'number' || !Number.isInteger(maxCharacters) || maxCharacters <= 0) {
    throw new TypeError(
      `boundary.output.text().segments() requires a positive integer maxCharacters (received ${String(maxCharacters)}).`,
    )
  }
  if (typeof next !== 'function') {
    throw new TypeError('boundary.output.text().segments() requires a `next` segmenter function.')
  }
  return options
}

function refinedText(unit: SafetyUnitKind, options?: object): TextBoundary<'growing'> & TextBoundary<'complete'> {
  return freezeBoundary({
    _tag: 'Boundary',
    id: TEXT_ID,
    unit,
    ...(options ? { options } : {}),
  })
}

/**
 * Target the model's generated text.
 *
 * @remarks Adaptive default: evaluates once when a generate result completes, and
 * once per canonical text delta on a stream (a growing unit that permits `hold`).
 * Refine with `.deltas()`, `.complete()`, `.sentences()`, `.lines()`, or
 * `.segments()`; only `.complete()` closes the unit and excludes `hold`.
 */
export function outputText(): TextBoundary<'unset'> {
  // No `unit` on the unrefined form: the effective unit is resolved as
  // explicit > bundled strategy default > adaptive (per-delta) at binding time.
  return freezeBoundary(
    { _tag: 'Boundary', id: TEXT_ID },
    {
      deltas: () => refinedText('delta'),
      complete: () => refinedText('complete'),
      sentences: (options?: SentenceOptions) => refinedText('sentence', options),
      lines: (options?: LineOptions) => refinedText('line', options),
      segments: (options: SegmentOptions) => refinedText('segment', validateSegmentOptions(options)),
    },
  )
}

function makePath(path: string): PathBoundary<unknown> {
  return freezeBoundary(
    { _tag: 'Boundary', id: OBJECT_ID, unit: 'path', path },
    {
      items: () => freezeBoundary({ _tag: 'Boundary', id: OBJECT_ID, unit: 'item', path }),
      sentences: (options?: SentenceOptions) =>
        freezeBoundary({ _tag: 'Boundary', id: OBJECT_ID, unit: 'sentence', path, ...(options ? { options } : {}) }),
    },
  )
}

/**
 * Target the model's structured output object.
 *
 * @remarks Adaptive default: evaluates the complete root object (a closed unit
 * that excludes `hold`). Select a path with `.path('a.b')`; a scalar path
 * completes at a legal delimiter, a string path adds `.sentences()`, and an array
 * path adds `.items()`.
 */
export function outputObject<T>(): ObjectBoundary<T> {
  // No `unit` on the unrefined root: the adaptive default evaluates the complete
  // root object; `.path()` refines to a scalar/array/string path.
  return freezeBoundary(
    { _tag: 'Boundary', id: OBJECT_ID },
    { path: (path: string) => makePath(path) },
  ) as ObjectBoundary<T>
}
