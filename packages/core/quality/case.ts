/**
 * Cases — the data rows of an evaluation.
 *
 * Cases are data: serializable except for the optional per-case `expect`
 * callback (the exception, not the rule — shared assertions belong on the
 * evaluation-level `expect`). Keeping cases near-pure data is what makes
 * datasets portable, fingerprints stable, and watch-mode caching possible.
 *
 * @module
 */

import type { AssertContext, CaseContext } from './expect'
import type { Capability, TaskLike, InputOf, OutputOf, CapsOf } from './target'

/**
 * One conversational turn for multi-turn cases. Per-turn assertions are a
 * post-launch extension; v1 turns carry the user message only.
 */
export interface Turn {
  /** The user message for this turn. */
  user: string
}

/** The option bag shared by every case shape. @internal */
export interface CaseOptions<
  TInput,
  TOutput,
  TExpected,
  TCaps extends Capability,
  TScoreName extends string = string,
> {
  /**
   * Stable identity for history, watch-mode caching, and `--case` filtering.
   * Defaults to a content hash of `input`.
   */
  name?: string
  /**
   * Opaque expected payload, delivered to scorers and `expect` callbacks.
   * Nothing matches it implicitly — declarative matching is an explicit
   * scorer (`scorers.exact()`, `scorers.contains()`, …).
   */
  expected?: TExpected
  /**
   * Case-SPECIFIC assertions only. Cases with callbacks are not portable to
   * datasets — shared assertions belong on the evaluation-level `expect`.
   */
  expect?: (ctx: CaseContext<TInput, TOutput, TExpected, TCaps>) => void | Promise<void>
  /**
   * Case-specific post-score assertions. Runs after scorers, with
   * statically named scorer outputs available on `ctx.score`.
   */
  afterScores?: (ctx: AssertContext<TInput, TOutput, TExpected, TScoreName, TCaps>) => void | Promise<void>
  /** Executions for this case. Wins over the evaluation-level `trials`. */
  trials?: number
  /** Free-form labels shown in reports and usable for filtering. */
  tags?: readonly string[]
  /** Run only this case (and other `only` cases) in watch/dev runs. */
  only?: boolean
  /** Skip this case — `true` or a reason string (shown in the reporter). */
  skip?: boolean | string
}

/**
 * The input shape of a case: single-turn everywhere; tasks that capture
 * `steps` (flows and agents) additionally accept multi-turn cases via
 * `turns`. @internal
 */
export type CaseInputShape<TInput, TCaps extends Capability> = 'steps' extends TCaps
  ? { input: TInput } | { input?: TInput; turns: readonly Turn[] }
  : { input: TInput }

/**
 * One test case of an evaluation.
 *
 * The input type flows from the task (the sole inference anchor) — a typo'd
 * key errors on the case property, never on `task`. Multi-turn `turns` cases
 * exist only for steps-capturing tasks (agents and flows).
 *
 * @typeParam TInput    - Case input type, derived from the task.
 * @typeParam TOutput   - Task output type (types the per-case `expect` ctx).
 * @typeParam TExpected - The `expected` payload type.
 * @typeParam TCaps     - The task's capability union.
 *
 * @example
 * ```ts
 * evaluate({
 *   task: supportPrompt,
 *   data: [
 *     { input: { question: 'How do refunds work?', locale: 'en' } },
 *     {
 *       name: 'dutch refunds',
 *       input: { question: 'Hoe werkt een refund?', locale: 'nl' },
 *       expected: { mustMention: ' 14 dagen' },
 *       trials: 3,
 *     },
 *   ],
 * })
 * ```
 */
export type Case<TInput, TOutput, TExpected, TCaps extends Capability, TScoreName extends string = string> = CaseOptions<
  TInput,
  TOutput,
  TExpected,
  TCaps,
  TScoreName
> &
  CaseInputShape<TInput, TCaps>

/**
 * The case type of a task — the documented one-annotation escape hatch for
 * case arrays extracted to another file (extraction loses contextual typing).
 *
 * @typeParam T         - The task the cases target.
 * @typeParam TExpected - The `expected` payload type. Defaults to `unknown`.
 *
 * @example
 * ```ts
 * // cases.ts
 * export const refundCases = [
 *   { input: { question: 'How do refunds work?', locale: 'en' } },
 * ] satisfies CaseOf<typeof supportPrompt>[]
 *
 * // support.eval.ts
 * evaluate({ task: supportPrompt, data: refundCases })
 * ```
 */
export type CaseOf<T extends TaskLike, TExpected = unknown, TScoreName extends string = string> = Case<
  InputOf<T>,
  OutputOf<T>,
  TExpected,
  CapsOf<T>,
  TScoreName
>
