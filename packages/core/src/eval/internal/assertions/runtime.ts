/**
 *
 * The bound expect runtime — real matcher implementations behind
 * `ctx.expect`, with the binding assertion semantics (spec 01 §6):
 *
 * 1. Hard failures throw (Vitest-honest); every assertion that ran is
 *    recorded so reports show position.
 * 2. `expect.soft` records and continues.
 * 3. Evaluation-level and case-level callbacks both run and report
 *    independently.
 * 4. Scorers still run on expect-failed cells (engine concern).
 * 5. Asserting on an uncaptured signal throws {@link UncapturedSignalError}.
 * 6. All assertion outcomes lower into a per-cell `pass` score (engine).
 *
 * @internal Eval engine plumbing only.
 * @module
 */

import type { Capability } from '../capabilities'
import type {
  AlwaysOnExpect,
  ArgsMatcher,
  BoundExpect,
  Matchers,
  SignalExpect,
  StepAccess,
  StepAccessor,
  ValueExpect,
} from './types'
import { UncapturedSignalError } from './types'
import type {
  CellAssertionExpressionOperator,
  CellAssertionOutcome,
  CellAssertionPhase,
  CellAssertionValue,
} from '../assertion-types'
import type { StandardSchemaV1 } from '../schema'
import type { TokenUsage } from '../../../generation/types'
import type { CellSignals } from '../execution-signals'
import { createDecisionReportExpect } from './decision-report-matchers'
import {
  assertionValue,
  isFailureOutcome,
  outcomeId,
  previewAssertionValue as preview,
  type NotEvaluatedAssertion,
} from './outcomes'

// ─────────────────────────────────────────────────────────────────
// Assertion recording
// ─────────────────────────────────────────────────────────────────

/**
 * Sentinel thrown by hard matcher failures. The engine catches it, marks the
 * callback aborted, and runs the counting pass; it never escapes the cell.
 *
 * @internal
 */
export class AssertionFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssertionFailedError'
  }
}

/** Which task kinds capture each signal family (UncapturedSignalError guidance). @internal */
const CAPTURING_KINDS: Record<Capability, readonly string[]> = {
  modelCalls: ['prompt', 'flow', 'agent'],
  toolCalls: ['flow', 'agent'],
  steps: ['flow', 'agent'],
  handoffs: ['agent'],
  retrieval: ['retriever', 'agent'],
  citations: ['prompt', 'agent'],
  safety: ['prompt', 'flow', 'agent'],
  memory: ['flow', 'agent'],
  routing: ['flow', 'agent'],
  decisionReport: ['prompt', 'flow', 'agent'],
}

/**
 * Records every assertion of one cell across both callback levels, in order.
 * `mode: 'counting'` never throws (the second pass measuring `notEvaluated`
 * after a hard failure) — matchers record and continue.
 *
 * @internal
 */
export interface AssertionRecorder {
  phase: CellAssertionPhase
  level: 'eval' | 'case'
  mode: 'real' | 'counting'
  /** Assertions that executed in the real callback pass. */
  readonly ran: number
  /** Ordered assertion ledger for the cell. */
  readonly outcomes: readonly CellAssertionOutcome[]
  /** Record one value/signal matcher result. */
  assert(input: {
    matcher: string
    pass: boolean
    message: string
    soft: boolean
    expected?: unknown
    actual?: unknown
    expectedPreview?: string
    actualPreview?: string
    operator?: CellAssertionExpressionOperator
    /** Concrete observability spans that produced this assertion's signal evidence. */
    spanIds?: readonly string[]
  }): void
  /** Record an assertion against a signal family this cell did not capture. */
  uncaptured(signal: Capability): void
  /** Append placeholders for assertions skipped after a hard failure. */
  recordNotEvaluated(assertions: readonly NotEvaluatedAssertion[]): void
}

/** Create the per-cell assertion recorder. @internal */
export function createAssertionRecorder(): AssertionRecorder {
  let ran = 0
  let nextOutcomeIndex = 0
  const outcomes: CellAssertionOutcome[] = []

  const recorder: AssertionRecorder = {
    level: 'eval',
    phase: 'expect',
    mode: 'real',
    get ran() {
      return ran
    },
    get outcomes() {
      return outcomes
    },
    assert(input) {
      const index = nextOutcomeIndex
      nextOutcomeIndex += 1
      ran += 1
      const sourceRef = captureSourceRef()
      const actual =
        input.actual !== undefined || input.actualPreview !== undefined
          ? assertionValue('actual', input.actual, input.actualPreview)
          : undefined
      const expected =
        input.expected !== undefined || input.expectedPreview !== undefined
          ? assertionValue('expected', input.expected, input.expectedPreview)
          : undefined
      const outcome: CellAssertionOutcome = {
        id: outcomeId(recorder.phase, recorder.level, index),
        level: recorder.level,
        phase: recorder.phase,
        index,
        status: input.pass ? 'passed' : 'failed',
        matcher: input.matcher,
        soft: input.soft,
        ...(input.message !== '' ? { message: input.message } : {}),
        ...(actual !== undefined ? { actual } : {}),
        ...(expected !== undefined ? { expected } : {}),
        ...(input.operator !== undefined && actual !== undefined
          ? { expression: assertionExpression(actual, input.operator, expected, input.pass) }
          : {}),
        ...(input.spanIds !== undefined && input.spanIds.length > 0 ? { spanIds: uniqueSpanIds(input.spanIds) } : {}),
        ...(sourceRef !== undefined ? { sourceRef } : {}),
      }
      outcomes.push(outcome)
      if (input.pass || recorder.mode === 'counting') return
      if (!input.soft) throw new AssertionFailedError(input.message)
    },
    uncaptured(signal) {
      const error = new UncapturedSignalError(signal, CAPTURING_KINDS[signal])
      const index = nextOutcomeIndex
      nextOutcomeIndex += 1
      ran += 1
      const sourceRef = captureSourceRef()
      outcomes.push({
        id: outcomeId(recorder.phase, recorder.level, index),
        level: recorder.level,
        phase: recorder.phase,
        index,
        status: 'uncaptured',
        matcher: `${signal} (uncaptured)`,
        soft: false,
        message: error.message,
        ...(sourceRef !== undefined ? { sourceRef } : {}),
      })
      if (recorder.mode === 'counting') return
      throw error
    },
    recordNotEvaluated(assertions) {
      for (const assertion of assertions) {
        const index = nextOutcomeIndex
        nextOutcomeIndex += 1
        outcomes.push({
          id: outcomeId(assertion.phase, assertion.level, index),
          level: assertion.level,
          phase: assertion.phase,
          index,
          status: 'not-evaluated',
          matcher: assertion.matcher,
          soft: assertion.soft,
          ...(assertion.sourceRef !== undefined ? { sourceRef: assertion.sourceRef } : {}),
        })
      }
    },
  }
  return recorder
}

function assertionExpression(
  actual: CellAssertionValue,
  operator: CellAssertionExpressionOperator,
  expected: CellAssertionValue | undefined,
  result: boolean,
): NonNullable<CellAssertionOutcome['expression']> {
  return {
    left: actual,
    operator,
    ...(expected !== undefined ? { right: expected } : {}),
    result,
    rendered: `${actual.preview}${expected === undefined ? '' : ` ${operator} ${expected.preview}`} => ${String(result)}`,
  }
}

/** Best-effort `file:line:col` of the first stack frame outside Eval internals. @internal */
export function captureSourceRefFromStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('expect-runtime') || line.includes('assertion-callbacks') || line.includes('captureSourceRef')) {
      continue
    }
    const match = /\(?([^()\s]+):(\d+):(\d+)\)?\s*$/.exec(line)
    if (match) return `${match[1]}:${match[2]}:${match[3]}`
  }
  return undefined
}

/** Best-effort `file:line:col` of the authored assertion call. */
function captureSourceRef(): string | undefined {
  return captureSourceRefFromStack(new Error().stack)
}

// ─────────────────────────────────────────────────────────────────
// Value helpers
// ─────────────────────────────────────────────────────────────────

function uniqueSpanIds(spanIds: readonly string[]): string[] {
  return [...new Set(spanIds.filter((spanId) => spanId.length > 0))]
}

function spanIdsFromSignals(signals: readonly { spanId: string }[]): string[] {
  return uniqueSpanIds(signals.map((signal) => signal.spanId))
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined)
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]))
}

function strictDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => strictDeepEqual(item, b[index]))
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => bKeys.includes(key) && strictDeepEqual(aRecord[key], bRecord[key]))
}

function matchesSubset(value: unknown, partial: unknown): boolean {
  if (partial === null || typeof partial !== 'object') return deepEqual(value, partial)
  if (Array.isArray(partial)) {
    if (!Array.isArray(value) || value.length !== partial.length) return false
    return partial.every((item, index) => matchesSubset(value[index], item))
  }
  if (value === null || typeof value !== 'object') return false
  const valueRecord = value as Record<string, unknown>
  return Object.entries(partial as Record<string, unknown>).every(([key, expected]) =>
    matchesSubset(valueRecord[key], expected),
  )
}

function getByPath(value: unknown, path: string): { found: boolean; value: unknown } {
  const segments = path.split('.')
  let current: unknown = value
  for (const segment of segments) {
    if (current === null || typeof current !== 'object' || !(segment in (current as object))) {
      return { found: false, value: undefined }
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}

function matchesArgs(args: Record<string, unknown> | undefined, matcher: ArgsMatcher | undefined): boolean {
  if (matcher === undefined) return true
  if (typeof matcher === 'function') return matcher(args ?? {})
  return matchesSubset(args ?? {}, matcher)
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return sorted[Math.max(0, index)]!
}

// ─────────────────────────────────────────────────────────────────
// Matchers
// ─────────────────────────────────────────────────────────────────

interface MatcherContext {
  recorder: AssertionRecorder
  soft: boolean
  prefix: string
}

function negateOperator(operator: CellAssertionExpressionOperator, negated: boolean): CellAssertionExpressionOperator {
  if (!negated) return operator
  switch (operator) {
    case '>=':
      return '<'
    case '>':
      return '<='
    case '<=':
      return '>'
    case '<':
      return '>='
    case '==':
      return '!='
    case '!=':
      return '=='
    default:
      return 'custom'
  }
}

function createMatchers<V>(value: V, ctx: MatcherContext, negated = false): Matchers<V> {
  const assert = (
    matcher: string,
    pass: boolean,
    message: string,
    expected?: unknown,
    operator?: CellAssertionExpressionOperator,
  ): void => {
    const effectivePass = negated ? !pass : pass
    const effectiveMessage = negated ? message.replace('expected', 'expected not') : message
    const effectiveOperator = operator === undefined ? undefined : negateOperator(operator, negated)
    ctx.recorder.assert({
      matcher: `${ctx.prefix}${negated ? 'not.' : ''}${matcher}`,
      pass: effectivePass,
      message: effectiveMessage,
      soft: ctx.soft,
      actual: value,
      ...(expected !== undefined ? { expected } : {}),
      ...(expected !== undefined ? { expectedPreview: preview(expected) } : {}),
      actualPreview: preview(value),
      ...(effectiveOperator !== undefined ? { operator: effectiveOperator } : {}),
    })
  }

  const matchers: Matchers<V> = {
    toBe(expected) {
      assert(
        'toBe',
        Object.is(value, expected),
        `expected ${preview(value)} to be ${preview(expected)}`,
        expected,
        '==',
      )
    },
    toEqual(expected) {
      assert(
        'toEqual',
        deepEqual(value, expected),
        `expected ${preview(value)} to equal ${preview(expected)}`,
        expected,
        '==',
      )
    },
    toStrictEqual(expected) {
      assert(
        'toStrictEqual',
        strictDeepEqual(value, expected),
        `expected ${preview(value)} to strictly equal ${preview(expected)}`,
        expected,
        '==',
      )
    },
    toMatch(pattern) {
      const text = typeof value === 'string' ? value : undefined
      const pass = text !== undefined && (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text))
      assert('toMatch', pass, `expected ${preview(value)} to match ${String(pattern)}`, String(pattern), 'matches')
    },
    toMatchObject(partial) {
      assert(
        'toMatchObject',
        matchesSubset(value, partial),
        `expected ${preview(value)} to match object ${preview(partial)}`,
        partial,
      )
    },
    toContain(item) {
      const pass =
        typeof value === 'string'
          ? typeof item === 'string' && value.includes(item)
          : Array.isArray(value) && value.some((entry) => Object.is(entry, item))
      assert('toContain', pass, `expected ${preview(value)} to contain ${preview(item)}`, item, 'contains')
    },
    toContainEqual(item) {
      const pass = Array.isArray(value) && value.some((entry) => deepEqual(entry, item))
      assert(
        'toContainEqual',
        pass,
        `expected ${preview(value)} to contain an entry equal to ${preview(item)}`,
        item,
        'contains',
      )
    },
    toHaveLength(n) {
      const length = (value as { length?: unknown })?.length
      assert('toHaveLength', length === n, `expected ${preview(value)} to have length ${n}, got ${String(length)}`, n)
    },
    toHaveProperty(path, expected) {
      const result = getByPath(value, path)
      const pass = result.found && (arguments.length < 2 || deepEqual(result.value, expected))
      assert(
        'toHaveProperty',
        pass,
        `expected ${preview(value)} to have property '${path}'${arguments.length >= 2 ? ` = ${preview(expected)}` : ''}`,
        expected,
      )
    },
    toBeGreaterThan(n) {
      assert(
        'toBeGreaterThan',
        typeof value === 'number' && value > n,
        `expected ${preview(value)} to be > ${n}`,
        n,
        '>',
      )
    },
    toBeGreaterThanOrEqual(n) {
      assert(
        'toBeGreaterThanOrEqual',
        typeof value === 'number' && value >= n,
        `expected ${preview(value)} to be >= ${n}`,
        n,
        '>=',
      )
    },
    toBeLessThan(n) {
      assert('toBeLessThan', typeof value === 'number' && value < n, `expected ${preview(value)} to be < ${n}`, n, '<')
    },
    toBeLessThanOrEqual(n) {
      assert(
        'toBeLessThanOrEqual',
        typeof value === 'number' && value <= n,
        `expected ${preview(value)} to be <= ${n}`,
        n,
        '<=',
      )
    },
    toBeCloseTo(n, digits = 2) {
      const pass = typeof value === 'number' && Math.abs(value - n) < Math.pow(10, -digits) / 2
      assert('toBeCloseTo', pass, `expected ${preview(value)} to be close to ${n} (±10^-${digits}/2)`, n)
    },
    toBeDefined() {
      assert('toBeDefined', value !== undefined, `expected value to be defined, got undefined`)
    },
    toBeUndefined() {
      assert('toBeUndefined', value === undefined, `expected ${preview(value)} to be undefined`)
    },
    toBeNull() {
      assert('toBeNull', value === null, `expected ${preview(value)} to be null`)
    },
    toBeTruthy() {
      assert('toBeTruthy', Boolean(value), `expected ${preview(value)} to be truthy`)
    },
    toBeFalsy() {
      assert('toBeFalsy', !value, `expected ${preview(value)} to be falsy`)
    },
    toBeOneOf(values) {
      assert(
        'toBeOneOf',
        values.some((entry) => deepEqual(value, entry)),
        `expected ${preview(value)} to be one of ${preview(values)}`,
        values,
      )
    },
    toBeInstanceOf(cls) {
      assert(
        'toBeInstanceOf',
        value instanceof cls,
        `expected ${preview(value)} to be an instance of ${cls.name}`,
        cls.name,
      )
    },
    toBeTypeOf(t) {
      assert(
        'toBeTypeOf',
        typeof value === t,
        `expected ${preview(value)} to be of type '${t}', got '${typeof value}'`,
        t,
      )
    },
    toSatisfy(pred, message) {
      assert('toSatisfy', pred(value), message ?? `expected ${preview(value)} to satisfy the predicate`)
    },
    get not() {
      return createMatchers(value, ctx, !negated)
    },
  }
  return matchers
}

// ─────────────────────────────────────────────────────────────────
// Bound expect construction
// ─────────────────────────────────────────────────────────────────

/** Inputs the runtime bound expect needs for one cell. @internal */
export interface BoundExpectRuntime {
  signals: CellSignals
  recorder: AssertionRecorder
  capabilities: readonly Capability[]
  cellDurationMs: () => number
  cellErrored: () => boolean
}

interface SignalAssertionOptions {
  /** Concrete observability spans consulted by this matcher. */
  spanIds?: readonly string[]
}

/**
 * Build the real `ctx.expect` for one executed cell: value matchers,
 * always-on latency/cost/errors, and the capability-gated signal namespaces
 * backed by the cell's captured trace signals.
 *
 * @internal
 */
export function createRuntimeBoundExpect<TOutput, TCaps extends Capability>(
  runtime: BoundExpectRuntime,
): BoundExpect<TOutput, TCaps> {
  const { signals, recorder } = runtime

  const hardCtx: MatcherContext = { recorder, soft: false, prefix: '' }
  const softCtx: MatcherContext = { recorder, soft: true, prefix: 'soft.' }

  const callable = (<V>(value: V): Matchers<V> => createMatchers(value, hardCtx)) as ValueExpect
  ;(callable as { soft?: unknown }).soft = <V>(value: V): Matchers<V> => createMatchers(value, softCtx)

  const assertOn = (
    matcher: string,
    pass: boolean,
    message: string,
    expected?: unknown,
    actual?: unknown,
    options?: SignalAssertionOptions,
  ): void => {
    recorder.assert({
      matcher,
      pass,
      message,
      soft: false,
      ...(expected !== undefined ? { expected } : {}),
      ...(actual !== undefined ? { actual } : {}),
      ...(expected !== undefined ? { expectedPreview: preview(expected) } : {}),
      ...(actual !== undefined ? { actualPreview: preview(actual) } : {}),
      ...(options?.spanIds !== undefined ? { spanIds: options.spanIds } : {}),
    })
  }

  /** Guard a signal namespace: uncaptured → loud fail, never vacuous. */
  const requireCaptured = (signal: Capability): void => {
    if (!signals.captured.has(signal)) recorder.uncaptured(signal)
  }

  const namespaceMatchers = <V>(name: string, value: V): Matchers<V> =>
    createMatchers(value, { recorder, soft: false, prefix: `${name}.` })

  const alwaysOn: AlwaysOnExpect = {
    latency: {
      toBeUnderMs(max) {
        const duration = runtime.cellDurationMs()
        assertOn(
          'latency.toBeUnderMs',
          duration <= max,
          `expected cell latency ${duration}ms to be under ${max}ms`,
          max,
          duration,
        )
      },
      p95() {
        const population =
          signals.operationDurations.length > 0 ? signals.operationDurations : [runtime.cellDurationMs()]
        return namespaceMatchers('latency.p95', percentile(population, 0.95))
      },
    },
    cost: {
      toBeUnderUsd(max) {
        const cost = signals.costUsd ?? 0
        assertOn('cost.toBeUnderUsd', cost <= max, `expected cell cost $${cost} to be under $${max}`, max, cost)
      },
      tokens() {
        return namespaceMatchers('cost.tokens', (signals.usage ?? {}) as TokenUsage)
      },
      toHaveModel(modelId) {
        const models = signals.modelCalls.map((call) => call.model).filter((model) => model !== undefined)
        assertOn(
          'cost.toHaveModel',
          models.includes(modelId),
          models.length === 0
            ? `expected model '${modelId}' to have served calls, but no model calls were captured`
            : `expected model '${modelId}' to have served calls; captured: ${models.join(', ')}`,
          modelId,
          models,
          { spanIds: spanIdsFromSignals(signals.modelCalls) },
        )
      },
      toHaveNoFallback() {
        assertOn('cost.toHaveNoFallback', !signals.usedFallback, 'expected no fallback model to be used')
      },
    },
    errors: {
      toHaveNone() {
        const errored = signals.erroredSpans > 0 || runtime.cellErrored()
        assertOn('errors.toHaveNone', !errored, `expected no errors, found ${signals.erroredSpans} errored span(s)`)
      },
      toHaveRetriedAtMost(n) {
        assertOn(
          'errors.toHaveRetriedAtMost',
          signals.retries <= n,
          `expected at most ${n} retries, found ${signals.retries}`,
          n,
          signals.retries,
        )
      },
    },
  }

  const signalNamespaces: SignalExpect = {
    toolCalls: {
      toHaveCalled(tool, withArgs) {
        requireCaptured('toolCalls')
        const calls = signals.toolCalls.filter((call) => call.tool === tool)
        const pass = calls.some((call) => matchesArgs(call.args, withArgs))
        assertOn(
          'toolCalls.toHaveCalled',
          pass,
          calls.length === 0
            ? `expected tool '${tool}' to have been called; called: ${signals.toolCalls.map((c) => c.tool).join(', ') || '(none)'}`
            : `tool '${tool}' was called but no call matched the expected args`,
          tool,
          signals.toolCalls.map((c) => c.tool),
          { spanIds: spanIdsFromSignals(calls) },
        )
      },
      toHaveCalledAll(tools) {
        requireCaptured('toolCalls')
        const called = new Set(signals.toolCalls.map((call) => call.tool))
        const missing = tools.filter((tool) => !called.has(tool))
        assertOn(
          'toolCalls.toHaveCalledAll',
          missing.length === 0,
          `expected all of [${tools.join(', ')}] to be called; missing: [${missing.join(', ')}]`,
          tools,
          [...called],
          { spanIds: spanIdsFromSignals(signals.toolCalls) },
        )
      },
      not: {
        toHaveCalled(tool) {
          requireCaptured('toolCalls')
          const calls = signals.toolCalls.filter((call) => call.tool === tool)
          assertOn(
            'toolCalls.not.toHaveCalled',
            calls.length === 0,
            `expected tool '${tool}' to never be called`,
            tool,
            undefined,
            { spanIds: spanIdsFromSignals(calls) },
          )
        },
      },
      toMatchTrajectory(mode, trajectory) {
        requireCaptured('toolCalls')
        const actual = signals.toolCalls
        const matches = (call: ToolCallLike, step: { tool: string; args?: ArgsMatcher }): boolean =>
          call.tool === step.tool && matchesArgs(call.args, step.args)
        // LangSmith lattice: 'subset' = the agent made no calls outside the
        // reference; 'superset' = every reference call occurred (extras OK).
        const everyStepOccurred = isSubsequenceSet([...trajectory], [...actual], matches)
        const everyCallLicensed = isSubsequenceSet([...actual], [...trajectory], (step, call) => matches(call, step))
        let pass: boolean
        if (mode === 'strict') {
          pass = actual.length === trajectory.length && trajectory.every((step, index) => matches(actual[index]!, step))
        } else if (mode === 'unordered') {
          pass = actual.length === trajectory.length && everyStepOccurred
        } else if (mode === 'subset') {
          pass = everyCallLicensed
        } else {
          pass = everyStepOccurred
        }
        assertOn(
          'toolCalls.toMatchTrajectory',
          pass,
          `expected tool calls [${actual.map((c) => c.tool).join(', ')}] to match the '${mode}' trajectory [${trajectory
            .map((s) => s.tool)
            .join(', ')}]`,
          trajectory.map((s) => s.tool),
          actual.map((c) => c.tool),
          { spanIds: spanIdsFromSignals(actual) },
        )
      },
      toHaveCalledBefore(first, second) {
        requireCaptured('toolCalls')
        const firstIndex = signals.toolCalls.findIndex((call) => call.tool === first)
        const secondIndex = signals.toolCalls.findIndex((call) => call.tool === second)
        const pass = firstIndex === -1 || secondIndex === -1 || firstIndex < secondIndex
        const orderedCalls = [signals.toolCalls[firstIndex], signals.toolCalls[secondIndex]].filter(
          (call): call is (typeof signals.toolCalls)[number] => call !== undefined,
        )
        assertOn(
          'toolCalls.toHaveCalledBefore',
          pass,
          `expected '${first}' to occur before '${second}' whenever both occur`,
          undefined,
          undefined,
          { spanIds: spanIdsFromSignals(orderedCalls) },
        )
      },
      toHaveAllSucceeded() {
        requireCaptured('toolCalls')
        const failed = signals.toolCalls.filter((call) => !call.succeeded)
        assertOn(
          'toolCalls.toHaveAllSucceeded',
          failed.length === 0,
          `expected every tool call to succeed; failed: [${failed.map((c) => c.tool).join(', ')}]`,
          undefined,
          undefined,
          { spanIds: spanIdsFromSignals(failed) },
        )
      },
      count() {
        requireCaptured('toolCalls')
        return namespaceMatchers('toolCalls.count', signals.toolCalls.length)
      },
    },
    steps: {
      toHaveRun(name) {
        requireCaptured('steps')
        const steps = signals.steps.filter((step) => step.name === name)
        const pass = steps.length > 0
        assertOn(
          'steps.toHaveRun',
          pass,
          `expected step '${name}' to have run; ran: [${signals.steps.map((s) => s.name).join(', ')}]`,
          name,
          signals.steps.map((s) => s.name),
          { spanIds: spanIdsFromSignals(steps) },
        )
      },
      toHaveSucceeded(name) {
        requireCaptured('steps')
        const step = signals.steps.find((entry) => entry.name === name)
        assertOn(
          'steps.toHaveSucceeded',
          step?.status === 'succeeded',
          step === undefined
            ? `expected step '${name}' to have succeeded, but it never ran`
            : `expected step '${name}' to have succeeded, but it ${step.status}`,
          name,
          step?.status,
          { spanIds: step === undefined ? [] : [step.spanId] },
        )
      },
      toHaveOrder(...names) {
        requireCaptured('steps')
        const sequence = signals.steps.map((step) => step.name)
        let cursor = 0
        for (const name of names) {
          const found = sequence.indexOf(name, cursor)
          if (found === -1) {
            cursor = -1
            break
          }
          cursor = found + 1
        }
        assertOn(
          'steps.toHaveOrder',
          cursor !== -1,
          `expected steps [${names.join(', ')}] to occur in order within [${sequence.join(', ')}]`,
          names,
          sequence,
          { spanIds: spanIdsFromSignals(signals.steps) },
        )
      },
      count() {
        requireCaptured('steps')
        return namespaceMatchers('steps.count', signals.steps.length)
      },
    },
    handoffs: {
      toHaveHandedOffTo(agent) {
        requireCaptured('handoffs')
        const pass = signals.handoffs.some((handoff) => handoff.to === agent)
        assertOn(
          'handoffs.toHaveHandedOffTo',
          pass,
          `expected a handoff to '${agent}'; handoffs: [${signals.handoffs.map((h) => `${h.from ?? '?'}→${h.to ?? '?'}`).join(', ')}]`,
          agent,
          undefined,
          { spanIds: spanIdsFromSignals(signals.handoffs.filter((handoff) => handoff.to === agent)) },
        )
      },
      toHavePath(...agents) {
        requireCaptured('handoffs')
        const path = signals.handoffs.map((handoff) => handoff.to).filter((to) => to !== undefined)
        const pass = path.length === agents.length && agents.every((agent, index) => path[index] === agent)
        assertOn(
          'handoffs.toHavePath',
          pass,
          `expected the delegation path [${agents.join(' → ')}], got [${path.join(' → ')}]`,
          agents,
          path,
          { spanIds: spanIdsFromSignals(signals.handoffs) },
        )
      },
      count() {
        requireCaptured('handoffs')
        return namespaceMatchers('handoffs.count', signals.handoffs.length)
      },
    },
    retrieval: {
      toContainHit(m) {
        requireCaptured('retrieval')
        const pass = signals.retrievalHits.some(
          (hit) =>
            (m.sourceId === undefined || hit.source.id === m.sourceId) &&
            (m.chunkId === undefined || hit.chunkId === m.chunkId) &&
            (m.namespace === undefined || hit.namespace === m.namespace),
        )
        assertOn(
          'retrieval.toContainHit',
          pass,
          `expected a retrieval hit matching ${preview(m)}; hits: ${preview(signals.retrievalHits.map((h) => h.source.id))}`,
          m,
          undefined,
          { spanIds: spanIdsFromSignals(signals.retrievalHits) },
        )
      },
      toHaveTopHit(m) {
        requireCaptured('retrieval')
        const sorted = [...signals.retrievalHits].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        const top = sorted[0]
        assertOn(
          'retrieval.toHaveTopHit',
          top?.source.id === m.sourceId,
          `expected the top hit to come from '${m.sourceId}', got '${top?.source.id ?? '(none)'}'`,
          m.sourceId,
          top?.source.id,
          { spanIds: top === undefined ? [] : [top.spanId] },
        )
      },
      hits() {
        requireCaptured('retrieval')
        return namespaceMatchers('retrieval.hits', signals.retrievalHits as never)
      },
      count() {
        requireCaptured('retrieval')
        return namespaceMatchers('retrieval.count', signals.retrievalHits.length)
      },
    },
    citations: {
      toCite(sourceId) {
        requireCaptured('citations')
        const pass = signals.citations.some((citation) => citation.sourceId === sourceId)
        assertOn(
          'citations.toCite',
          pass,
          `expected a citation of '${sourceId}'; cited: [${signals.citations.map((c) => c.sourceId ?? '?').join(', ')}]`,
          sourceId,
          undefined,
          { spanIds: spanIdsFromSignals(signals.citations.filter((citation) => citation.sourceId === sourceId)) },
        )
      },
      toAllResolve() {
        requireCaptured('citations')
        const unresolved = signals.citations.filter(
          (citation) => citation.grounded === false || citation.sourceId === undefined,
        )
        assertOn(
          'citations.toAllResolve',
          unresolved.length === 0,
          `expected every citation to resolve; ${unresolved.length} did not`,
          undefined,
          undefined,
          { spanIds: spanIdsFromSignals(unresolved) },
        )
      },
      toHaveNoDangling() {
        requireCaptured('citations')
        const dangling = signals.citations.filter((citation) => citation.sourceId === undefined)
        assertOn(
          'citations.toHaveNoDangling',
          dangling.length === 0,
          `expected no dangling citations; found ${dangling.length}`,
          undefined,
          undefined,
          { spanIds: spanIdsFromSignals(dangling) },
        )
      },
      toQuoteOutput(opts) {
        requireCaptured('citations')
        const min = opts?.minLength ?? 1
        const pass = signals.citations.every(
          (citation) => citation.outputQuote !== undefined && citation.outputQuote.length >= min,
        )
        assertOn(
          'citations.toQuoteOutput',
          signals.citations.length > 0 && pass,
          `expected every citation to quote the output (min length ${min})`,
          undefined,
          undefined,
          {
            spanIds: spanIdsFromSignals(
              signals.citations.filter(
                (citation) => citation.outputQuote === undefined || citation.outputQuote.length < min,
              ),
            ),
          },
        )
      },
      count() {
        requireCaptured('citations')
        return namespaceMatchers('citations.count', signals.citations.length)
      },
    },
    safety: {
      toHavePassedGuardrails() {
        requireCaptured('safety')
        const blocked = signals.guardrails.filter((guardrail) => guardrail.action === 'block')
        assertOn(
          'safety.toHavePassedGuardrails',
          blocked.length === 0,
          `expected no guardrail to block; blocked: [${blocked.map((g) => g.id ?? '?').join(', ')}]`,
          undefined,
          undefined,
          { spanIds: spanIdsFromSignals(blocked) },
        )
      },
      toHaveBlocked(guardrailId) {
        requireCaptured('safety')
        const guardrails = signals.guardrails.filter((guardrail) => guardrail.id === guardrailId)
        const pass = guardrails.some((guardrail) => guardrail.action === 'block')
        assertOn(
          'safety.toHaveBlocked',
          pass,
          `expected guardrail '${guardrailId}' to have blocked`,
          guardrailId,
          undefined,
          { spanIds: spanIdsFromSignals(guardrails) },
        )
      },
      toHavePassedConstraint(constraintId) {
        requireCaptured('safety')
        const constraint = signals.constraints.find((entry) => entry.id === constraintId)
        assertOn(
          'safety.toHavePassedConstraint',
          constraint?.pass === true,
          constraint === undefined
            ? `expected constraint '${constraintId}' to have passed, but it was never evaluated`
            : `expected constraint '${constraintId}' to have passed, but it failed`,
          constraintId,
          undefined,
          { spanIds: constraint === undefined ? [] : [constraint.spanId] },
        )
      },
      toHaveAllConstraintsPassed() {
        requireCaptured('safety')
        const failed = signals.constraints.filter((constraint) => !constraint.pass)
        assertOn(
          'safety.toHaveAllConstraintsPassed',
          failed.length === 0,
          `expected every constraint to pass; failed: [${failed.map((c) => c.id ?? '?').join(', ')}]`,
          undefined,
          undefined,
          { spanIds: spanIdsFromSignals(failed) },
        )
      },
    },
    memory: {
      toHaveRead(key) {
        requireCaptured('memory')
        const reads = signals.memoryOps.filter((op) => op.op === 'read')
        const pass = key === undefined ? reads.length > 0 : reads.some((op) => op.keys.includes(key))
        assertOn(
          'memory.toHaveRead',
          pass,
          key === undefined ? 'expected a memory read' : `expected a memory read of '${key}'`,
          key,
          undefined,
          { spanIds: spanIdsFromSignals(reads) },
        )
      },
      toHaveWritten(key) {
        requireCaptured('memory')
        const writes = signals.memoryOps.filter((op) => op.op === 'write')
        const pass = key === undefined ? writes.length > 0 : writes.some((op) => op.keys.includes(key))
        assertOn(
          'memory.toHaveWritten',
          pass,
          key === undefined ? 'expected a memory write' : `expected a memory write of '${key}'`,
          key,
          undefined,
          { spanIds: spanIdsFromSignals(writes) },
        )
      },
      toHaveValue(key, value) {
        requireCaptured('memory')
        const ops = signals.memoryOps.filter((op) => op.values[key] !== undefined)
        const stored = ops.map((op) => op.values[key]).at(-1)
        assertOn(
          'memory.toHaveValue',
          deepEqual(stored, value),
          `expected memory '${key}' to hold ${preview(value)}, got ${preview(stored)}`,
          value,
          stored,
          { spanIds: spanIdsFromSignals(ops) },
        )
      },
    },
    routing: {
      toHaveSelected(route) {
        requireCaptured('routing')
        const pass = signals.routing.some((decision) => decision.chosen === route)
        assertOn(
          'routing.toHaveSelected',
          pass,
          `expected route '${route}' to be selected; selected: [${signals.routing.map((r) => r.chosen ?? '?').join(', ')}]`,
          route,
          undefined,
          { spanIds: spanIdsFromSignals(signals.routing) },
        )
      },
      toHaveClassifiedAs(label) {
        requireCaptured('routing')
        const pass = signals.routing.some((decision) => decision.classifiedAs === label)
        assertOn(
          'routing.toHaveClassifiedAs',
          pass,
          `expected the router to classify as '${label}'`,
          label,
          undefined,
          { spanIds: spanIdsFromSignals(signals.routing) },
        )
      },
      toHaveSelectedModel(modelId) {
        requireCaptured('routing')
        const pass = signals.routing.some((decision) => decision.selectedModel === modelId)
        assertOn(
          'routing.toHaveSelectedModel',
          pass,
          `expected model '${modelId}' to be selected`,
          modelId,
          undefined,
          { spanIds: spanIdsFromSignals(signals.routing) },
        )
      },
    },
    decisionReport: createDecisionReportExpect({
      reports: signals.decisionReport,
      assertOn,
      requireCaptured: () => requireCaptured('decisionReport'),
    }),
    modelCalls: {
      count() {
        requireCaptured('modelCalls')
        return namespaceMatchers('modelCalls.count', signals.modelCalls.length)
      },
      toHaveUsedModel(modelId) {
        requireCaptured('modelCalls')
        const models = signals.modelCalls.map((call) => call.model).filter((model) => model !== undefined)
        assertOn(
          'modelCalls.toHaveUsedModel',
          models.includes(modelId),
          `expected model '${modelId}' to serve at least one call; used: [${models.join(', ')}]`,
          modelId,
          models,
          { spanIds: spanIdsFromSignals(signals.modelCalls) },
        )
      },
      toHaveNoFallback() {
        requireCaptured('modelCalls')
        assertOn('modelCalls.toHaveNoFallback', !signals.usedFallback, 'expected no fallback model to be used')
      },
    },
  }

  const surface = callable as ValueExpect & AlwaysOnExpect & Record<string, unknown>
  surface.latency = alwaysOn.latency
  surface.cost = alwaysOn.cost
  surface.errors = alwaysOn.errors
  for (const capability of runtime.capabilities) {
    if (capability in signalNamespaces) {
      surface[capability] = signalNamespaces[capability as keyof SignalExpect]
    }
  }
  return surface as BoundExpect<TOutput, TCaps>
}

interface ToolCallLike {
  tool: string
  args?: Record<string, unknown>
}

/** Greedy set-cover for unordered/subset trajectory matching. */
function isSubsequenceSet<A, B>(needles: A[], haystack: B[], matches: (b: B, a: A) => boolean): boolean {
  const used = new Set<number>()
  for (const needle of needles) {
    const index = haystack.findIndex((candidate, i) => !used.has(i) && matches(candidate, needle))
    if (index === -1) return false
    used.add(index)
  }
  return true
}

// ─────────────────────────────────────────────────────────────────
// ctx.step accessor
// ─────────────────────────────────────────────────────────────────

/**
 * Build the runtime `ctx.step` accessor over the cell's captured step
 * signals, with optional Standard Schema narrowing.
 *
 * @internal
 */
export function createStepAccessor(signals: CellSignals): StepAccessor {
  return (<S extends StandardSchemaV1>(name: string, schema?: S): StepAccess<unknown> => {
    const step = signals.steps.find((entry) => entry.name === name)
    if (step === undefined) {
      throw new Error(
        `ctx.step('${name}'): no step with this name was captured. ` +
          `Captured steps: [${signals.steps.map((entry) => entry.name).join(', ') || '(none)'}].`,
      )
    }
    let output: unknown = step.output
    if (schema !== undefined) {
      const result = schema['~standard'].validate(step.output)
      if (result instanceof Promise) {
        throw new TypeError(`ctx.step('${name}'): async schema validation is not supported — use a synchronous schema.`)
      }
      if (result.issues !== undefined) {
        throw new Error(
          `ctx.step('${name}'): step output failed schema validation: ${result.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        )
      }
      output = result.value
    }
    return { output, status: step.status, durationMs: step.durationMs }
  }) as StepAccessor
}
