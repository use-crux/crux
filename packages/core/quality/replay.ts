/**
 * Replay — deterministic cassettes for model calls.
 *
 * Cassettes intercept at the ExecutorSpec/SdkGateway boundary and replay
 * recorded model calls by a normalized match key, making evaluations
 * deterministic and free. Storage lives under `.crux/quality/cassettes/`;
 * cassette files are fixtures — committed, redacted at write time, and
 * reviewed like code.
 *
 * The replay runtime ships with the scorer-library/replay phase; the
 * authoring surface (modes, the `cassette()` reference, the `replay:` option
 * on `evaluate()`) is final now.
 *
 * @module
 */

/**
 * How an evaluation interacts with its cassette.
 *
 * - `'live'` — no cassette I/O; every call hits the provider.
 * - `'record-new'` — replay hits, record misses (the default development mode).
 * - `'replay-strict'` — a miss fails the cell closed with the missing key
 *   (the CI mode; trials collapse to 1 since replays are byte-identical).
 * - `'refresh'` — re-record everything.
 */
export type ReplayMode = 'live' | 'record-new' | 'replay-strict' | 'refresh'

/**
 * A normalized model call, as seen by the cassette match key. Volatile
 * fields (timestamps, request ids) are excluded by construction.
 */
export interface NormalizedCall {
  /** Call kind at the executor boundary (e.g. `'generate'`). */
  kind: string
  /** The task/target id the call belongs to. */
  targetId?: string
  /** Hash of the resolved prompt content. */
  promptHash?: string
  /** Model identifier. */
  model?: string
  /** Canonicalized generation settings. */
  settings?: Record<string, unknown>
  /** Hash of the tool schema surface offered to the model. */
  toolSchemaHash?: string
  /** The call input payload. */
  input?: unknown
}

/**
 * A named cassette reference. Pass it (or just its name) to `evaluate()`'s
 * `replay:` option; storage resolves to
 * `.crux/quality/cassettes/<name>.json`.
 */
export interface Cassette {
  /** Discriminant tag for runtime detection. */
  readonly _tag: 'CruxCassette'
  /** Cassette name → `.crux/quality/cassettes/<name>.json`. */
  readonly name: string
  /** Mode override. Defaults to the evaluation/config replay mode. */
  readonly mode?: ReplayMode
  /** Custom match key (advanced). Defaults to the normalized call hash. */
  readonly match?: (call: NormalizedCall) => string
}

/**
 * Declare a cassette for deterministic replay.
 *
 * One cassette file serves every variant of an evaluation: entries are keyed
 * by the normalized call hash, which includes every variant-affecting
 * parameter (prompt hash, model, settings). Record once live per variant;
 * replay serves all variants from the same file.
 *
 * @param name - Cassette name; storage is `.crux/quality/cassettes/<name>.json`.
 * @param opts - Optional mode override and custom match key.
 *
 * @example
 * ```ts
 * import { evaluate, cassette } from '@use-crux/core/quality'
 *
 * export default evaluate({
 *   task: supportPrompt,
 *   data: cases,
 *   replay: { mode: 'replay-strict', cassette: cassette('support') },
 * })
 * ```
 */
export function cassette(
  name: string,
  opts?: {
    /** Mode override. Defaults to the evaluation/config replay mode. */
    mode?: ReplayMode
    /** Override the normalized match key (advanced). */
    match?: (call: NormalizedCall) => string
  },
): Cassette {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('cassette(): `name` must be a non-empty string.')
  }
  return Object.freeze({
    _tag: 'CruxCassette' as const,
    name,
    ...(opts?.mode !== undefined ? { mode: opts.mode } : {}),
    ...(opts?.match !== undefined ? { match: opts.match } : {}),
  })
}
