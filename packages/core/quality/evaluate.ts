/**
 * `evaluate()` — define a runnable Quality Evaluation.
 *
 * Export an Evaluation from a `*.eval.ts` file and the CLI discovers it;
 * call `.run()` to execute programmatically (the one-line Vitest embed).
 *
 * **Inference contract (binding):** `task` is the SOLE inference site for
 * input/output types. `data`, `scorers`, and `expect` are non-inference
 * positions — a typo'd case key errors on the case property, never on task.
 * Task kinds (Prompt | Agent | Flow | Retriever | Target | plain fn) are
 * resolved by the `InputOf`/`OutputOf`/`ParamsOf`/`CapsOf` dispatch
 * conditionals against the single inferred task type — conditionals never
 * distribute over the `TaskLike` union (the TS2589 firewall), and argument
 * errors stay on the offending property.
 *
 * @module
 */

import type { AnyPrompt } from '../types'
import type { Case } from './case'
import type { CaseContext } from './expect'
import type { Dataset } from './dataset'
import type { Gates } from './gates'
import type { Cassette, ReplayMode } from './replay'
import type { Scorer, BoundScorerLib } from './scorers'
import { boundScorerLib } from './scorers'
import type { Experiment, RunOverrides } from './experiment'
import type {
  Capability,
  TaskLike,
  InputOf,
  OutputOf,
  ParamsOf,
  CapsOf,
  PromptTaskInput,
  PromptTaskOutput,
} from './target'
import type { EvaluationDefinition, RawCase, RawDataset, RawScorer } from './internal/definition'
import { notImplemented } from './internal/errors'
import type { EvaluationManifest } from './manifest'
import { buildManifest } from './manifest'

// ─────────────────────────────────────────────────────────────────
// Scorer-name linkage
// ─────────────────────────────────────────────────────────────────

/** Literal name of one scorer array element; plain functions degrade to `string`. @internal */
type ScorerElementName<S> = 'scorerName' extends keyof S
  ? NonNullable<S['scorerName']> extends infer N extends string
    ? [string] extends [N]
      ? string
      : N
    : string
  : string

/**
 * The union of literal scorer names declared by a `scorers:` array.
 * All-literal arrays produce a literal union (gate keys autocomplete and
 * unknown keys are compile errors); any unnamed plain function in the mix
 * degrades the union to `string` (no false errors). The factory-lambda form
 * contributes through its RETURN array — `TScorers` is always the array type.
 *
 * @internal
 */
export type ScorerNamesOf<TScorers> = TScorers extends readonly (infer S)[] ? ScorerElementName<S> : never

/** What the `scorers:` option accepts for a given evaluation. @internal */
export type ScorersOption<I, O, E> =
  | ReadonlyArray<Scorer<I, O, E, string>>
  | ((s: BoundScorerLib<I, O, E>) => ReadonlyArray<Scorer<I, O, E, string>>)

/**
 * The factory-lambda form of `scorers:`, re-exported as the public name.
 * See {@link ScorerFactory} in `./scorers` for documentation.
 */
export type { ScorerFactory } from './scorers'

// ─────────────────────────────────────────────────────────────────
// Variant validation
// ─────────────────────────────────────────────────────────────────

/**
 * Validates a replacement prompt in a variant: it must ACCEPT the task's case
 * input and produce an output ASSIGNABLE to the task's output. Mismatches
 * resolve to a branded error object so the compile error explains itself.
 *
 * @internal
 */
export type CompatiblePromptOverride<Q, TIn, TOut> = Q extends AnyPrompt
  ? [TIn] extends [PromptTaskInput<Q>]
    ? [PromptTaskOutput<Q>] extends [TOut]
      ? Q
      : {
          readonly 'crux-quality error': 'variant prompt output is not assignable to the task output'
          readonly produces: PromptTaskOutput<Q>
        }
    : {
        readonly 'crux-quality error': 'variant prompt does not accept the task input'
        readonly accepts: PromptTaskInput<Q>
      }
  : AnyPrompt

/**
 * Validates a whole-task substitution in a variant: the replacement must
 * share the base task's input/output surface. Capabilities may differ —
 * asserting on a signal the variant task does not capture is the runtime
 * honest-fail.
 *
 * @internal
 */
export type CompatibleTaskOverride<TT, TIn, TOut> = TT extends TaskLike
  ? [TIn] extends [InputOf<TT>]
    ? [OutputOf<TT>] extends [TOut]
      ? TT
      : {
          readonly 'crux-quality error': 'variant task output is not assignable to the task output'
          readonly produces: OutputOf<TT>
        }
    : {
        readonly 'crux-quality error': 'variant task does not accept the task input'
        readonly accepts: InputOf<TT>
      }
  : TaskLike

/** Per-entry variant override validation against the task's parameter surface. @internal */
export type VariantOverride<V, TParams, TIn, TOut> = {
  [K in keyof V]: K extends 'task'
    ? CompatibleTaskOverride<V[K], TIn, TOut>
    : K extends 'prompt'
      ? 'prompt' extends keyof TParams
        ? CompatiblePromptOverride<V[K], TIn, TOut>
        : { readonly 'crux-quality error': 'this task has no prompt parameter to override' }
      : K extends keyof TParams
        ? TParams[K]
        : { readonly 'crux-quality error': 'this key is not part of the task parameter surface'; readonly key: K }
}

/** Validation of the whole `variants:` record. @internal */
export type ValidateVariants<TVariants, TParams, TIn, TOut> = {
  [K in keyof TVariants]: VariantOverride<TVariants[K], TParams, TIn, TOut>
}

// ─────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────

/** What `data:` accepts: inline cases, a dataset, or a mix (concatenated). @internal */
export type EvaluationData<TIn, TOut, TExpected, TCaps extends Capability> =
  | ReadonlyArray<Case<TIn, TOut, TExpected, TCaps>>
  | Dataset<TIn, TExpected>
  | ReadonlyArray<Case<TIn, TOut, TExpected, TCaps> | Dataset<TIn, TExpected>>

/**
 * The kind-resolved options shape behind every `evaluate()` overload.
 * Public docs read {@link EvaluateOptions}; this parameterized form is what
 * the per-kind overloads instantiate with concrete types.
 *
 * @internal
 */
export interface EvaluateOptionsShape<TIn, TOut, TParams, TCaps extends Capability, TExpected, TScorers, TVariants> {
  /**
   * Pure case data: inline cases, a `dataset()` golden set, or a mix.
   * Inputs are typed from the task — never the other way around.
   */
  data: EvaluationData<TIn, TOut, TExpected, TCaps>

  /**
   * Evaluation-level assertions, run for EVERY case — the primary assertion
   * home. Per-case `expect` is for case-specific exceptions.
   */
  expect?: (ctx: CaseContext<TIn, TOut, NoInfer<TExpected>, TCaps>) => void | Promise<void>

  /**
   * Scorers. Array form (importable/shareable — the documented default) or a
   * factory lambda receiving the built-in library pre-bound to this
   * evaluation's generics (taught for structured outputs).
   */
  scorers?: TScorers | ((s: BoundScorerLib<TIn, TOut, TExpected>) => TScorers)

  /** Execution defaults — "variant zero". Same shape variants override. */
  params?: Partial<TParams>

  /**
   * Comparison variants. Each entry overrides only what changes and inherits
   * `params` for the rest; overrides are typed by the task's parameter
   * surface (a params-ignoring plain-fn task rejects ALL overrides). `task`
   * may be overridden by a whole different task with the same input/output.
   */
  variants?: TVariants & ValidateVariants<TVariants, TParams, TIn, TOut>

  /**
   * Reference variant for paired comparison — keyof `variants`, autocompletes.
   * (NoInfer: otherwise a typo'd baseline would reverse-infer a variant name
   * into `TVariants` instead of erroring here.)
   */
  baseline?: NoInfer<keyof TVariants & string>

  /** Executions per cell. Default 1. Per-case `trials` wins. Collapsed to 1 under replay-strict. */
  trials?: number

  /**
   * Pass/fail policy → CLI exit code. Default: assertions gate, scores inform.
   *
   * Score-gate keys are typed by the literal scorer names plus the lowered
   * `'pass'` score. Compile-time strictness applies to the ARRAY spelling of
   * `scorers` (declared before `gates`); the factory-lambda spelling resolves
   * its names after this property is contextually typed, so its keys degrade
   * to `string` at the type level — `evaluate()` then validates them at
   * definition time, so a typo'd gate key still fails immediately.
   */
  gates?: Gates<ScorerNamesOf<TScorers> | 'pass'>

  /** Deterministic replay mode, optionally with a named cassette. */
  replay?: ReplayMode | { mode: ReplayMode; cassette?: string | Cassette }

  /** Maximum concurrent cells. Default: project config, else 5. */
  concurrency?: number

  /** Per-cell timeout. Default: project config, else 60_000. */
  timeoutMs?: number

  /** Free-form labels for filtering and reports. */
  tags?: readonly string[]

  /** Human-readable description shown in reports and devtools. */
  description?: string
}

/**
 * Options for `evaluate()` — the conceptual, task-generic form.
 *
 * (The implementation resolves tasks through per-kind overloads, so in
 * editors you will see the kind-resolved shape; the semantics are exactly
 * this type.)
 *
 * @typeParam T         - The task under evaluation. Anchor of ALL inference.
 * @typeParam TExpected - The `expected` payload type carried by cases.
 */
export type EvaluateOptions<T extends TaskLike, TExpected = unknown> = { task: T } & EvaluateOptionsShape<
  InputOf<T>,
  OutputOf<T>,
  ParamsOf<T>,
  CapsOf<T>,
  TExpected,
  ReadonlyArray<Scorer<InputOf<T>, OutputOf<T>, TExpected, string>>,
  Record<string, object>
>

// ─────────────────────────────────────────────────────────────────
// Evaluation handle
// ─────────────────────────────────────────────────────────────────

/**
 * A defined, runnable Quality Evaluation.
 *
 * Exported from a `*.eval.ts` file it is discovered by `crux quality run`;
 * `.run()` executes it programmatically (the one-line Vitest embed). The
 * `manifest` exposes serializable structural facts — computed without
 * executing the task — for discovery, `list --json`, and devtools.
 *
 * @typeParam TInput    - Case input type (from the task).
 * @typeParam TOutput   - Task output type.
 * @typeParam TNames    - Score-name union (literal scorer names + `'pass'`).
 * @typeParam TVariants - Declared variant names.
 *
 * @example
 * ```ts
 * // support.eval.ts
 * export default evaluate({ task: supportPrompt, data: cases })
 *
 * // support.quality.test.ts (Vitest bridge)
 * it('meets the quality bar', async () => {
 *   const experiment = await supportEvaluation.run()
 *   expect(experiment.passed).toBe(true)
 * })
 * ```
 */
export interface Evaluation<
  TInput = unknown,
  TOutput = unknown,
  TNames extends string = string,
  TVariants extends string = never,
> {
  /** Discovery discriminant. */
  readonly _tag: 'CruxEvaluation'
  /** Explicit id, or `undefined` → the runner derives `<relative-path-sans-ext>[#exportName]`. */
  readonly id: string | undefined
  /** Serializable structural facts; computed without executing the task. */
  readonly manifest: EvaluationManifest
  /** Execute now (programmatic bridge — the one-line Vitest embed). */
  run(overrides?: RunOverrides<TVariants>): Promise<Experiment<TInput, TOutput, TNames, TVariants>>
}

// ─────────────────────────────────────────────────────────────────
// evaluate() signatures
// ─────────────────────────────────────────────────────────────────

/**
 * The callable `evaluate` surface: one generic signature per call form
 * (options-only and explicit-id). The task kind is resolved by the
 * `InputOf`/`OutputOf`/`ParamsOf`/`CapsOf` dispatch conditionals against the
 * single inferred `T` — conditionals never distribute over the `TaskLike`
 * union, and argument errors stay on the offending property (the NoInfer
 * contract).
 */
export interface EvaluateFunction {
  <
    T extends TaskLike,
    TExpected = unknown,
    TScorers extends ReadonlyArray<Scorer<InputOf<T>, OutputOf<T>, TExpected, string>> = ReadonlyArray<
      Scorer<InputOf<T>, OutputOf<T>, TExpected, string>
    >,
    TVariants extends Record<string, object> = {},
  >(
    options: { task: T } & EvaluateOptionsShape<
      InputOf<T>,
      OutputOf<T>,
      ParamsOf<T>,
      CapsOf<T>,
      TExpected,
      TScorers,
      TVariants
    >,
  ): Evaluation<InputOf<T>, OutputOf<T>, ScorerNamesOf<TScorers> | 'pass', keyof TVariants & string>

  <
    T extends TaskLike,
    TExpected = unknown,
    TScorers extends ReadonlyArray<Scorer<InputOf<T>, OutputOf<T>, TExpected, string>> = ReadonlyArray<
      Scorer<InputOf<T>, OutputOf<T>, TExpected, string>
    >,
    TVariants extends Record<string, object> = {},
  >(
    /** Explicit id, e.g. `'support.refunds'`. Optional — defaults to the path-derived id. */
    id: string,
    options: { task: T } & EvaluateOptionsShape<
      InputOf<T>,
      OutputOf<T>,
      ParamsOf<T>,
      CapsOf<T>,
      TExpected,
      TScorers,
      TVariants
    >,
  ): Evaluation<InputOf<T>, OutputOf<T>, ScorerNamesOf<TScorers> | 'pass', keyof TVariants & string>
}

/**
 * `evaluate` plus the Vitest-muscle-memory focus/exclusion modifiers.
 */
export interface EvaluateApi extends EvaluateFunction {
  /** Watch-mode focus: run only `.only` evaluations (and `.only` cases). */
  only: EvaluateFunction
  /** Exclusion: collected and reported as skipped, never executed. */
  skip: EvaluateFunction
}

// ─────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────

/**
 * Internal storage key for an Evaluation's normalized definition. The engine
 * and the collector read it; never part of the public contract.
 *
 * @internal
 */
export const EVALUATION_INTERNAL: unique symbol = Symbol('crux.quality.evaluation')

/** Read the normalized definition behind an Evaluation. @internal */
export function getEvaluationDefinition(evaluation: Evaluation<never, never, string, string>): EvaluationDefinition {
  const definition = (evaluation as unknown as Record<typeof EVALUATION_INTERNAL, EvaluationDefinition | undefined>)[
    EVALUATION_INTERNAL
  ]
  if (definition === undefined) {
    throw new TypeError('Expected a Crux Quality Evaluation (missing internal definition).')
  }
  return definition
}

/** The erased options shape the implementation works with. @internal */
interface RawEvaluateOptions {
  task?: unknown
  data?: unknown
  expect?: unknown
  scorers?: unknown
  params?: unknown
  variants?: unknown
  baseline?: unknown
  trials?: unknown
  gates?: unknown
  replay?: unknown
  concurrency?: unknown
  timeoutMs?: unknown
  tags?: unknown
  description?: unknown
}

function isDataset(value: unknown): value is RawDataset {
  return value !== null && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'CruxDataset'
}

function normalizeData(data: unknown): { cases: RawCase[]; datasets: RawDataset[] } {
  const items = isDataset(data) ? [data] : data
  if (!Array.isArray(items)) {
    throw new TypeError('evaluate(): `data` must be an array of cases/datasets or a dataset().')
  }
  const cases: RawCase[] = []
  const datasets: RawDataset[] = []
  for (const item of items) {
    if (isDataset(item)) {
      datasets.push(item)
      continue
    }
    if (item === null || typeof item !== 'object') {
      throw new TypeError('evaluate(): every `data` entry must be a case object or a dataset().')
    }
    const rawCase = item as RawCase
    if (rawCase.input === undefined && !Array.isArray(rawCase.turns)) {
      throw new TypeError('evaluate(): a case needs `input` (or `turns` on multi-turn tasks).')
    }
    cases.push(rawCase)
  }
  return { cases, datasets }
}

function normalizeScorers(scorers: unknown): RawScorer[] {
  if (scorers === undefined) return []
  const resolved = typeof scorers === 'function' ? scorers(boundScorerLib()) : scorers
  if (!Array.isArray(resolved)) {
    throw new TypeError('evaluate(): `scorers` must be an array of scorer functions or a factory returning one.')
  }
  for (const scorer of resolved) {
    if (typeof scorer !== 'function') {
      throw new TypeError('evaluate(): every scorer must be a function ({ input, output, expected }) => Score.')
    }
  }
  return resolved as RawScorer[]
}

function normalizeVariants(variants: unknown): Record<string, Record<string, unknown>> {
  if (variants === undefined) return {}
  if (variants === null || typeof variants !== 'object' || Array.isArray(variants)) {
    throw new TypeError('evaluate(): `variants` must be a record of override objects.')
  }
  const normalized: Record<string, Record<string, unknown>> = {}
  for (const [name, overrides] of Object.entries(variants)) {
    if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
      throw new TypeError(`evaluate(): variant '${name}' must be an override object.`)
    }
    normalized[name] = Object.freeze({ ...(overrides as Record<string, unknown>) })
  }
  return normalized
}

/**
 * Definition-time backstop for the type-level gate-key linkage: when every
 * scorer carries a static name, an unknown `gates.scores` key is rejected
 * immediately. Skipped when any scorer is unnamed (its score names are
 * dynamic) — mirroring the type-level degradation to `string` keys.
 */
function validateGateKeys(gates: EvaluationDefinition['gates'], scorers: readonly RawScorer[]): void {
  const scoreGates = gates?.scores
  if (scoreGates === undefined) return
  if (scorers.some((scorer) => scorer.scorerName === undefined)) return
  const known = new Set<string>(['pass'])
  for (const scorer of scorers) if (scorer.scorerName !== undefined) known.add(scorer.scorerName)
  for (const key of Object.keys(scoreGates)) {
    if (!known.has(key)) {
      throw new TypeError(
        `evaluate(): gates.scores key '${key}' does not match any scorer name ` +
          `(known: ${[...known].join(', ')}).`,
      )
    }
  }
}

function normalizeReplay(replay: unknown): EvaluationDefinition['replay'] {
  if (replay === undefined) return undefined
  if (typeof replay === 'string') return { mode: replay as ReplayMode }
  if (replay !== null && typeof replay === 'object' && typeof (replay as { mode?: unknown }).mode === 'string') {
    return replay as { mode: ReplayMode; cassette?: string | Cassette }
  }
  throw new TypeError("evaluate(): `replay` must be a ReplayMode or `{ mode, cassette? }`.")
}

function createEvaluation(
  idOrOptions: string | RawEvaluateOptions,
  maybeOptions: RawEvaluateOptions | undefined,
  flags: { only: boolean; skip: boolean },
): Evaluation {
  const explicitId = typeof idOrOptions === 'string' ? idOrOptions : undefined
  const options = typeof idOrOptions === 'string' ? maybeOptions : idOrOptions
  if (explicitId !== undefined && explicitId.trim() === '') {
    throw new TypeError('evaluate(): an explicit id must be a non-empty string.')
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('evaluate(): expected an options object.')
  }
  if (options.task === undefined) throw new TypeError('evaluate(): `task` is required.')
  if (options.data === undefined) throw new TypeError('evaluate(): `data` is required.')

  const { cases, datasets } = normalizeData(options.data)
  const variants = normalizeVariants(options.variants)
  const baseline = options.baseline as string | undefined
  if (baseline !== undefined && !(baseline in variants)) {
    throw new TypeError(`evaluate(): baseline '${baseline}' does not name a declared variant.`)
  }
  const trials = options.trials === undefined ? 1 : options.trials
  if (typeof trials !== 'number' || !Number.isInteger(trials) || trials < 1) {
    throw new TypeError('evaluate(): `trials` must be a positive integer.')
  }
  const scorers = normalizeScorers(options.scorers)
  validateGateKeys(options.gates as EvaluationDefinition['gates'], scorers)

  const definition: EvaluationDefinition = Object.freeze({
    id: explicitId,
    description: options.description as string | undefined,
    tags: Object.freeze([...((options.tags as readonly string[] | undefined) ?? [])]),
    task: options.task as EvaluationDefinition['task'],
    cases: Object.freeze(cases),
    datasets: Object.freeze(datasets),
    expect: options.expect as EvaluationDefinition['expect'],
    scorers: Object.freeze(scorers),
    params: options.params as EvaluationDefinition['params'],
    variants: Object.freeze(variants),
    baseline,
    trials,
    gates: options.gates as EvaluationDefinition['gates'],
    replay: normalizeReplay(options.replay),
    concurrency: options.concurrency as number | undefined,
    timeoutMs: options.timeoutMs as number | undefined,
    flags: Object.freeze({ ...flags }),
    source: 'file',
  })

  const manifest = buildManifest(definition)

  return Object.freeze({
    _tag: 'CruxEvaluation' as const,
    id: explicitId,
    manifest,
    run: () => notImplemented('phase 2', 'evaluation.run()'),
    [EVALUATION_INTERNAL]: definition,
  }) as Evaluation
}

function makeEvaluateFunction(flags: { only: boolean; skip: boolean }): EvaluateFunction {
  return ((idOrOptions: string | RawEvaluateOptions, maybeOptions?: RawEvaluateOptions) =>
    createEvaluation(idOrOptions, maybeOptions, flags)) as unknown as EvaluateFunction
}

/**
 * Define a runnable Quality Evaluation.
 *
 * The task is the sole inference anchor: anchor on a Crux primitive and
 * annotate nothing else — case inputs, `ctx.output`, variant overrides, gate
 * keys, and the returned Experiment are all typed from it. Rung 0 is just
 * `task` + `data`; every later rung (scorers, variants, gates, replay) adds
 * keys to the same object, never restructures.
 *
 * @example Rung 1 — a smoke evaluation
 * ```ts
 * // support.eval.ts
 * import { evaluate } from '@crux/core/quality'
 * import { supportPrompt } from '../prompts'
 *
 * export default evaluate({
 *   task: supportPrompt,
 *   data: [
 *     { input: { question: 'How do refunds work?', locale: 'en' } },
 *     { input: { question: 'Hoe werkt een refund?', locale: 'nl' } },
 *   ],
 * })
 * ```
 *
 * @example Rung 3 — scorers, gates, and a model bakeoff
 * ```ts
 * export default evaluate('support.refunds', {
 *   task: supportPrompt,
 *   data: goldenSet,
 *   scorers: (s) => [s.judge({ name: 'helpful', rubric: '…', select: (o) => o.answer })],
 *   variants: { cheap: { model: 'gpt-5-mini' } },
 *   baseline: 'cheap',
 *   gates: { scores: { helpful: { min: 0.7 } } },
 * })
 * ```
 */
export const evaluate: EvaluateApi = Object.assign(makeEvaluateFunction({ only: false, skip: false }), {
  only: makeEvaluateFunction({ only: true, skip: false }),
  skip: makeEvaluateFunction({ only: false, skip: true }),
}) as EvaluateApi
