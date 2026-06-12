/**
 * The bound, capability-typed assertion surface (`ctx.expect`) and the case
 * context delivered to `expect` callbacks.
 *
 * Two layers keep assertions honest:
 *
 * 1. **Compile time** — signal namespaces (`expect.toolCalls`, `expect.steps`,
 *    …) exist on the type only when the task's capability set captures that
 *    signal family. Asserting tool calls on a prompt task is a type error.
 * 2. **Run time** — asserting on a signal that was not captured in THIS
 *    execution throws an {@link UncapturedSignalError} naming the signal and
 *    the task kinds that capture it. Never a vacuous pass.
 *
 * Matcher implementations live in `./internal/expect-runtime.ts`; the engine
 * builds one bound expect per executed cell from its captured trace signals.
 *
 * @module
 */

import type { StandardSchemaV1 } from './standard-schema'
import type { Capability } from './target'
import type { RetrieverHit } from '../retrieval'
import type { TokenUsage } from '../types'

// ─────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────

/**
 * Thrown when an assertion targets a signal namespace whose signal was not
 * captured in the current execution — e.g. `expect.toolCalls` against a
 * variant task that never invoked a tool runtime. The message names the
 * signal and the task kinds that capture it; this is the runtime backstop
 * behind the compile-time capability gating.
 */
export class UncapturedSignalError extends Error {
  /** The signal namespace that was asserted on. */
  readonly signal: string
  /** Task kinds whose runtimes emit this signal. */
  readonly capturingKinds: readonly string[]

  constructor(signal: string, capturingKinds: readonly string[]) {
    super(
      `expect.${signal}: no ${signal} signal was captured in this execution. ` +
        `${signal} is captured by ${capturingKinds.join('/')} tasks — ` +
        `if this cell ran a variant task, make sure it emits ${signal}, or drop the assertion.`,
    )
    this.name = 'UncapturedSignalError'
    this.signal = signal
    this.capturingKinds = capturingKinds
  }
}

// ─────────────────────────────────────────────────────────────────
// Value matchers
// ─────────────────────────────────────────────────────────────────

/** Deep-partial helper for `toMatchObject`. */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

/**
 * Vitest-compatible matcher set on values. Hard matchers throw on failure
 * (assertion-function semantics — later lines may rely on them); the engine
 * records every assertion that ran, so reports show position
 * (`4/5 ran, 1 not evaluated`).
 *
 * @example
 * ```ts
 * expect: (ctx) => {
 *   ctx.expect(ctx.output.answer).toContain('refund')
 *   ctx.expect(ctx.output.confidence).toBeGreaterThanOrEqual(0.5)
 * }
 * ```
 */
export interface Matchers<V> {
  toBe(expected: V): void
  toEqual(expected: V): void
  toStrictEqual(expected: V): void
  /** String values: substring or regex match. */
  toMatch(pattern: RegExp | string): void
  toMatchObject(partial: DeepPartial<V>): void
  toContain(item: unknown): void
  toContainEqual(item: unknown): void
  toHaveLength(n: number): void
  toHaveProperty(path: string, value?: unknown): void
  toBeGreaterThan(n: number): void
  toBeGreaterThanOrEqual(n: number): void
  toBeLessThan(n: number): void
  toBeLessThanOrEqual(n: number): void
  toBeCloseTo(n: number, digits?: number): void
  toBeDefined(): void
  toBeUndefined(): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeOneOf(values: readonly V[]): void
  toBeInstanceOf(cls: abstract new (...a: never[]) => unknown): void
  toBeTypeOf(t: 'string' | 'number' | 'boolean' | 'object' | 'function' | 'undefined' | 'bigint' | 'symbol'): void
  /** Escape hatch: assert an arbitrary predicate with an optional message. */
  toSatisfy(pred: (v: V) => boolean, message?: string): void
  /** Negated matchers. */
  not: Matchers<V>
}

/**
 * The callable half of `ctx.expect`: value matchers in throwing (hard) and
 * collecting (`soft`) flavors.
 */
export interface ValueExpect {
  /** Throwing matchers (assertion-function semantics — later lines may rely on them). */
  <V>(value: V): Matchers<V>
  /** Collect-don't-throw: failure recorded, callback continues. */
  soft<V>(value: V): Matchers<V>
}

// ─────────────────────────────────────────────────────────────────
// Always-on namespaces (every execution captures these)
// ─────────────────────────────────────────────────────────────────

/**
 * Namespaces available on EVERY task — latency, cost, and errors are
 * captured for all executions and are not capabilities.
 */
export interface AlwaysOnExpect {
  latency: {
    /** Assert the cell's wall-clock duration is under `max` milliseconds. */
    toBeUnderMs(max: number): void
    /** Matchers over the p95 latency across this cell's operations. */
    p95(): Matchers<number>
  }
  cost: {
    /** Assert the cell's total cost is under `max` USD. */
    toBeUnderUsd(max: number): void
    /** Matchers over the cell's token usage. */
    tokens(): Matchers<TokenUsage>
    /** Assert a specific model served the calls. */
    toHaveModel(modelId: string): void
    /** Assert no fallback model was used. */
    toHaveNoFallback(): void
  }
  errors: {
    /** Assert the cell raised no errors. */
    toHaveNone(): void
    /** Assert at most `n` retries occurred. */
    toHaveRetriedAtMost(n: number): void
  }
}

// ─────────────────────────────────────────────────────────────────
// Capability-gated signal namespaces
// ─────────────────────────────────────────────────────────────────

/** Tool-call argument matcher: a partial object or a predicate. */
export type ArgsMatcher = Record<string, unknown> | ((args: Record<string, unknown>) => boolean)

/**
 * The full signal-namespace surface. `BoundExpect` picks the subset matching
 * the task's capabilities — these namespaces never exist on tasks that cannot
 * capture them.
 */
export interface SignalExpect {
  toolCalls: {
    /** Assert `tool` was called (optionally with matching args). */
    toHaveCalled(tool: string, withArgs?: ArgsMatcher): void
    /** Assert every tool in the set was called, in any order. */
    toHaveCalledAll(tools: readonly string[]): void
    not: {
      /** Assert `tool` was never called. */
      toHaveCalled(tool: string): void
    }
    /**
     * Trajectory matching. Outcome-first guidance: prefer `'subset'`/
     * `'superset'`; `'strict'` is for hard protocol checks.
     */
    toMatchTrajectory(
      mode: 'strict' | 'unordered' | 'subset' | 'superset',
      trajectory: readonly { tool: string; args?: ArgsMatcher }[],
    ): void
    /** Hard invariant: `first` occurs before `second` whenever both occur. */
    toHaveCalledBefore(first: string, second: string): void
    /** Assert every tool call returned without error. */
    toHaveAllSucceeded(): void
    /** Matchers over the number of tool calls. */
    count(): Matchers<number>
  }
  steps: {
    /** Assert the named step ran (any status). */
    toHaveRun(name: string): void
    /** Assert the named step ran and succeeded. */
    toHaveSucceeded(name: string): void
    /** Assert the names occurred in this relative order (subsequence, not exhaustive). */
    toHaveOrder(...names: readonly string[]): void
    /** Matchers over the number of steps. */
    count(): Matchers<number>
  }
  handoffs: {
    /** Assert control was handed to the named agent at least once. */
    toHaveHandedOffTo(agent: string): void
    /** Assert the exact delegation path. */
    toHavePath(...agents: readonly string[]): void
    /** Matchers over the number of handoffs. */
    count(): Matchers<number>
  }
  retrieval: {
    /** Assert some hit matches the given fields. */
    toContainHit(m: { sourceId?: string; chunkId?: string; namespace?: string }): void
    /** Assert the top-ranked hit comes from the given source. */
    toHaveTopHit(m: { sourceId: string }): void
    /** Matchers over the raw hits. */
    hits(): Matchers<readonly RetrieverHit[]>
    /** Matchers over the number of hits. */
    count(): Matchers<number>
  }
  citations: {
    /** Assert the output cites the given source. */
    toCite(sourceId: string): void
    /** Assert every citation resolved to a real source. */
    toAllResolve(): void
    /** Assert no citation points at a missing source. */
    toHaveNoDangling(): void
    /** Assert cited spans actually appear in the output. */
    toQuoteOutput(opts?: { minLength?: number }): void
    /** Matchers over the number of citations. */
    count(): Matchers<number>
  }
  safety: {
    /** Assert no guardrail blocked the execution. */
    toHavePassedGuardrails(): void
    /** Assert the named guardrail blocked. */
    toHaveBlocked(guardrailId: string): void
    /** Assert the named constraint passed. */
    toHavePassedConstraint(constraintId: string): void
    /** Assert every evaluated constraint passed. */
    toHaveAllConstraintsPassed(): void
  }
  memory: {
    /** Assert a memory read occurred (optionally for `key`). */
    toHaveRead(key?: string): void
    /** Assert a memory write occurred (optionally for `key`). */
    toHaveWritten(key?: string): void
    /** Assert the stored value for `key` deep-equals `value`. */
    toHaveValue(key: string, value: unknown): void
  }
  routing: {
    /** Assert the named route was selected. */
    toHaveSelected(route: string): void
    /** Assert the router classified the input as `label`. */
    toHaveClassifiedAs(label: string): void
    /** Assert the named model was selected. */
    toHaveSelectedModel(modelId: string): void
  }
  modelCalls: {
    /** Matchers over the number of model calls. */
    count(): Matchers<number>
    /** Assert the named model served at least one call. */
    toHaveUsedModel(modelId: string): void
    /** Assert no fallback model was used. */
    toHaveNoFallback(): void
  }
}

/**
 * Bound, capability-typed assertion API. Value matchers + always-on
 * latency/cost/errors; signal namespaces exist ONLY when the task captures
 * that capability (compile time). Runtime backstop: asserting on a signal
 * that was not captured in THIS execution throws {@link UncapturedSignalError}
 * — never a vacuous pass.
 *
 * @typeParam TOutput - The task output type (reserved for output-bound matchers).
 * @typeParam TCaps   - The task's capability union, gating signal namespaces.
 *
 * @example
 * ```ts
 * evaluate({
 *   task: supportAgent,
 *   data: cases,
 *   expect: (ctx) => {
 *     ctx.expect(ctx.output.answer).toContain('refund')      // value matcher
 *     ctx.expect.toolCalls.toHaveCalled('lookupOrder')        // agent capability
 *     ctx.expect.latency.toBeUnderMs(5000)                    // always-on
 *   },
 * })
 * ```
 */
export type BoundExpect<TOutput, TCaps extends Capability> = ValueExpect &
  AlwaysOnExpect &
  Pick<SignalExpect, Extract<TCaps, keyof SignalExpect>>

// ─────────────────────────────────────────────────────────────────
// Case context
// ─────────────────────────────────────────────────────────────────

/** Typed access to one named flow/agent step. */
export interface StepAccess<O> {
  /** The step's output, schema-narrowed when a schema was supplied. */
  output: O
  status: 'succeeded' | 'failed' | 'skipped'
  durationMs: number
}

/** `ctx.step` — present only on tasks that capture the `steps` signal. */
export interface StepAccessor {
  /** Typed-unknown access to a named step. */
  (name: string): StepAccess<unknown>
  /** Schema-narrowed access (zod / valibot / arktype via Standard Schema). */
  <S extends StandardSchemaV1>(name: string, schema: S): StepAccess<StandardSchemaV1.InferOutput<S>>
}

/**
 * Everything an `expect` callback receives for one executed cell — typed
 * input/output/expected, the bound assertion surface, the variant and trial
 * coordinates, ad-hoc scoring, step access, and the devtools trace link.
 *
 * @typeParam TInput    - Case input type (from the task).
 * @typeParam TOutput   - Task output type.
 * @typeParam TExpected - The case's `expected` payload type.
 * @typeParam TCaps     - The task's capability union.
 *
 * @example
 * ```ts
 * expect: async (ctx) => {
 *   ctx.expect(ctx.output.answer).toContain(ctx.expected?.mustMention ?? '')
 *   ctx.score('answer-length', Math.min(1, ctx.output.answer.length / 400))
 * }
 * ```
 */
export interface CaseContext<TInput, TOutput, TExpected, TCaps extends Capability> {
  /** The case input the task ran with. */
  input: TInput
  /** The task output for this cell. */
  output: TOutput
  /** The case's `expected` payload — opaque data; nothing matches it implicitly. */
  expected: TExpected | undefined
  /** The bound, capability-typed assertion surface. */
  expect: BoundExpect<TOutput, TCaps>
  /** The variant this cell executed under. */
  variant: { name: string; params: Record<string, unknown> }
  /** 0-based trial index. */
  trial: number
  /**
   * Record an ad-hoc per-case score; joins the same score model as scorers
   * (reported, aggregated with mean + SEM, gateable by name).
   */
  score(name: string, score: number, metadata?: Record<string, unknown>): void
  /**
   * Typed-unknown step access with optional schema narrowing. Only present
   * when the task captures `steps` (flows and agents).
   */
  step: 'steps' extends TCaps ? StepAccessor : never
  /** Devtools deep link + raw trace access for power users. */
  trace: { id?: string; url?: string }
  /** Cell metadata: duration, cost, token usage. */
  meta: { durationMs: number; costUsd?: number; usage?: TokenUsage }
}

// The runtime construction of this surface lives in
// `./internal/expect-runtime.ts` (`createRuntimeBoundExpect`) — the engine
// builds one bound expect per executed cell from the cell's captured trace
// signals.
