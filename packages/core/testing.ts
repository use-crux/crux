/**
 * Framework-agnostic prompt evaluation runner.
 *
 * Runs a prompt against multiple models and test cases with concurrency control,
 * producing a structured report. Designed to plug into Vitest, Jest, or CLI scripts.
 *
 * Import from `@crux/core/testing`.
 *
 * @example
 * ```ts
 * import { evaluatePrompt } from '@crux/core/testing'
 * import { generate } from '@crux/ai'
 *
 * const report = await evaluatePrompt({
 *   prompt: analyzeSentiment,
 *   generate,
 *   models: [openai('gpt-4o'), anthropic('claude-sonnet-4-20250514')],
 *   cases: [
 *     {
 *       name: 'positive',
 *       input: { text: 'Amazing product!' },
 *       assert: (r) => r.object?.sentiment === 'positive',
 *     },
 *   ],
 *   concurrency: 3,
 * })
 *
 * console.log(report.summary) // { total: 2, passed: 2, failed: 0, byModel: {...} }
 * ```
 *
 * @module
 */

import type { z } from 'zod'
import type { Prompt, Context, ContextEntry, MergedInput, AnyModel, AnyPrompt, PromptConfig } from './types'
import { getRuntime } from './runtime'
import { prompt as definePrompt } from './define'
import type { Grounding, Citation, CitationValidationArtifact } from './citations'
import { citationSchema, resolveCitations } from './citations'
import type { Retriever, RetrieverHit, RetrievalPipelineTrace } from './retrieval'

/**
 * Narrowed shape of provider/API errors thrown by adapters.
 *
 * AI SDK and OpenRouter attach `statusCode`, `data`, `responseBody`, and
 * `cause` on top of the standard `Error` interface. Treating the input as
 * this structural extension lets us read the fields without `any` casts.
 */
interface ApiErrorShape extends Error {
  statusCode?: unknown
  status?: unknown
  data?: { error?: { metadata?: { raw?: unknown } } } & Record<string, unknown>
  responseBody?: unknown
  cause?: unknown
}

/**
 * Extract a useful error message from API/generation errors.
 * Digs into nested error structures common in AI SDK and provider errors.
 */
function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const apiErr = err as ApiErrorShape

  const status = apiErr.statusCode ?? apiErr.status
  const prefix = status ? `[${status}] ` : ''

  // Try to extract from the parsed .data property first (APICallError sets this from Zod parsing).
  // OpenRouter wraps upstream errors: the actual error is in error.metadata.raw, not error.message.
  const data = apiErr.data
  if (data && typeof data === 'object') {
    const raw = data.error?.metadata?.raw
    if (raw != null) {
      const msg = extractFromRaw(raw)
      if (msg) return `${prefix}${msg}`
    }
  }

  // Fall back to responseBody string (AI SDK's APICallError stores the raw HTTP body here).
  const responseBody = apiErr.responseBody
  if (typeof responseBody === 'string' && responseBody.length > 0) {
    try {
      const body = JSON.parse(responseBody) as
        | {
            error?: { metadata?: { raw?: unknown }; message?: string }
            message?: string
          }
        | null
      // Again check metadata.raw first
      const raw = body?.error?.metadata?.raw
      if (raw != null) {
        const msg = extractFromRaw(raw)
        if (msg) return `${prefix}${msg}`
      }
      // Fall back to the top-level error message
      const msg = body?.error?.message ?? body?.message
      if (typeof msg === 'string' && msg.length > 0) {
        return `${prefix}${msg}`
      }
    } catch {
      if (responseBody.length < 500) return `${prefix}${responseBody}`
    }
  }

  // Check for cause chain
  const cause = apiErr.cause
  if (cause instanceof Error && cause.message !== err.message) {
    return `${prefix}${err.message} — ${cause.message}`
  }

  return `${prefix}${err.message}`
}

/**
 * Best-effort model identifier extraction.
 *
 * Models in `@crux/core/testing` are SDK-agnostic — they may be strings
 * (e.g. `'gpt-4o'`) or wrapped instances exposing `.modelId`. This helper
 * narrows from `unknown` and falls back to `'unknown'` when neither.
 */
function getModelId(model: unknown): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object') {
    const id = (model as { modelId?: unknown }).modelId
    if (typeof id === 'string') return id
  }
  return 'unknown'
}

/** Extract a human-readable message from OpenRouter's metadata.raw field. */
function extractFromRaw(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string } | null
      return parsed?.error?.message ?? parsed?.message ?? raw
    } catch {
      return raw
    }
  }
  if (raw && typeof raw === 'object') {
    const candidate = raw as { error?: { message?: string }; message?: string }
    const msg = candidate.error?.message ?? candidate.message
    if (typeof msg === 'string') return msg
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────
// Assertions
// ─────────────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  const s = JSON.stringify(v)
  return s && s.length > 120 ? s.slice(0, 120) + '…' : (s ?? String(v))
}

function fail(msg: string): never {
  throw new Error(msg)
}

/** Failure categories for eval result classification. */
export type FailureCategory =
  | 'format' // Output schema/structure wrong
  | 'reasoning' // Logically incorrect conclusion
  | 'hallucination' // Invented facts/data
  | 'incomplete' // Missing required content
  | 'tool_misuse' // Wrong tool or bad parameters
  | 'off_topic' // Didn't address the query
  | 'constraint' // Violated stated constraints
  | 'timeout' // Timed out
  | 'api_error' // Provider/API error
  | 'unknown'

/**
 * Deterministic failure classifier. Categorizes errors by pattern matching
 * on error messages and output structure. No LLM call needed.
 */
function classifyFailureSync(error: string, output: unknown): FailureCategory {
  const e = error.toLowerCase()

  // API/provider errors
  if (e.includes('timed out')) return 'timeout'
  if (e.includes('rate limit') || e.includes('429') || e.includes('500') || e.includes('503')) return 'api_error'
  if (e.includes('api') || e.includes('provider') || e.includes('network') || e.includes('fetch')) return 'api_error'

  // Format/schema errors
  if (e.includes('parse') || e.includes('schema') || e.includes('validation') || e.includes('typeof')) return 'format'
  if (e.includes('to be instance of') || e.includes('to be defined') || e.includes('to have property')) return 'format'

  // Completeness
  if (e.includes('length') && (e.includes('>= ') || e.includes('greater'))) return 'incomplete'
  if (e.includes('empty') || e.includes('missing') || e.includes('required')) return 'incomplete'

  // Constraint violations
  if (e.includes('constraint') || e.includes('<= ') || e.includes('less than')) return 'constraint'

  // Value mismatches (likely reasoning errors)
  if (e.includes('to be one of') || e.includes('to be ')) return 'reasoning'

  // If output is null/undefined, likely an API error
  if (output == null) return 'api_error'

  return 'unknown'
}

/**
 * Assertion matchers returned by `expect()`.
 *
 * Follows the same API as Vitest/Jest matchers. Throws a descriptive
 * `Error` on failure — `evaluatePrompt()` catches these and records
 * the message in the eval report.
 *
 * Chain `.not` to negate any matcher: `expect(value).not.toBe(0)`.
 */
export interface Matchers {
  /** Strict equality (`Object.is`). */
  toBe(expected: unknown): void
  /** Asserts value is not `null` or `undefined`. */
  toBeDefined(): void
  /** Asserts `typeof value === type`. */
  toBeTypeOf(type: string): void
  /** Asserts value is included in the given array. */
  toBeOneOf(values: unknown[]): void
  /** Asserts `value instanceof cls`. */
  toBeInstanceOf(cls: Function): void
  /** Asserts `value > n`. */
  toBeGreaterThan(n: number): void
  /** Asserts `value >= n`. */
  toBeGreaterThanOrEqual(n: number): void
  /** Asserts `value <= n`. */
  toBeLessThanOrEqual(n: number): void
  /** Asserts the value is a non-null object with the given key. */
  toHaveProperty(key: string): void
  /** Negates the next matcher. */
  not: Matchers
}

function matchers(actual: unknown, negated = false): Matchers {
  const ok = (cond: boolean, msg: string) => {
    if (negated ? cond : !cond) fail(msg)
  }
  return {
    toBe(expected) {
      ok(Object.is(actual, expected), `expected ${fmt(actual)} to be ${fmt(expected)}`)
    },
    toBeDefined() {
      ok(actual !== undefined && actual !== null, `expected value to be defined, got ${fmt(actual)}`)
    },
    toBeTypeOf(type) {
      ok(typeof actual === type, `expected ${fmt(actual)} to be typeof "${type}", got "${typeof actual}"`)
    },
    toBeOneOf(values) {
      ok(values.includes(actual), `expected ${fmt(actual)} to be one of ${fmt(values)}`)
    },
    toBeInstanceOf(cls) {
      ok(actual instanceof cls, `expected ${fmt(actual)} to be instance of ${cls.name}`)
    },
    toBeGreaterThan(n) {
      ok((actual as number) > n, `expected ${fmt(actual)} to be greater than ${n}`)
    },
    toBeGreaterThanOrEqual(n) {
      ok((actual as number) >= n, `expected ${fmt(actual)} to be >= ${n}`)
    },
    toBeLessThanOrEqual(n) {
      ok((actual as number) <= n, `expected ${fmt(actual)} to be <= ${n}`)
    },
    toHaveProperty(key) {
      ok(actual != null && typeof actual === 'object' && key in actual, `expected object to have property "${key}"`)
    },
    get not() {
      return matchers(actual, !negated)
    },
  }
}

/**
 * Standalone assertion function for eval test cases.
 *
 * Provides a Vitest/Jest-compatible `expect()` API that works without
 * a test runner. Throws a descriptive `Error` on failure, which
 * `evaluatePrompt()` catches and records in the eval report.
 *
 * @example
 * ```ts
 * import { evaluation, expect } from '@crux/core/testing'
 *
 * export const myEval = evaluation({
 *   prompt: myPrompt,
 *   mode: 'structured',
 *   cases: [{
 *     name: 'validates output',
 *     input: { text: 'hello' },
 *     assert: (r) => {
 *       expect(r.object).toBeDefined()
 *       expect(r.object.score).toBeGreaterThan(0)
 *       expect(r.object.label).toBeOneOf(['positive', 'negative'])
 *       return true
 *     },
 *   }],
 * })
 * ```
 */
export function expect(actual: unknown): Matchers {
  return matchers(actual)
}

// ─────────────────────────────────────────────────────────────────
// Eval Reporter (global hook for devtools integration)
// ─────────────────────────────────────────────────────────────────

/**
 * Callback interface for eval progress reporting.
 *
 * When set via `updateRuntime({ evalReporter })`, `evaluatePrompt()` automatically
 * calls these hooks — no user code changes needed.
 */
export interface EvalReporter {
  onStart(info: {
    evalId: string
    promptId: string | undefined
    models: string[]
    caseNames: string[]
    totalCases: number
  }): void
  onCase(
    result: EvalCaseResult & {
      evalId: string
      completedCount: number
      usage?: EvalTokenUsage
      cost?: number
    },
  ): void
  onEnd(info: { evalId: string; durationMs: number; summary: EvalReport['summary'] }): void
}

/** Token usage that adapters attach to results. All fields are best-effort. */
export interface EvalResultUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  [key: string]: unknown
}

/** Metadata block attached to adapter results (when produced by `@crux/ai` adapters). */
export interface EvalResultMeta {
  usage?: EvalResultUsage
  cost?: number
  finishReason?: string
  traceId?: string
  [key: string]: unknown
}

/**
 * SDK-agnostic result type for eval assertions.
 *
 * - Structured prompts (with `output`): `result.object` is typed as `z.infer<TOutput>`
 * - Text prompts (no `output`): `result.text` is a string
 *
 * `text` is required for text-mode prompts and optional for structured-mode
 * (AI SDK's `generateObject()` doesn't surface `text`; `generateText()` does).
 * The index signature allows adapter-specific fields (`.usage`, `.finishReason`, etc.)
 * to pass through without type errors.
 */
export type EvalResult<TOutput extends z.ZodType | undefined = undefined> = {
  usage?: EvalResultUsage
  _meta?: EvalResultMeta
  [key: string]: unknown
} & (TOutput extends z.ZodType<infer O> ? { object: O; text?: string } : { text: string })

/** A single evaluation test case. */
export interface EvalCase<TInput = Record<string, unknown>, TResult = EvalResult> {
  /** Descriptive name for this test case (used in reports). */
  name: string
  /** Input to pass to the generate call. */
  input: TInput
  /**
   * Assertion function — receives the result and returns
   * `true` if the case passed, `false` otherwise. May be async.
   */
  assert: (result: TResult) => boolean | Promise<boolean>
}

/** Token usage from the generation call. */
export interface EvalTokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** Result of a single case execution against a single model. */
export interface EvalCaseResult {
  /** Name of the test case. */
  caseName: string
  /** Identifier of the model used. */
  modelId: string
  /** Whether the assertion passed. */
  passed: boolean
  /** Wall-clock duration in milliseconds. */
  durationMs: number
  /** Error message if the case threw (generation failure, assertion error, etc.). */
  error?: string
  /** Token usage from the generation call (when available). */
  usage?: EvalTokenUsage
  /** Cost in USD from the provider (when available). */
  cost?: number
  /** Trace ID from the devtools middleware (when devtools is enabled). */
  traceId?: string
  /** The input that was passed to the prompt. */
  input?: unknown
  /** Full LLM output for debugging (structured object or text). */
  output?: unknown
  /** Per-scorer results. Only populated when `scores` is defined on the eval. */
  scores?: Record<string, { score: number; reasoning?: string }>
  /** Failure category (when `classifyFailures` is enabled). */
  failureCategory?: string
}

/** Complete evaluation report with per-case results and aggregated summary. */
export interface EvalReport {
  /** Individual results for every (case, model) combination. */
  results: EvalCaseResult[]
  /** Aggregated statistics. */
  summary: {
    /** Total number of (case, model) combinations executed. */
    total: number
    /** Number of passed assertions. */
    passed: number
    /** Number of failed assertions or errors. */
    failed: number
    /** Breakdown by model ID. */
    byModel: Record<string, { total: number; passed: number; failed: number }>
  }
}

/**
 * A generate function from any adapter.
 *
 * Matches the generic signature of `generate()` from `@crux/ai`,
 * `openai.generate()` from `@crux/openai`, etc. — the function is generic
 * over the prompt's input/output/contexts so callers retain typed `result.object`
 * and case `input` autocomplete.
 *
 * `TContexts` is constrained to `readonly Context<z.ZodType>[]` to align with
 * how adapter packages currently express their context arrays; `Context<z.ZodType>`
 * is bivariantly compatible with the wider `ContextEntry` union via TS variance.
 *
 * `model` is intentionally `any` at this seam — each adapter narrows it to its
 * own SDK type (e.g. `LanguageModel` for `@crux/ai`). Function parameter
 * contravariance prevents a single concrete type from satisfying every
 * adapter's strict shape, so we use `any` here as a documented bridge. Users
 * who want typed model arguments at the call site get them from the adapter's
 * direct `generate()` — `GenerateFn` is the abstract bridge type for eval
 * runners that consume any adapter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter bridge; see jsdoc above
export type GenerateFn = <
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly Context<z.ZodType>[],
>(
  prompt: Prompt<TOwnInput, TOutput, TContexts>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter bridge; opts/return shapes vary per adapter
  opts: any,
) => Promise<unknown>

/**
 * Options for `evaluatePrompt()`.
 *
 * Generic over the prompt's own input schema, output schema, and contexts —
 * so `cases[].input` and `cases[].assert(result)` are typed from the prompt
 * without manual annotation.
 *
 * The `TContexts` bound matches `AnyPrompt` (`readonly ContextEntry[]`) so
 * heterogeneous registries (`createPrompts()` outputs, `EvalDef.prompt`,
 * etc.) flow through without re-narrowing.
 */
export interface EvalOptions<
  TOwnInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType | undefined = z.ZodType | undefined,
  TContexts extends readonly ContextEntry[] = readonly ContextEntry[],
> {
  /** The prompt to evaluate. */
  prompt: Prompt<TOwnInput, TOutput, TContexts>
  /** The adapter generate function (e.g. `generate` from `@crux/ai`). */
  generate: GenerateFn
  /** Models to test against (forms the cross-product with `cases`). */
  models: unknown[]
  /**
   * Test cases — each will be run against every model.
   * When omitted, reads from `prompt.config.tests`.
   * Input is typed from the prompt's merged input; `result.object` is typed
   * when the prompt declares a structured output schema.
   */
  cases?: EvalCase<MergedInput<TOwnInput, TContexts>, EvalResult<TOutput>>[]
  /** Maximum concurrent API calls. Defaults to `3`. */
  concurrency?: number
  /** Optional callback fired after each case completes (for progress reporting). */
  onCaseComplete?: (result: EvalCaseResult) => void
  /** Per-case timeout in milliseconds. When set, each generate() call is raced against this timeout. */
  timeout?: number
  /** Scorers to run alongside assertions. Each scores every case. */
  scores?: EvalScorer[]
  /** Auto-classify failures into categories. */
  classifyFailures?: boolean
}

let evalCounter = 0

/** Generate a unique identifier for an eval run (combines timestamp, counter, and random suffix). */
function generateEvalId(): string {
  evalCounter++
  return `eval-${Date.now()}-${evalCounter}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Run a prompt evaluation across a matrix of models and test cases.
 *
 * Executes the adapter's `generate()` for every (model, case) combination with
 * a concurrency limit, then aggregates results into an `EvalReport`.
 *
 * @param options - Eval configuration including prompt, generate function, models, and test cases.
 * @returns The complete evaluation report with per-case results and aggregated summary.
 *
 * @example
 * ```ts
 * import { generate } from '@crux/ai'
 * import { evaluatePrompt } from '@crux/core/testing'
 *
 * const report = await evaluatePrompt({
 *   prompt: analyzeSentiment,
 *   generate,
 *   models: [openai('gpt-4o-mini')],
 *   cases: [
 *     { name: 'positive', input: { text: 'Love it!' }, assert: (r) => r.object.sentiment === 'positive' },
 *     { name: 'negative', input: { text: 'Terrible.' }, assert: (r) => r.object.sentiment === 'negative' },
 *   ],
 * })
 * expect(report.summary.failed).toBe(0)
 * ```
 */
export async function evaluatePrompt<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
>(options: EvalOptions<TOwnInput, TOutput, TContexts>): Promise<EvalReport> {
  type TInput = MergedInput<TOwnInput, TContexts>
  type TResult = EvalResult<TOutput>
  const { prompt, generate, models, concurrency = 3, onCaseComplete, timeout } = options

  // Use provided cases, or fall back to prompt.config.tests
  const cases = options.cases ?? (prompt.config.tests as EvalCase<TInput, TResult>[] | undefined)
  if (!cases || cases.length === 0) {
    throw new Error(
      `evaluatePrompt: No test cases provided and prompt "${prompt.id ?? 'unnamed'}" has no tests defined. ` +
        `Either pass \`cases\` or define \`tests\` on the prompt.`,
    )
  }
  const results: EvalCaseResult[] = []
  const reporter = getRuntime().evalReporter
  const evalId = generateEvalId()
  const evalStart = Date.now()

  // Build the (model, case) work matrix
  const work: Array<{
    model: unknown
    evalCase: EvalCase<TInput, TResult>
    modelId: string
  }> = []
  const modelIds: string[] = []
  for (const model of models) {
    const modelId = getModelId(model)
    modelIds.push(modelId)
    for (const evalCase of cases) {
      work.push({ model, evalCase, modelId })
    }
  }

  // Notify reporter of eval start
  reporter?.onStart({
    evalId,
    promptId: prompt.id,
    models: modelIds,
    caseNames: cases.map((c) => c.name),
    totalCases: work.length,
  })

  // Process with concurrency limit using a simple worker pool
  let idx = 0
  let completedCount = 0
  async function next(): Promise<void> {
    while (idx < work.length) {
      const item = work[idx++]
      const start = Date.now()
      let passed = false
      let error: string | undefined
      let usage: EvalTokenUsage | undefined
      let cost: number | undefined
      let traceId: string | undefined
      let output: unknown | undefined
      let caseScores: Record<string, { score: number; reasoning?: string }> | undefined

      try {
        // `evaluatePrompt`'s TContexts is the wider `ContextEntry[]` (matches AnyPrompt
        // and tree-flattened registries), while adapter `generate` functions narrow to
        // `Context<z.ZodType>[]`. The downcast is safe — the resolved prompt sees the
        // same runtime contexts either way.
        const generateCall = generate(prompt as unknown as Parameters<GenerateFn>[0], {
          model: item.model,
          input: item.evalCase.input,
        })
        const rawResult = timeout
          ? await Promise.race([
              generateCall,
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Eval case "${item.evalCase.name}" timed out after ${timeout}ms`)),
                  timeout,
                ),
              ),
            ])
          : await generateCall
        // `GenerateFn` returns `Promise<unknown>` (adapter-shape bridge);
        // narrow to the eval-result shape we know each adapter produces.
        const result = rawResult as TResult & {
          object?: unknown
          text?: string
          usage?: EvalResultUsage
          _meta?: EvalResultMeta
        }

        // Capture output for debugging (structured object or text)
        output = result?.object ?? result?.text

        // Extract usage/cost from adapter result
        const u = result?.usage ?? result?._meta?.usage
        if (u) {
          usage = {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            totalTokens: u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
          }
        }
        cost = result?._meta?.cost
        traceId = result?._meta?.traceId as string | undefined

        passed = await item.evalCase.assert(result as TResult)

        // Run scorers if configured (alongside assertions, not replacing them)
        if (options.scores && options.scores.length > 0) {
          caseScores = {}
          const inputStr =
            typeof item.evalCase.input === 'string' ? item.evalCase.input : JSON.stringify(item.evalCase.input)
          const outputStr = typeof output === 'string' ? output : JSON.stringify(output)
          for (const scorer of options.scores) {
            try {
              const scoreResult = await scorer.score(
                { input: inputStr, output: outputStr },
                { generate, model: item.model },
              )
              caseScores[scorer.id] = scoreResult
            } catch (scoreErr) {
              caseScores[scorer.id] = {
                score: 0,
                reasoning: `Scorer error: ${extractErrorMessage(scoreErr)}`,
              }
            }
          }
        }
      } catch (err) {
        passed = false
        error = extractErrorMessage(err)
        // If the message is still generic, append diagnostic trace
        if (error.includes('Provider returned error') || error.includes('Bad Request')) {
          const e = err as { url?: unknown; name?: unknown; responseBody?: unknown }
          const trace: string[] = []
          if (typeof e.url === 'string') trace.push(`url=${e.url}`)
          if (typeof e.name === 'string' && e.name !== 'Error') trace.push(`type=${e.name}`)
          if (typeof e.responseBody === 'string') {
            trace.push(`body=${e.responseBody.slice(0, 500)}`)
          }
          if (trace.length > 0) error += ` [${trace.join(', ')}]`
        }
      }

      // Classify failure if configured and case failed
      let failureCategory: string | undefined
      if (!passed && error && options.classifyFailures) {
        failureCategory = classifyFailureSync(error, output)
      }

      const caseResult: EvalCaseResult = {
        caseName: item.evalCase.name,
        modelId: item.modelId,
        passed,
        durationMs: Date.now() - start,
        error,
        usage,
        cost,
        traceId,
        input: item.evalCase.input,
        output,
        scores: caseScores,
        failureCategory,
      }
      results.push(caseResult)
      completedCount++
      onCaseComplete?.(caseResult)
      reporter?.onCase({ ...caseResult, evalId, completedCount })
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, work.length) }, () => next())
  await Promise.all(workers)

  // Aggregate summary
  const byModel: Record<string, { total: number; passed: number; failed: number }> = {}
  for (const r of results) {
    if (!byModel[r.modelId]) {
      byModel[r.modelId] = { total: 0, passed: 0, failed: 0 }
    }
    byModel[r.modelId].total++
    if (r.passed) byModel[r.modelId].passed++
    else byModel[r.modelId].failed++
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    byModel,
  }

  reporter?.onEnd({
    evalId,
    durationMs: Date.now() - evalStart,
    summary,
  })

  return { results, summary }
}

// ─────────────────────────────────────────────────────────────────
// RAG Eval Datasets & Reports
// ─────────────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type ExpectedSource =
  | {
      type?: 'source'
      namespace?: string
      sourceId: string
      chunkId?: string
    }
  | {
      type: 'metadata'
      where: Record<string, JsonValue>
    }

export interface RagExpectedAnswer {
  contains?: readonly string[]
  equals?: string
  matches?: string
}

export interface RagExpected {
  sources?: readonly ExpectedSource[]
  citations?: readonly ExpectedSource[]
  answer?: RagExpectedAnswer
}

export type RagFailureType =
  | 'retrieval_miss'
  | 'low_precision'
  | 'invalid_citation'
  | 'unsupported_answer'
  | 'judge_failed'
  | 'timeout'
  | 'error'

export type RagCaseStatus = 'passed' | 'failed' | 'skipped' | 'error'

export interface RagCaseAssertionContext<TInput extends Record<string, unknown> = Record<string, unknown>> {
  case: RagEvalCase<TInput>
  output: unknown
  text?: string
  hits: readonly RetrieverHit[]
  citations: readonly Citation[]
}

export type RagCaseAssertion<TInput extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: RagCaseAssertionContext<TInput>,
) => boolean | void | Promise<boolean | void>

export interface RagEvalCase<TInput extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string
  readonly name?: string
  readonly input: TInput
  readonly expected?: RagExpected
  readonly assert?: RagCaseAssertion<TInput>
  readonly tags?: readonly string[]
  readonly metadata?: Record<string, JsonValue>
}

export interface RagDataset<TInput extends Record<string, unknown> = Record<string, unknown>> {
  readonly _tag: 'RagDataset'
  readonly id: string
  readonly description?: string
  readonly cases: readonly RagEvalCase<TInput>[]
}

export interface RagDatasetJson<TInput extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  description?: string
  cases: Array<Omit<RagEvalCase<TInput>, 'assert'>>
}

export type MetricResult =
  | { status: 'passed'; score: number; threshold?: number }
  | { status: 'failed'; score: number; threshold?: number; reason: string }
  | { status: 'not_applicable'; reason: string }

export interface RetrievalCaseMetrics {
  status: MetricResult['status']
  hitRateAtK: Record<number, MetricResult>
  recallAtK: Record<number, MetricResult>
  precisionAtK: Record<number, MetricResult>
  mrr: MetricResult
  ndcg: MetricResult
}

export interface RagEvidencePreview {
  namespace: string
  sourceId: string
  chunkId: string
  score: number
  matchedQueries?: readonly string[]
  rank?: number
  contentPreview: string
  parentContentPreview?: string
  provenance?: {
    page?: number
    table?: string
    span?: string
  }
}

export interface RagTracePreview {
  available: boolean
  trace?: RetrievalPipelineTrace
  reason?: string
}

export interface RagAnswerResult {
  status: MetricResult['status']
  metrics: Record<string, MetricResult>
  text?: string
  output?: unknown
}

export interface RagCitationResult {
  status: MetricResult['status']
  metrics: Record<string, MetricResult>
  citations: readonly Citation[]
  artifact?: CitationValidationArtifact
}

export interface RagEvalCaseResult<TInput extends Record<string, unknown> = Record<string, unknown>> {
  caseId: string
  caseName: string
  configRole?: 'baseline' | 'candidate' | 'single'
  configLabel?: string
  input: TInput
  status: RagCaseStatus
  passed: boolean
  durationMs: number
  failureTypes: readonly RagFailureType[]
  primaryFailureType?: RagFailureType
  error?: string
  evidence: readonly RagEvidencePreview[]
  retrieval: {
    metrics: RetrievalCaseMetrics
    hitCount: number
  }
  answer: RagAnswerResult
  citations: RagCitationResult
  trace: RagTracePreview
  usage?: EvalTokenUsage
  cost?: number
}

export interface RagFailureGroup {
  type: RagFailureType
  count: number
  caseIds: readonly string[]
}

export interface RagRetrievalSummary {
  hitRateAtK: Record<number, number>
  recallAtK: Record<number, number>
  precisionAtK: Record<number, number>
  mrr: number
  ndcg: number
}

export interface RagEvalSummary {
  total: number
  passed: number
  failed: number
  passRate: number
  byFailureType: Record<RagFailureType, number>
  failureGroups: readonly RagFailureGroup[]
  retrieval?: RagRetrievalSummary
  citations?: {
    validityRate: number
  }
  answer?: {
    passRate: number
  }
}

export interface RagEvalComparison {
  baselineLabel: string
  candidateLabel: string
  metricDeltas: {
    passRate: number
    failed: number
    avgDurationMs: number
  }
  caseDeltas: Array<{
    caseId: string
    baseline: { status: RagCaseStatus; failureTypes: readonly RagFailureType[] }
    candidate: { status: RagCaseStatus; failureTypes: readonly RagFailureType[] }
  }>
}

export interface FailedCaseExportOptions {
  includeActual?: boolean
  tag?: string
}

export interface RagEvalReport<TInput extends Record<string, unknown> = Record<string, unknown>> {
  readonly _tag: 'RagEvalReport'
  readonly id: string
  readonly datasetId?: string
  readonly startedAt: string
  readonly endedAt: string
  readonly summary: RagEvalSummary
  readonly cases: readonly RagEvalCaseResult<TInput>[]
  readonly comparisons?: readonly RagEvalComparison[]
  exportFailedCases(options?: FailedCaseExportOptions): RagDatasetJson<TInput>
}

export interface RagEvalReporter {
  onStart(info: {
    evalId: string
    datasetId?: string
    caseCount: number
    configLabels?: string[]
  }): void
  onCase(
    result: RagEvalCaseResult<Record<string, unknown>> & {
      evalId: string
      completedCount: number
    },
  ): void
  onEnd(info: { evalId: string; status: 'success' | 'error'; summary: RagEvalSummary }): void
}

export interface RagJudgeResult {
  score: number
  passed?: boolean
  reasoning?: string
}

export type RagJudge<TInput extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: RagCaseAssertionContext<TInput>,
) => Promise<RagJudgeResult> | RagJudgeResult

export interface RagEvalTarget {
  prompt: AnyPrompt
  grounding: Grounding
}

export interface RetrievalEvalOptions<TInput extends Record<string, unknown>> {
  id: string
  retriever: Retriever
  dataset: RagDataset<TInput>
  k?: readonly number[]
  limit?: number
}

export interface GroundedAnswerEvalOptions<TInput extends Record<string, unknown>> {
  id: string
  target: RagEvalTarget
  generate: GenerateFn
  dataset: RagDataset<TInput>
  model?: unknown
  judges?: Record<string, RagJudge<TInput>>
  timeout?: number
  configRole?: 'baseline' | 'candidate' | 'single'
  configLabel?: string
}

export interface RagConfig<TInput extends Record<string, unknown>> {
  label: string
  grounding: Grounding
  prompt?: AnyPrompt
  model?: unknown
  judges?: Record<string, RagJudge<TInput>>
}

export interface RagEvalOptions<TInput extends Record<string, unknown>> extends GroundedAnswerEvalOptions<TInput> {
  configs?: {
    baseline: RagConfig<TInput>
    candidate: RagConfig<TInput>
  }
}

export interface RagEvalDef<TInput extends Record<string, unknown> = Record<string, unknown>> extends RagEvalOptions<TInput> {
  readonly _tag: 'RagEvalDef'
}

const DEFAULT_RAG_K = [1, 3, 5, 10] as const
const FAILURE_PRECEDENCE: readonly RagFailureType[] = [
  'error',
  'timeout',
  'retrieval_miss',
  'invalid_citation',
  'unsupported_answer',
  'judge_failed',
  'low_precision',
]

export function ragDataset<const TInput extends Record<string, unknown>>(
  config: Omit<RagDataset<TInput>, '_tag'>,
): RagDataset<TInput> {
  if (!config.id.trim()) throw new Error('ragDataset(): id must be non-empty.')
  if (config.cases.length === 0) throw new Error('ragDataset(): cases must be non-empty.')
  const ids = new Set<string>()
  for (const testCase of config.cases) {
    if (!testCase.id.trim()) throw new Error('ragDataset(): case id must be non-empty.')
    if (ids.has(testCase.id)) throw new Error(`ragDataset(): duplicate case id "${testCase.id}".`)
    ids.add(testCase.id)
    assertPortableExpected(testCase.expected)
    assertJsonRecord(testCase.metadata, `metadata for case "${testCase.id}"`)
  }
  return Object.freeze({
    _tag: 'RagDataset' as const,
    id: config.id,
    ...(config.description ? { description: config.description } : {}),
    cases: Object.freeze([...config.cases]),
  })
}

export function ragEvaluation<const TInput extends Record<string, unknown>>(
  config: RagEvalOptions<TInput>,
): RagEvalDef<TInput> {
  return Object.freeze({
    _tag: 'RagEvalDef' as const,
    ...config,
  })
}

export function isRagEvalDef(value: unknown): value is RagEvalDef {
  return value != null && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'RagEvalDef'
}

export async function evaluateRetrieval<TInput extends Record<string, unknown>>(
  options: RetrievalEvalOptions<TInput>,
): Promise<RagEvalReport<TInput>> {
  const startedAt = new Date()
  const cases: RagEvalCaseResult<TInput>[] = []
  const reporter = getRuntime().ragEvalReporter
  reporter?.onStart({ evalId: options.id, datasetId: options.dataset.id, caseCount: options.dataset.cases.length })
  for (const testCase of options.dataset.cases) {
    const start = Date.now()
    try {
      const query = readQuestion(testCase.input)
      const retrieval = await retrieveWithOptionalTrace(options.retriever, query, { limit: options.limit })
      const metrics = evaluateRetrievalMetrics(retrieval.hits, testCase.expected?.sources, options.k ?? DEFAULT_RAG_K)
      const failureTypes = classifyRetrievalFailures(metrics)
      const result: RagEvalCaseResult<TInput> = {
        caseId: testCase.id,
        caseName: testCase.name ?? testCase.id,
        input: testCase.input,
        status: failureTypes.length === 0 ? 'passed' : 'failed',
        passed: failureTypes.length === 0,
        durationMs: Date.now() - start,
        failureTypes,
        primaryFailureType: primaryFailure(failureTypes),
        evidence: createEvidencePreview(retrieval.hits),
        retrieval: { metrics, hitCount: retrieval.hits.length },
        answer: { status: 'not_applicable', metrics: {} },
        citations: { status: 'not_applicable', metrics: {}, citations: [] },
        trace: retrieval.trace,
      }
      cases.push(result)
      reporter?.onCase({ ...eraseRagCaseInput(result), evalId: options.id, completedCount: cases.length })
    } catch (error) {
      const result = errorCase(testCase, Date.now() - start, error)
      cases.push(result)
      reporter?.onCase({ ...eraseRagCaseInput(result), evalId: options.id, completedCount: cases.length })
    }
  }
  const report = createRagReport({
    id: options.id,
    dataset: options.dataset,
    startedAt,
    cases,
  })
  reporter?.onEnd({ evalId: options.id, status: 'success', summary: report.summary })
  return report
}

export async function evaluateGroundedAnswer<TInput extends Record<string, unknown>>(
  options: GroundedAnswerEvalOptions<TInput>,
): Promise<RagEvalReport<TInput>> {
  const startedAt = new Date()
  const cases: RagEvalCaseResult<TInput>[] = []
  const reporter = getRuntime().ragEvalReporter
  reporter?.onStart({ evalId: options.id, datasetId: options.dataset.id, caseCount: options.dataset.cases.length })
  for (const testCase of options.dataset.cases) {
    const result = await evaluateGroundedAnswerCase(testCase, options)
    cases.push(result)
    reporter?.onCase({ ...eraseRagCaseInput(result), evalId: options.id, completedCount: cases.length })
  }
  const report = createRagReport({
    id: options.id,
    dataset: options.dataset,
    startedAt,
    cases,
  })
  reporter?.onEnd({ evalId: options.id, status: 'success', summary: report.summary })
  return report
}

export async function evaluateRag<TInput extends Record<string, unknown>>(
  options: RagEvalOptions<TInput>,
): Promise<RagEvalReport<TInput>> {
  if (!options.configs) return evaluateGroundedAnswer({ ...options, configRole: 'single' })

  const startedAt = new Date()
  const baselineCases: RagEvalCaseResult<TInput>[] = []
  const candidateCases: RagEvalCaseResult<TInput>[] = []
  const { baseline, candidate } = options.configs
  const reporter = getRuntime().ragEvalReporter
  reporter?.onStart({
    evalId: options.id,
    datasetId: options.dataset.id,
    caseCount: options.dataset.cases.length * 2,
    configLabels: [baseline.label, candidate.label],
  })
  for (const testCase of options.dataset.cases) {
    const baselineResult = await evaluateGroundedAnswerCase(testCase, {
      ...options,
      target: {
        prompt: baseline.prompt ?? options.target.prompt,
        grounding: baseline.grounding,
      },
      model: baseline.model ?? options.model,
      judges: baseline.judges ?? options.judges,
      configRole: 'baseline',
      configLabel: baseline.label,
    })
    baselineCases.push(baselineResult)
    reporter?.onCase({
      ...eraseRagCaseInput(baselineResult),
      evalId: options.id,
      completedCount: baselineCases.length + candidateCases.length,
    })
    const candidateResult = await evaluateGroundedAnswerCase(testCase, {
      ...options,
      target: {
        prompt: candidate.prompt ?? options.target.prompt,
        grounding: candidate.grounding,
      },
      model: candidate.model ?? options.model,
      judges: candidate.judges ?? options.judges,
      configRole: 'candidate',
      configLabel: candidate.label,
    })
    candidateCases.push(candidateResult)
    reporter?.onCase({
      ...eraseRagCaseInput(candidateResult),
      evalId: options.id,
      completedCount: baselineCases.length + candidateCases.length,
    })
  }
  const cases = [...baselineCases, ...candidateCases]
  const report = createRagReport({
    id: options.id,
    dataset: options.dataset,
    startedAt,
    cases,
    comparisons: [compareRagCases(baseline.label, candidate.label, baselineCases, candidateCases)],
  })
  reporter?.onEnd({ evalId: options.id, status: 'success', summary: report.summary })
  return report
}

async function evaluateGroundedAnswerCase<TInput extends Record<string, unknown>>(
  testCase: RagEvalCase<TInput>,
  options: GroundedAnswerEvalOptions<TInput>,
): Promise<RagEvalCaseResult<TInput>> {
  const start = Date.now()
  try {
    const resolution = await options.target.grounding.resolve(testCase.input)
    const retrievalMetrics = evaluateRetrievalMetrics(
      resolution.hits,
      testCase.expected?.sources,
      options.dataset.cases.length > 0 ? DEFAULT_RAG_K : DEFAULT_RAG_K,
    )
    const promptForEval = withGrounding(options.target.prompt, options.target.grounding)
    const generateCall = options.generate(promptForEval as Parameters<GenerateFn>[0], {
      model: options.model,
      input: testCase.input,
    })
    const raw = options.timeout
      ? await Promise.race([
          generateCall,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`RAG eval case "${testCase.id}" timed out after ${options.timeout}ms`)), options.timeout),
          ),
        ])
      : await generateCall
    const generated = normalizeGenerationResult(raw)
    const citations = selectCitations(generated.output)
    const citationResult = evaluateCitations(citations, resolution.hits, testCase.expected?.citations)
    const answer = await evaluateAnswer(testCase, generated, resolution.hits, citations, options.judges)
    const failureTypes = dedupeFailureTypes([
      ...classifyRetrievalFailures(retrievalMetrics),
      ...(citationResult.status === 'failed' ? ['invalid_citation' as const] : []),
      ...(answer.status === 'failed' ? ['unsupported_answer' as const] : []),
      ...Object.values(answer.metrics).flatMap((metric) =>
        metric.status === 'failed' && metric.reason.startsWith('Judge') ? (['judge_failed'] as const) : [],
      ),
    ])

    return {
      caseId: testCase.id,
      caseName: testCase.name ?? testCase.id,
      configRole: options.configRole,
      configLabel: options.configLabel,
      input: testCase.input,
      status: failureTypes.length === 0 ? 'passed' : 'failed',
      passed: failureTypes.length === 0,
      durationMs: Date.now() - start,
      failureTypes,
      primaryFailureType: primaryFailure(failureTypes),
      evidence: createEvidencePreview(resolution.hits),
      retrieval: { metrics: retrievalMetrics, hitCount: resolution.hits.length },
      answer,
      citations: citationResult,
      trace: await traceForGrounding(options.target.grounding.retriever, resolution.query),
      usage: generated.usage,
      cost: generated.cost,
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.toLowerCase().includes('timed out')
    return errorCase(testCase, Date.now() - start, error, isTimeout ? 'timeout' : 'error', options)
  }
}

function withGrounding(base: AnyPrompt, groundingEntry: Grounding): AnyPrompt {
  if (base.contexts.includes(groundingEntry)) return base
  const config = {
    ...base.config,
    use: [...base.contexts, groundingEntry],
  } as unknown as PromptConfig<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>
  return definePrompt(config)
}

function normalizeGenerationResult(raw: unknown): {
  output: unknown
  text?: string
  usage?: EvalTokenUsage
  cost?: number
} {
  if (!raw || typeof raw !== 'object') return { output: raw, text: typeof raw === 'string' ? raw : undefined }
  const record = raw as {
    object?: unknown
    text?: string
    usage?: EvalResultUsage
    _meta?: EvalResultMeta
  }
  const usageSource = record.usage ?? record._meta?.usage
  const usage = usageSource
    ? {
        inputTokens: usageSource.inputTokens,
        outputTokens: usageSource.outputTokens,
        totalTokens: usageSource.totalTokens ?? (usageSource.inputTokens ?? 0) + (usageSource.outputTokens ?? 0),
      }
    : undefined
  return {
    output: record.object ?? record.text,
    ...(record.text ? { text: record.text } : {}),
    ...(usage ? { usage } : {}),
    ...(typeof record._meta?.cost === 'number' ? { cost: record._meta.cost } : {}),
  }
}

function selectCitations(output: unknown): Citation[] {
  if (!output || typeof output !== 'object') return []
  const candidate = (output as { citations?: unknown }).citations
  const parsed = citationSchema.array().safeParse(candidate)
  return parsed.success ? parsed.data : []
}

async function evaluateAnswer<TInput extends Record<string, unknown>>(
  testCase: RagEvalCase<TInput>,
  generated: { output: unknown; text?: string },
  hits: readonly RetrieverHit[],
  citations: readonly Citation[],
  judges: Record<string, RagJudge<TInput>> | undefined,
): Promise<RagAnswerResult> {
  const metrics: Record<string, MetricResult> = {}
  const text = generated.text ?? extractAnswerText(generated.output)
  const expected = testCase.expected?.answer
  if (expected?.contains) {
    const missing = expected.contains.filter((needle) => !text.includes(needle))
    metrics.contains =
      missing.length === 0
        ? { status: 'passed', score: 1 }
        : { status: 'failed', score: 0, reason: `Missing expected text: ${missing.join(', ')}` }
  }
  if (expected?.equals !== undefined) {
    metrics.equals =
      text === expected.equals
        ? { status: 'passed', score: 1 }
        : { status: 'failed', score: 0, reason: `Expected answer to equal "${expected.equals}".` }
  }
  if (expected?.matches !== undefined) {
    const regex = new RegExp(expected.matches)
    metrics.matches =
      regex.test(text)
        ? { status: 'passed', score: 1 }
        : { status: 'failed', score: 0, reason: `Expected answer to match /${expected.matches}/.` }
  }
  if (testCase.assert) {
    const result = await testCase.assert({ case: testCase, output: generated.output, text, hits, citations })
    metrics.assertion =
      result === false
        ? { status: 'failed', score: 0, reason: 'Runtime assertion returned false.' }
        : { status: 'passed', score: 1 }
  }
  for (const [id, judge] of Object.entries(judges ?? {})) {
    try {
      const result = await judge({ case: testCase, output: generated.output, text, hits, citations })
      const passed = result.passed ?? result.score >= 0.5
      metrics[id] = passed
        ? { status: 'passed', score: result.score }
        : { status: 'failed', score: result.score, reason: `Judge ${id} failed.${result.reasoning ? ` ${result.reasoning}` : ''}` }
    } catch (error) {
      metrics[id] = {
        status: 'failed',
        score: 0,
        reason: `Judge ${id} errored: ${extractErrorMessage(error)}`,
      }
    }
  }
  const values = Object.values(metrics)
  if (values.length === 0) return { status: 'not_applicable', metrics, text, output: generated.output }
  return {
    status: values.some((metric) => metric.status === 'failed') ? 'failed' : 'passed',
    metrics,
    text,
    output: generated.output,
  }
}

function evaluateCitations(
  citations: readonly Citation[],
  hits: readonly RetrieverHit[],
  expected: readonly ExpectedSource[] | undefined,
): RagCitationResult {
  const metrics: Record<string, MetricResult> = {}
  if (!expected || expected.length === 0) {
    const validation = citations.length > 0 ? resolveCitations(citations, hits, { quotes: 'optional' }) : undefined
    return {
      status: validation && !validation.valid ? 'failed' : 'not_applicable',
      metrics,
      citations,
      ...(validation ? { artifact: validation.artifact } : {}),
    }
  }
  const validation = resolveCitations(citations, hits, { quotes: 'optional' })
  metrics.validity = validation.valid
    ? { status: 'passed', score: 1 }
    : { status: 'failed', score: 0, reason: validation.issues.map((issue) => issue.message).join('\n') }
  const matched = expected.filter((source) =>
    validation.citations.some((citation) =>
      matchesExpectedSource(
        {
          namespace: citation.namespace,
          sourceId: citation.sourceId,
          chunkId: citation.chunkId,
          metadata: citation.metadata ?? {},
        },
        source,
      ),
    ),
  ).length
  metrics.expectedCitations =
    matched === expected.length
      ? { status: 'passed', score: 1 }
      : {
          status: 'failed',
          score: expected.length === 0 ? 1 : matched / expected.length,
          reason: `Matched ${matched}/${expected.length} expected citations.`,
        }
  return {
    status: Object.values(metrics).some((metric) => metric.status === 'failed') ? 'failed' : 'passed',
    metrics,
    citations,
    artifact: validation.artifact,
  }
}

function evaluateRetrievalMetrics(
  hits: readonly RetrieverHit[],
  expected: readonly ExpectedSource[] | undefined,
  kValues: readonly number[],
): RetrievalCaseMetrics {
  if (!expected || expected.length === 0) {
    const na: MetricResult = { status: 'not_applicable', reason: 'No expected sources configured.' }
    return { status: 'not_applicable', hitRateAtK: {}, recallAtK: {}, precisionAtK: {}, mrr: na, ndcg: na }
  }
  const hitRateAtK: Record<number, MetricResult> = {}
  const recallAtK: Record<number, MetricResult> = {}
  const precisionAtK: Record<number, MetricResult> = {}
  for (const k of kValues) {
    const top = hits.slice(0, k)
    const matchedExpected = countMatchedExpected(top, expected)
    const relevantRetrieved = countRelevantHits(top, expected)
    hitRateAtK[k] =
      matchedExpected > 0
        ? { status: 'passed', score: 1 }
        : { status: 'failed', score: 0, reason: `No expected source found in top ${k}.` }
    recallAtK[k] =
      matchedExpected === expected.length
        ? { status: 'passed', score: 1 }
        : {
            status: 'failed',
            score: matchedExpected / expected.length,
            reason: `Matched ${matchedExpected}/${expected.length} expected sources in top ${k}.`,
          }
    precisionAtK[k] = {
      status: relevantRetrieved > 0 ? 'passed' : 'failed',
      score: top.length === 0 ? 0 : relevantRetrieved / top.length,
      ...(relevantRetrieved > 0 ? {} : { reason: `No relevant hits in top ${k}.` }),
    } as MetricResult
  }
  const firstRelevantIndex = hits.findIndex((item) => expected.some((source) => matchesExpectedSource(item, source)))
  const mrrScore = firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0
  const dcg = hits.reduce((sum, item, index) => {
    const rel = expected.some((source) => matchesExpectedSource(item, source)) ? 1 : 0
    return sum + rel / Math.log2(index + 2)
  }, 0)
  const idealCount = Math.min(expected.length, hits.length)
  const idcg = Array.from({ length: idealCount }).reduce<number>((sum, _item, index) => sum + 1 / Math.log2(index + 2), 0)
  const ndcgScore = idcg > 0 ? dcg / idcg : 0
  return {
    status: Object.values(recallAtK).some((metric) => metric.status === 'passed') ? 'passed' : 'failed',
    hitRateAtK,
    recallAtK,
    precisionAtK,
    mrr: mrrScore > 0 ? { status: 'passed', score: mrrScore } : { status: 'failed', score: 0, reason: 'No relevant hit found.' },
    ndcg: ndcgScore > 0 ? { status: 'passed', score: ndcgScore } : { status: 'failed', score: 0, reason: 'No relevant hit found.' },
  }
}

function countMatchedExpected(hits: readonly RetrieverHit[], expected: readonly ExpectedSource[]): number {
  return expected.filter((source) => hits.some((item) => matchesExpectedSource(item, source))).length
}

function countRelevantHits(hits: readonly RetrieverHit[], expected: readonly ExpectedSource[]): number {
  return hits.filter((item) => expected.some((source) => matchesExpectedSource(item, source))).length
}

function matchesExpectedSource(hitItem: Pick<RetrieverHit, 'namespace' | 'sourceId' | 'chunkId' | 'metadata'>, expected: ExpectedSource): boolean {
  if (expected.type === 'metadata') {
    return Object.entries(expected.where).every(([key, value]) => jsonEqual(readPath(hitItem.metadata, key), value))
  }
  if (expected.namespace !== undefined && hitItem.namespace !== expected.namespace) return false
  if (hitItem.sourceId !== expected.sourceId) return false
  return expected.chunkId === undefined || hitItem.chunkId === expected.chunkId
}

function classifyRetrievalFailures(metrics: RetrievalCaseMetrics): RagFailureType[] {
  if (metrics.status === 'not_applicable') return []
  const topMetric = metrics.recallAtK[Math.max(...Object.keys(metrics.recallAtK).map(Number))]
  if (topMetric?.status === 'failed' && topMetric.score === 0) return ['retrieval_miss']
  if (Object.values(metrics.precisionAtK).some((metric) => metric.status === 'failed')) return ['low_precision']
  return []
}

function createEvidencePreview(hits: readonly RetrieverHit[]): RagEvidencePreview[] {
  return hits.slice(0, 5).map((item, index) => ({
    namespace: item.namespace,
    sourceId: item.sourceId,
    chunkId: item.chunkId,
    score: item.score,
    rank: index + 1,
    contentPreview: item.content.slice(0, 240),
    ...(item.parent?.content ? { parentContentPreview: item.parent.content.slice(0, 240) } : {}),
    ...(isPreviewProvenance(item.provenance) ? { provenance: item.provenance } : {}),
    ...(isRetrievalMetadata(item.metadata) ? { matchedQueries: item.metadata._cruxRetrieval.matchedQueries } : {}),
  }))
}

async function retrieveWithOptionalTrace(
  retrieverItem: Retriever,
  query: string,
  options: { limit?: number } = {},
): Promise<{ hits: RetrieverHit[]; trace: RagTracePreview }> {
  if ('retrieveWithTrace' in retrieverItem && typeof retrieverItem.retrieveWithTrace === 'function') {
    const result = await retrieverItem.retrieveWithTrace(query, options)
    return { hits: result.hits, trace: { available: true, trace: result.trace } }
  }
  const hits = await retrieverItem.retrieve(query, options)
  return { hits, trace: { available: false, reason: 'Retriever does not expose retrieveWithTrace().' } }
}

async function traceForGrounding(retrieverItem: Retriever, query: string): Promise<RagTracePreview> {
  if (!('retrieveWithTrace' in retrieverItem) || typeof retrieverItem.retrieveWithTrace !== 'function') {
    return { available: false, reason: 'Retriever does not expose retrieveWithTrace().' }
  }
  const result = await retrieverItem.retrieveWithTrace(query)
  return { available: true, trace: result.trace }
}

function createRagReport<TInput extends Record<string, unknown>>(args: {
  id: string
  dataset: RagDataset<TInput>
  startedAt: Date
  cases: readonly RagEvalCaseResult<TInput>[]
  comparisons?: readonly RagEvalComparison[]
}): RagEvalReport<TInput> {
  const endedAt = new Date()
  const summary = summarizeRagCases(args.cases)
  return Object.freeze({
    _tag: 'RagEvalReport' as const,
    id: args.id,
    datasetId: args.dataset.id,
    startedAt: args.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    summary,
    cases: Object.freeze([...args.cases]),
    ...(args.comparisons ? { comparisons: Object.freeze([...args.comparisons]) } : {}),
    exportFailedCases(options: FailedCaseExportOptions = {}): RagDatasetJson<TInput> {
      const failedIds = new Set(args.cases.filter((item) => !item.passed).map((item) => item.caseId))
      return {
        id: `${args.dataset.id}-failures`,
        ...(args.dataset.description ? { description: args.dataset.description } : {}),
        cases: args.dataset.cases
          .filter((testCase) => failedIds.has(testCase.id))
          .map((testCase) => ({
            id: testCase.id,
            ...(testCase.name ? { name: testCase.name } : {}),
            input: testCase.input,
            ...(testCase.expected ? { expected: testCase.expected } : {}),
            tags: [...new Set([...(testCase.tags ?? []), ...(options.tag ? [options.tag] : [])])],
            ...(testCase.metadata ? { metadata: testCase.metadata } : {}),
            ...(options.includeActual
              ? {
                  // `actual` carries `RagCaseStatus`, `readonly RagFailureType[]`, and
                  // `readonly RagEvidencePreview[]` — these are JSON-serializable at runtime
                  // but their concrete TS shapes don't structurally satisfy `JsonValue`,
                  // so cast at the boundary.
                  metadata: {
                    ...(testCase.metadata ?? {}),
                    actual: args.cases
                      .filter((item) => item.caseId === testCase.id && !item.passed)
                      .map((item) => ({
                        status: item.status,
                        failureTypes: item.failureTypes,
                        evidence: item.evidence,
                      })) as unknown as JsonValue,
                  },
                }
              : {}),
          })),
      }
    },
  })
}

function summarizeRagCases(cases: readonly RagEvalCaseResult[]): RagEvalSummary {
  const passed = cases.filter((item) => item.passed).length
  const failed = cases.length - passed
  const byFailureType = emptyFailureCounts()
  for (const item of cases) {
    if (item.primaryFailureType) byFailureType[item.primaryFailureType]++
  }
  const failureGroups = FAILURE_PRECEDENCE.map((type) => ({
    type,
    count: cases.filter((item) => item.primaryFailureType === type).length,
    caseIds: cases.filter((item) => item.primaryFailureType === type).map((item) => item.caseId),
  })).filter((group) => group.count > 0)
  return {
    total: cases.length,
    passed,
    failed,
    passRate: cases.length === 0 ? 0 : passed / cases.length,
    byFailureType,
    failureGroups,
    retrieval: summarizeRetrieval(cases),
    citations: summarizeCitations(cases),
    answer: summarizeAnswer(cases),
  }
}

function summarizeRetrieval(cases: readonly RagEvalCaseResult[]): RagRetrievalSummary | undefined {
  const applicable = cases.filter((item) => item.retrieval.metrics.status !== 'not_applicable')
  if (applicable.length === 0) return undefined
  return {
    hitRateAtK: averageK(applicable, (item) => item.retrieval.metrics.hitRateAtK),
    recallAtK: averageK(applicable, (item) => item.retrieval.metrics.recallAtK),
    precisionAtK: averageK(applicable, (item) => item.retrieval.metrics.precisionAtK),
    mrr: averageMetric(applicable.map((item) => item.retrieval.metrics.mrr)),
    ndcg: averageMetric(applicable.map((item) => item.retrieval.metrics.ndcg)),
  }
}

function summarizeCitations(cases: readonly RagEvalCaseResult[]): { validityRate: number } | undefined {
  const applicable = cases.filter((item) => item.citations.status !== 'not_applicable')
  if (applicable.length === 0) return undefined
  return { validityRate: applicable.filter((item) => item.citations.status === 'passed').length / applicable.length }
}

function summarizeAnswer(cases: readonly RagEvalCaseResult[]): { passRate: number } | undefined {
  const applicable = cases.filter((item) => item.answer.status !== 'not_applicable')
  if (applicable.length === 0) return undefined
  return { passRate: applicable.filter((item) => item.answer.status === 'passed').length / applicable.length }
}

function compareRagCases<TInput extends Record<string, unknown>>(
  baselineLabel: string,
  candidateLabel: string,
  baseline: readonly RagEvalCaseResult<TInput>[],
  candidate: readonly RagEvalCaseResult<TInput>[],
): RagEvalComparison {
  const baselineByCase = new Map(baseline.map((item) => [item.caseId, item]))
  const candidateByCase = new Map(candidate.map((item) => [item.caseId, item]))
  return {
    baselineLabel,
    candidateLabel,
    metricDeltas: {
      passRate: passRate(candidate) - passRate(baseline),
      failed: candidate.filter((item) => !item.passed).length - baseline.filter((item) => !item.passed).length,
      avgDurationMs: averageDuration(candidate) - averageDuration(baseline),
    },
    caseDeltas: [...baselineByCase.keys()].flatMap((caseId) => {
      const base = baselineByCase.get(caseId)
      const cand = candidateByCase.get(caseId)
      if (!base || !cand) return []
      return [
        {
          caseId,
          baseline: { status: base.status, failureTypes: base.failureTypes },
          candidate: { status: cand.status, failureTypes: cand.failureTypes },
        },
      ]
    }),
  }
}

function errorCase<TInput extends Record<string, unknown>>(
  testCase: RagEvalCase<TInput>,
  durationMs: number,
  error: unknown,
  type: RagFailureType = 'error',
  options?: Pick<GroundedAnswerEvalOptions<TInput>, 'configRole' | 'configLabel'>,
): RagEvalCaseResult<TInput> {
  const failureTypes = [type]
  return {
    caseId: testCase.id,
    caseName: testCase.name ?? testCase.id,
    configRole: options?.configRole,
    configLabel: options?.configLabel,
    input: testCase.input,
    status: type === 'timeout' ? 'failed' : 'error',
    passed: false,
    durationMs,
    error: extractErrorMessage(error),
    failureTypes,
    primaryFailureType: type,
    evidence: [],
    retrieval: {
      metrics: {
        status: 'not_applicable',
        hitRateAtK: {},
        recallAtK: {},
        precisionAtK: {},
        mrr: { status: 'not_applicable', reason: 'Case errored before retrieval metrics.' },
        ndcg: { status: 'not_applicable', reason: 'Case errored before retrieval metrics.' },
      },
      hitCount: 0,
    },
    answer: { status: 'not_applicable', metrics: {} },
    citations: { status: 'not_applicable', metrics: {}, citations: [] },
    trace: { available: false, reason: 'Case errored before trace capture.' },
  }
}

function eraseRagCaseInput<TInput extends Record<string, unknown>>(
  result: RagEvalCaseResult<TInput>,
): RagEvalCaseResult<Record<string, unknown>> {
  return result as unknown as RagEvalCaseResult<Record<string, unknown>>
}

function primaryFailure(types: readonly RagFailureType[]): RagFailureType | undefined {
  return FAILURE_PRECEDENCE.find((type) => types.includes(type))
}

function dedupeFailureTypes(types: readonly RagFailureType[]): RagFailureType[] {
  return [...new Set(types)]
}

function emptyFailureCounts(): Record<RagFailureType, number> {
  return {
    retrieval_miss: 0,
    low_precision: 0,
    invalid_citation: 0,
    unsupported_answer: 0,
    judge_failed: 0,
    timeout: 0,
    error: 0,
  }
}

function averageK(
  cases: readonly RagEvalCaseResult[],
  select: (item: RagEvalCaseResult) => Record<number, MetricResult>,
): Record<number, number> {
  const values = new Map<number, number[]>()
  for (const item of cases) {
    for (const [key, metric] of Object.entries(select(item))) {
      if (metric.status === 'not_applicable') continue
      const k = Number(key)
      values.set(k, [...(values.get(k) ?? []), metric.score])
    }
  }
  return Object.fromEntries([...values.entries()].map(([k, scores]) => [k, scores.reduce((sum, score) => sum + score, 0) / scores.length]))
}

function averageMetric(metrics: readonly MetricResult[]): number {
  const applicable = metrics.filter((metric) => metric.status !== 'not_applicable')
  if (applicable.length === 0) return 0
  return applicable.reduce((sum, metric) => sum + metric.score, 0) / applicable.length
}

function passRate(cases: readonly RagEvalCaseResult[]): number {
  return cases.length === 0 ? 0 : cases.filter((item) => item.passed).length / cases.length
}

function averageDuration(cases: readonly RagEvalCaseResult[]): number {
  return cases.length === 0 ? 0 : cases.reduce((sum, item) => sum + item.durationMs, 0) / cases.length
}

function readQuestion(input: Record<string, unknown>): string {
  const question = input.question
  if (typeof question === 'string' && question.trim()) return question
  const query = input.query
  if (typeof query === 'string' && query.trim()) return query
  throw new Error('RAG eval cases require a string `question` or `query` input field for retrieval-only evaluation.')
}

function extractAnswerText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const answer = (output as { answer?: unknown }).answer
    if (typeof answer === 'string') return answer
  }
  return JSON.stringify(output)
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function assertPortableExpected(expected: RagExpected | undefined): void {
  if (!expected) return
  for (const source of [...(expected.sources ?? []), ...(expected.citations ?? [])]) {
    if (source.type === 'metadata') assertJsonRecord(source.where, 'expected metadata matcher')
  }
}

function assertJsonRecord(value: Record<string, JsonValue> | undefined, label: string): void {
  if (value === undefined) return
  if (!isJsonValue(value)) throw new Error(`ragDataset(): ${label} must be serializable JSON.`)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isJsonValue)
  return false
}

function jsonEqual(left: unknown, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPreviewProvenance(value: unknown): value is RagEvidencePreview['provenance'] {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    (record.page === undefined || typeof record.page === 'number') &&
    (record.table === undefined || typeof record.table === 'string') &&
    (record.span === undefined || typeof record.span === 'string')
  )
}

function isRetrievalMetadata(value: Record<string, unknown>): value is { _cruxRetrieval: { matchedQueries: readonly string[] } } {
  const retrieval = value._cruxRetrieval
  if (!retrieval || typeof retrieval !== 'object') return false
  const matchedQueries = (retrieval as { matchedQueries?: unknown }).matchedQueries
  return Array.isArray(matchedQueries) && matchedQueries.every((item) => typeof item === 'string')
}

// ─────────────────────────────────────────────────────────────────
// CLI Eval Runner Types & Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Standard eval definition exported by each eval file.
 *
 * Each `*.eval.ts` file exports one or more of these — the CLI runner
 * auto-discovers them via duck-typing with `isEvalDef()`.
 *
 * Prefer `evaluation()` over constructing this manually — it infers
 * input and result types from the prompt.
 */
/** A scorer function that grades an eval result. Returns a score (typically 0-5). */
export interface EvalScorer {
  /** Unique identifier for this scorer. */
  id: string
  /** Score the result. Receives the input and output text. */
  score(
    input: { input: string; output: string },
    opts: { generate: GenerateFn; model: unknown },
  ): Promise<{ score: number; reasoning?: string }>
}

/** Regression detection thresholds. */
export interface RegressionConfig {
  /** Minimum acceptable pass rate (0-1). Eval fails if rate drops below this. */
  minPassRate?: number
  /** Maximum acceptable score drop vs baseline. Eval fails if any scorer drops more. */
  maxScoreDrop?: number
}

export interface EvalDef<TInput = Record<string, unknown>, TResult = EvalResult> {
  /** The prompt to evaluate. */
  prompt: AnyPrompt
  /** Test cases for this eval. */
  cases: EvalCase<TInput, TResult>[]
  /** Which model set to run against. Maps to model sets in `EvalRunnerConfig`. */
  mode: 'structured' | 'text'
  /** Scorers to run alongside assertions. Each scores every case and results appear in the report. */
  scores?: EvalScorer[]
  /** Regression detection thresholds. CLI exits non-zero if thresholds are breached. */
  regression?: RegressionConfig
  /** Auto-classify failures into categories (format, reasoning, hallucination, etc.). */
  classifyFailures?: boolean
}

/**
 * Define a typesafe eval — input and result types are inferred from the prompt.
 *
 * @example
 * ```ts
 * import { evaluation } from '@crux/core/testing'
 *
 * export const draftEditEval = evaluation({
 *   prompt: draftEdit,
 *   mode: 'structured',
 *   cases: [
 *     {
 *       name: 'empty-document-append',
 *       input: { instruction: 'Write intro', draftTitle: 'Guide' },
 *       assert: (r) => {
 *         // r.object is fully typed from the prompt's output schema
 *         return r.object.edits.length > 0
 *       },
 *     },
 *   ],
 * })
 * ```
 *
 * @param config - Eval definition with prompt, mode, and test cases. Types are inferred from the prompt.
 * @returns An `EvalDef` that the CLI runner can auto-discover and execute.
 */
export function evaluation<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly Context<z.ZodType>[],
>(config: {
  prompt: Prompt<TOwnInput, TOutput, TContexts>
  mode: 'structured' | 'text'
  cases: EvalCase<MergedInput<TOwnInput, TContexts>, EvalResult<TOutput>>[]
  /** Scorers to run alongside assertions. Each scores every case. */
  scores?: EvalScorer[]
  /** Regression detection thresholds. */
  regression?: RegressionConfig
  /** Auto-classify failures into categories. */
  classifyFailures?: boolean
}): EvalDef<MergedInput<TOwnInput, TContexts>, EvalResult<TOutput>> {
  return config
}

/**
 * Duck-type check: is `value` an `EvalDef`?
 *
 * Used by the CLI runner to auto-discover eval definitions from barrel exports.
 */
export function isEvalDef(value: unknown): value is EvalDef {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const prompt = v.prompt as { _tag?: unknown } | null | undefined
  return (
    prompt != null &&
    typeof prompt === 'object' &&
    prompt._tag === 'Prompt' &&
    Array.isArray(v.cases) &&
    (v.mode === 'structured' || v.mode === 'text')
  )
}

/**
 * Configuration for the CLI eval runner.
 *
 * Provided by the user's `prompt.eval.config.ts` file.
 */
export interface EvalRunnerConfig {
  /** The adapter generate function (e.g. `generate` from `@crux/ai`). */
  generate: GenerateFn
  /** Model sets keyed by mode. Each eval's `mode` maps to one of these arrays. */
  models: {
    structured: AnyModel[]
    text: AnyModel[]
  }
  /** Dynamic import of the evals barrel. Returns module with EvalDef exports. */
  evals: () => Promise<Record<string, unknown>>
  /** Dynamic import of flow evals barrel. Returns module with FlowEvalDef exports. */
  flowEvals?: () => Promise<Record<string, unknown>>
  /** Dynamic import of RAG evals barrel. Returns module with RagEvalDef exports. */
  ragEvals?: () => Promise<Record<string, unknown>>
  /** Optional devtools configuration. */
  devtools?: {
    serverUrl?: string
  }
  /** Maximum concurrent API calls. Defaults to `5`. */
  concurrency?: number
  /** Per-case timeout in milliseconds. Defaults to `60_000`. */
  timeout?: number
}

// ─────────────────────────────────────────────────────────────────
// Flow Eval Types
// ─────────────────────────────────────────────────────────────────

/**
 * Tool definition for flow evals — name, description, and parameter schema.
 *
 * These are plain data (no runtime implementation) used to tell the model
 * what tools are available. Implementations come from `toolMocks`.
 */
export interface FlowToolDef {
  /** Tool name as the model will see it. */
  name: string
  /** Description shown to the model. */
  description: string
  /** Zod schema for the tool's parameters. */
  parameters: z.ZodType
}

/**
 * Tool mock map: tool name → static response or dynamic function.
 *
 * Static values are returned directly. Functions receive the tool args
 * and can return different responses based on them.
 */
export type ToolMocks = Record<string, unknown | ((args: Record<string, unknown>) => unknown | Promise<unknown>)>

/** A single step in a flow eval pipeline. */
export interface FlowStepDef {
  /** Unique identifier for this step (used in configs and assertions). */
  id: string
  /** The prompt to run for this step. */
  prompt: AnyPrompt
  /**
   * Transform previous step outputs into this step's input.
   * First step receives `case.input` if this is not provided.
   */
  input?: (ctx: FlowStepContext) => Record<string, unknown>
  /**
   * Skip this step conditionally. When `true`, the step is marked
   * as skipped and subsequent steps can check `step.skipped`.
   */
  skip?: (ctx: FlowStepContext) => boolean

  // ── Tool-calling mode (optional) ───────────────────────────────

  /** Tool definitions available to the model during this step. */
  tools?: FlowToolDef[]
  /** Mock implementations for tools. Keys must match tool names. */
  toolMocks?: ToolMocks
  /** Maximum tool-calling loop iterations. Defaults to `15`. */
  maxToolSteps?: number
  /**
   * Assert on tool calls made during this step. Runs after the step completes.
   * Receives the array of tool calls. Throw or return `false` to fail.
   */
  assertToolCalls?: (calls: FlowToolCall[]) => boolean | void | Promise<boolean | void>
}

/** A named model configuration mapping step IDs to models. */
export interface FlowModelConfig {
  /** Descriptive name for this configuration (e.g., `'default'`, `'premium'`). */
  name: string
  /** Map of step ID → model to use. Every step must have an entry. */
  models: Record<string, AnyModel>
}

/** A single user message in a multiturn conversation flow. */
export interface FlowTurn {
  /** The user message to send. */
  userMessage: string
  /**
   * Optional intermediate assertion after this turn completes.
   * Receives the flow trace accumulated so far. Throw or return `false` to fail.
   */
  assert?: (trace: FlowTrace) => boolean | Promise<boolean>
}

/** A single flow eval test case. */
export interface FlowEvalCase {
  /** Descriptive name for this test case. */
  name: string
  /** Input for single-turn flows (prompt chains or single-message tool loops). */
  input?: Record<string, unknown>
  /** User messages for multiturn tool-calling flows. Mutually exclusive with `input`. */
  turns?: FlowTurn[]
  /** Additional context messages to prepend (e.g., prior conversation history). */
  contextMessages?: Array<{ role: 'system' | 'user'; content: string }>
  /**
   * Final assertion on the complete flow trace.
   * Throw or return `false` to fail the case.
   */
  assert: (trace: FlowTrace) => boolean | Promise<boolean>
}

/** Flow eval definition — the flow equivalent of `EvalDef`. */
export interface FlowEvalDef {
  /** Descriptive name for this flow eval. */
  name: string
  /** Human-readable description. */
  description?: string
  /** Steps in the pipeline, executed in order. */
  steps: FlowStepDef[]
  /** Named model configurations. Matrix is `cases × configs`. */
  configs: FlowModelConfig[]
  /** Test cases to run against each config. */
  cases: FlowEvalCase[]
  /** Maximum concurrent (case, config) executions. Defaults to `3`. */
  concurrency?: number
  /** Per-case timeout in milliseconds. */
  timeout?: number
}

/** Result of a single tool call within a flow step. */
export interface FlowToolCall {
  /** Tool name. */
  name: string
  /** Arguments passed by the model. */
  args: Record<string, unknown>
  /** Result returned by the mock. */
  result: unknown
}

/** Result of a single conversation turn in a multiturn flow. */
export interface FlowTurnResult {
  /** The user message that initiated this turn. */
  userMessage: string
  /** The model's text response. */
  response: string
  /** Tool calls made during this turn. */
  toolCalls: FlowToolCall[]
  /** Number of tool-calling loop iterations in this turn. */
  toolStepCount: number
  /** Token usage for this turn. */
  usage?: EvalTokenUsage
  /** Cost in USD for this turn. */
  cost?: number
  /** Duration of this turn in ms. */
  durationMs: number
}

/** Result of a single flow step execution. */
export interface FlowStepResult {
  /** Step ID. */
  id: string
  /** Output from the generation (structured: `.object`, text: `.text`). */
  output: unknown
  /** Text output from the generation. */
  text?: string
  /** Whether this step was skipped via the `skip` predicate. */
  skipped: boolean
  /** Duration of this step in ms. */
  durationMs: number
  /** Token usage for this step. */
  usage?: EvalTokenUsage
  /** Cost in USD for this step. */
  cost?: number
  /** Input passed to this step (for debugging/reporting). */
  input?: Record<string, unknown>

  // ── Tool-calling mode only ─────────────────────────────────────

  /** All tool calls made during this step (flattened across turns). */
  toolCalls?: FlowToolCall[]
  /** Number of tool-calling loop iterations (single-turn). */
  toolStepCount?: number

  // ── Multiturn mode only ────────────────────────────────────────

  /** Per-turn results for multiturn steps. */
  turns?: FlowTurnResult[]
  /** Number of conversation turns. */
  turnCount?: number
  /** Total tool-calling loop iterations across all turns. */
  totalToolStepCount?: number
}

/** Context available to step `input` and `skip` functions. */
export interface FlowStepContext {
  /** The current test case. */
  case: FlowEvalCase
  /** Access a completed step's result by ID. Throws if the step hasn't run yet. */
  step(id: string): FlowStepResult
}

/**
 * Complete trace of a flow eval execution — passed to assertion functions.
 *
 * Provides `.step(id)` for convenient access to individual step results.
 */
export interface FlowTrace {
  /** The model config name used for this execution. */
  configName: string
  /** All step results, keyed by step ID. */
  stepResults: Record<string, FlowStepResult>
  /** Access a step result by ID. Throws if the step doesn't exist. */
  step(id: string): FlowStepResult
  /** Total wall-clock duration of the flow in ms. */
  durationMs: number
  /** Aggregated token usage across all steps. */
  totalUsage: EvalTokenUsage
  /** Aggregated cost across all steps. */
  totalCost: number
  /** Error message if the flow failed before completing. */
  error?: string
}

/** Result of a single (case, config) flow eval execution. */
export interface FlowEvalCaseResult {
  /** Test case name. */
  caseName: string
  /** Model config name. */
  configName: string
  /** Whether the assertion(s) passed. */
  passed: boolean
  /** Duration in ms. */
  durationMs: number
  /** Error message if the case failed. */
  error?: string
  /** The flow trace (for reporting and debugging). */
  trace: FlowTrace
}

/** Complete flow eval report. */
export interface FlowEvalReport {
  /** The flow eval name. */
  name: string
  /** Individual results for every (case, config) combination. */
  results: FlowEvalCaseResult[]
  /** Aggregated statistics. */
  summary: {
    total: number
    passed: number
    failed: number
    /** Breakdown by model config name. */
    byConfig: Record<string, { total: number; passed: number; failed: number }>
    totalSteps: number
    avgSteps: number
    totalTokens: number
    totalCost: number
  }
}

/**
 * Define a flow eval for testing agent flows and prompt chains.
 *
 * Flow evals support both prompt chains (sequential steps with different models)
 * and tool-calling loops (single step with tools), as well as multiturn
 * conversations.
 *
 * @example
 * ```ts
 * import { flowEvaluation, expect } from '@crux/core/testing'
 *
 * // Prompt chain
 * export const researchPipeline = flowEvaluation({
 *   name: 'research-pipeline',
 *   steps: [
 *     { id: 'plan', prompt: researchPlanner },
 *     { id: 'validate', prompt: researchValidator, input: (ctx) => ({
 *       query: ctx.case.input.query,
 *       resultsSummary: summarize(ctx.step('plan').output),
 *     }) },
 *   ],
 *   configs: [
 *     { name: 'default', models: { plan: geminiFlash, validate: geminiFlash } },
 *     { name: 'premium', models: { plan: gpt4o, validate: claudeSonnet } },
 *   ],
 *   cases: [
 *     {
 *       name: 'multi-source',
 *       input: { query: 'cloud migration' },
 *       assert: (trace) => {
 *         expect(trace.step('plan').output.searches.length).toBeGreaterThan(0)
 *         expect(trace.step('validate').output.sufficient).toBe(true)
 *         return true
 *       },
 *     },
 *   ],
 * })
 *
 * // Tool-calling loop with multiturn
 * export const agentConversation = flowEvaluation({
 *   name: 'agent-conversation',
 *   steps: [{
 *     id: 'agent', prompt: karylaAgent,
 *     tools: agentToolSchemas,
 *     toolMocks: { research: { synthesis: '...' } },
 *     maxToolSteps: 15,
 *   }],
 *   configs: [{ name: 'kimi', models: { agent: kimiK2 } }],
 *   cases: [{
 *     name: 'research-then-write',
 *     turns: [
 *       { userMessage: 'Research landing pages', assert: (t) => {
 *         expect(t.step('agent').turns![0].toolCalls.some(tc => tc.name === 'research')).toBe(true)
 *         return true
 *       }},
 *       { userMessage: 'Now write an intro' },
 *     ],
 *     assert: (trace) => {
 *       expect(trace.step('agent').turnCount).toBe(2)
 *       return true
 *     },
 *   }],
 * })
 * ```
 */
export function flowEvaluation(config: FlowEvalDef): FlowEvalDef {
  return config
}

/**
 * Duck-type check: is `value` a `FlowEvalDef`?
 *
 * Used by the CLI runner to auto-discover flow eval definitions from barrel exports.
 */
export function isFlowEvalDef(value: unknown): value is FlowEvalDef {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    Array.isArray(v.steps) &&
    v.steps.length > 0 &&
    Array.isArray(v.configs) &&
    v.configs.length > 0 &&
    Array.isArray(v.cases) &&
    v.cases.length > 0
  )
}

// ─────────────────────────────────────────────────────────────────
// Flow Eval Reporter (global hook for devtools integration)
// ─────────────────────────────────────────────────────────────────

/** Per-step summary sent through the wire protocol for devtools visualization. */
export interface FlowStepSummary {
  id: string
  modelId: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  skipped: boolean
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>
  input?: unknown
  output?: unknown
  text?: string
  turns?: Array<{
    userMessage: string
    response: string
    toolCalls: Array<{ name: string; args: unknown; result: unknown }>
    durationMs: number
    inputTokens: number
    outputTokens: number
  }>
}

/**
 * Callback interface for flow eval progress reporting.
 *
 * When set via `updateRuntime({ flowEvalReporter })`, `evaluateFlow()` automatically
 * calls these hooks — no user code changes needed.
 */
export interface FlowEvalReporter {
  onStart(info: {
    flowId: string
    name: string
    description: string | undefined
    stepIds: string[]
    configNames: string[]
    caseNames: string[]
    totalCases: number
  }): void
  onCase(result: {
    flowId: string
    caseName: string
    configName: string
    passed: boolean
    durationMs: number
    error?: string
    completedCount: number
    traceSummary: {
      stepCount: number
      toolCallNames: string[]
      totalTokens: number
      totalCost: number
      steps: FlowStepSummary[]
    }
  }): void
  onEnd(info: { flowId: string; durationMs: number; summary: FlowEvalReport['summary'] }): void
}

// ─────────────────────────────────────────────────────────────────
// Judge Assertion Bridge
// ─────────────────────────────────────────────────────────────────

import type { JudgeInstance } from './scoring/types'
import type { GenerateObjectFn } from './compaction/types'
import type { Message } from './messages'
import { llmJudge } from './scoring/judge'
import { prompt as cruxPrompt } from './define'

/**
 * Wrap a `JudgeInstance` into an `EvalCase.assert`-compatible function.
 *
 * Returns an async assertion function that scores the eval result against
 * the judge's criteria and returns `true` if the score meets `minScore`.
 *
 * @param judge - The judge instance to use for scoring.
 * @param options - Options including minimum passing score and optional generate/model overrides.
 * @returns An assertion function for use in `EvalCase.assert`.
 *
 * @example
 * ```ts
 * import { judgeAssertion, evaluatePrompt } from '@crux/core/testing'
 * import { metrics } from '@crux/core/scoring'
 *
 * const relevance = metrics.relevance({ generate, model })
 *
 * const report = await evaluatePrompt({
 *   prompt: myPrompt,
 *   generate,
 *   models: [model],
 *   cases: [{
 *     name: 'relevance-check',
 *     input: { query: 'What is X?' },
 *     assert: judgeAssertion(relevance, { minScore: 4 }),
 *   }],
 * })
 * ```
 */
export function judgeAssertion(
  judge: JudgeInstance,
  options: { minScore: number; generate?: GenerateObjectFn; model?: unknown },
): (result: EvalResult) => Promise<boolean> {
  return async (result: EvalResult) => {
    const input = typeof result.text === 'string' ? result.text : JSON.stringify(result)
    const judgment = await judge.score(
      { input: '', output: input },
      { generate: options.generate, model: options.model },
    )
    return judgment.score >= options.minScore
  }
}

// ─────────────────────────────────────────────────────────────────
// Context Quality Evaluation
// ─────────────────────────────────────────────────────────────────

/** Result of a single context evaluation case. */
export interface ContextEvalCaseResult {
  /** Test case name. */
  caseName: string
  /** Score with the tested contexts included. */
  withScore: number
  /** Score without the tested contexts. */
  withoutScore: number
  /** Whether the contexts improved the score (withScore > withoutScore). */
  improved: boolean
  /** Score difference (withScore - withoutScore). */
  delta: number
}

/** Complete context evaluation report. */
export interface ContextEvalReport {
  results: ContextEvalCaseResult[]
  summary: {
    total: number
    improved: number
    degraded: number
    neutral: number
  }
}

/**
 * A single context evaluation case.
 *
 * Generic over the prompt's input shape so the case `input` autocompletes
 * from the prompt schema.
 */
export interface ContextEvalCase<TInput = Record<string, unknown>> {
  /** Descriptive name for this case. */
  name: string
  /** Input to pass to the prompt. */
  input: TInput
  /** Contexts to test — these will be removed in the "without" run. */
  contexts: Context<z.ZodType>[]
}

/**
 * Evaluate whether specific contexts improve prompt output quality.
 *
 * Runs the same prompt with and without the specified contexts, then compares
 * quality scores using an LLM judge.
 *
 * @param options - Evaluation configuration.
 * @returns A report showing whether each context set improved output quality.
 *
 * @example
 * ```ts
 * const report = await evaluateContext({
 *   prompt: writerPrompt,
 *   generate,
 *   model: testModel,
 *   judge: relevanceJudge,
 *   cases: [{
 *     name: 'brand-context-helps',
 *     input: { topic: 'AI safety' },
 *     contexts: [brandContext],
 *   }],
 * })
 * ```
 */
export async function evaluateContext<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
>(options: {
  prompt: Prompt<TOwnInput, TOutput, TContexts>
  generate: GenerateFn
  model: unknown
  judge: JudgeInstance
  cases: ContextEvalCase<MergedInput<TOwnInput, TContexts>>[]
}): Promise<ContextEvalReport> {
  const { prompt, generate: gen, model, judge, cases } = options
  const results: ContextEvalCaseResult[] = []
  const reporter = getRuntime().evalReporter
  const evalId = generateEvalId()
  const evalStart = Date.now()

  const modelId = getModelId(model)

  reporter?.onStart({
    evalId,
    promptId: prompt.id,
    models: [modelId],
    caseNames: cases.map((c) => c.name),
    totalCases: cases.length,
  })

  let completedCount = 0

  for (const evalCase of cases) {
    const caseStart = Date.now()
    let passed = false
    let error: string | undefined

    type AdapterPrompt = Parameters<GenerateFn>[0]
    type AdapterResult = { text?: string; object?: unknown }
    try {
      // Run with all contexts (original prompt).
      // The downcast bridges `evaluateContext`'s wider `ContextEntry[]` constraint
      // (matches AnyPrompt) with adapter `generate`'s narrower `Context<z.ZodType>[]`
      // — at runtime both see the same resolved contexts.
      const withResult = (await gen(prompt as unknown as AdapterPrompt, {
        model,
        input: evalCase.input,
      })) as AdapterResult
      const withText = typeof withResult.text === 'string' ? withResult.text : JSON.stringify(withResult)

      // Create a modified prompt without the tested contexts.
      // `prompt.contexts` is the prompt's `TContexts` tuple — we widen to
      // `Context<z.ZodType>[]` for filtering, then re-narrow when building
      // the inner prompt (the runtime spec doesn't care about the tuple shape).
      const filteredContexts = (prompt.contexts as readonly unknown[]).filter(
        (c): c is Context<z.ZodType> =>
          typeof c === 'object' &&
          c !== null &&
          '_tag' in c &&
          (c as { _tag: unknown })._tag === 'Context' &&
          !evalCase.contexts.includes(c as Context<z.ZodType>),
      )
      const modifiedPrompt = cruxPrompt({
        ...prompt.config,
        use: filteredContexts as unknown as TContexts,
      })

      // Run without the tested contexts
      const withoutResult = (await gen(modifiedPrompt as unknown as AdapterPrompt, {
        model,
        input: evalCase.input,
      })) as AdapterResult
      const withoutText = typeof withoutResult.text === 'string' ? withoutResult.text : JSON.stringify(withoutResult)

      // Score both — pass evalId so judge events correlate
      const inputText = JSON.stringify(evalCase.input)
      const [withJudgment, withoutJudgment] = await Promise.all([
        judge.score({ input: inputText, output: withText }, { evalId }),
        judge.score({ input: inputText, output: withoutText }, { evalId }),
      ])

      const delta = withJudgment.score - withoutJudgment.score
      passed = delta > 0

      results.push({
        caseName: evalCase.name,
        withScore: withJudgment.score,
        withoutScore: withoutJudgment.score,
        improved: delta > 0,
        delta,
      })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      results.push({
        caseName: evalCase.name,
        withScore: 0,
        withoutScore: 0,
        improved: false,
        delta: 0,
      })
    }

    completedCount++
    reporter?.onCase({
      evalId,
      caseName: evalCase.name,
      modelId,
      passed,
      durationMs: Date.now() - caseStart,
      completedCount,
      error,
    })
  }

  const summary = {
    total: results.length,
    improved: results.filter((r) => r.delta > 0).length,
    degraded: results.filter((r) => r.delta < 0).length,
    neutral: results.filter((r) => r.delta === 0).length,
  }

  reporter?.onEnd({
    evalId,
    durationMs: Date.now() - evalStart,
    summary: {
      total: summary.total,
      passed: summary.improved,
      failed: summary.degraded + summary.neutral,
      byModel: {
        [modelId]: {
          total: summary.total,
          passed: summary.improved,
          failed: summary.degraded + summary.neutral,
        },
      },
    },
  })

  return { results, summary }
}

// ─────────────────────────────────────────────────────────────────
// Compaction Fidelity Evaluation
// ─────────────────────────────────────────────────────────────────

/** Result of compaction fidelity evaluation. */
export interface CompactionEvalReport {
  /** Overall fidelity score (1–5). */
  score: number
  /** Per-criterion scores. */
  criteria: Array<{ criterion: string; score: number; reasoning: string }>
  /** Overall assessment. */
  reasoning: string
}

/**
 * Evaluate whether compacted messages preserve essential information.
 *
 * Compares original and compacted message arrays using an LLM judge to verify
 * that key facts, decisions, and context are preserved after compaction.
 *
 * @param options - Evaluation configuration with original and compacted messages.
 * @returns A report with fidelity scores and per-criterion breakdowns.
 *
 * @example
 * ```ts
 * const report = await evaluateCompaction({
 *   original: fullMessages,
 *   compacted: compactedMessages,
 *   generate: generateObject,
 *   model: judgeModel,
 *   criteria: ['key facts preserved', 'decisions retained', 'no hallucinated info'],
 * })
 * ```
 */
export async function evaluateCompaction(options: {
  original: Message[]
  compacted: Message[]
  generate: GenerateObjectFn
  model: unknown
  criteria?: string[]
}): Promise<CompactionEvalReport> {
  const {
    original,
    compacted,
    generate: gen,
    model,
    criteria = ['key facts preserved', 'decisions retained', 'no hallucinated information added'],
  } = options

  const reporter = getRuntime().evalReporter
  const evalId = generateEvalId()
  const evalStart = Date.now()
  const modelId = getModelId(model)

  reporter?.onStart({
    evalId,
    promptId: 'compaction-fidelity',
    models: [modelId],
    caseNames: criteria,
    totalCases: criteria.length,
  })

  const formatMessages = (msgs: Message[]) => msgs.map((m, i) => `[${i + 1}] ${m.role}: ${m.content}`).join('\n\n')

  const judge = llmJudge({
    id: `compaction-fidelity:${evalId}`,
    criteria: [
      'Evaluate how well the compacted version preserves the essential information from the original conversation.',
      `Criteria to check: ${criteria.join(', ')}.`,
    ].join(' '),
    scale: { min: 1, max: 5 },
    rubric: {
      1: 'Critical information lost — major facts or decisions missing',
      2: 'Significant gaps — several important points omitted',
      3: 'Adequate — main points preserved but notable details lost',
      4: 'Good — nearly all important information retained',
      5: 'Excellent — all essential information preserved faithfully',
    },
    generate: gen,
    model,
  })

  // Score each criterion individually
  let completedCount = 0
  const criteriaResults = await Promise.all(
    criteria.map(async (criterion) => {
      const caseStart = Date.now()
      let error: string | undefined
      let score = 0
      let reasoning = ''

      try {
        const result = await judge.score(
          {
            input: formatMessages(original),
            output: formatMessages(compacted),
            reference: criterion,
          },
          { evalId },
        )
        score = result.score
        reasoning = result.reasoning
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }

      completedCount++
      reporter?.onCase({
        evalId,
        caseName: criterion,
        modelId,
        passed: score >= 3,
        durationMs: Date.now() - caseStart,
        completedCount,
        error,
      })

      return { criterion, score, reasoning }
    }),
  )

  const avgScore = criteriaResults.reduce((sum, r) => sum + r.score, 0) / criteriaResults.length
  const passed = criteriaResults.filter((r) => r.score >= 3).length
  const failed = criteriaResults.length - passed

  reporter?.onEnd({
    evalId,
    durationMs: Date.now() - evalStart,
    summary: {
      total: criteriaResults.length,
      passed,
      failed,
      byModel: { [modelId]: { total: criteriaResults.length, passed, failed } },
    },
  })

  return {
    score: Math.round(avgScore * 10) / 10,
    criteria: criteriaResults,
    reasoning: criteriaResults.map((r) => `${r.criterion}: ${r.reasoning}`).join('\n'),
  }
}
