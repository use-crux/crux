/**
 * Structural assertions for the canonical managed adapter result envelope.
 *
 * The helper is framework-agnostic by design: shared conformance runners can
 * call it directly and translate thrown errors into Vitest failures or
 * provider-runtime violation records.
 *
 * @module
 */

import type { ApprovalRequestInfo } from '../../adapter/tool/approval'
import type { Message } from '../../generation/messages'
import type { TraceMeta } from '../../generation/types'

/** Nested token usage shape required by the canonical result envelope. */
export interface CanonicalTokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly inputTokenDetails: {
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  }
  readonly outputTokenDetails: {
    readonly reasoningTokens?: number
  }
}

/** Last-step view carried alongside accumulated top-level result fields. */
export interface CanonicalFinalStepInfo {
  readonly text: string
  readonly usage: CanonicalTokenUsage
  readonly finishReason: string | undefined
  readonly responseId: string | undefined
  readonly modelId: string | undefined
}

/** Structural subset of the future public `GenerateResult` contract. */
export interface CanonicalGenerateResultLike<TRaw = unknown, TOutput = unknown> {
  readonly text: string
  readonly object?: TOutput
  readonly usage: CanonicalTokenUsage
  readonly cost?: unknown
  readonly steps: number
  readonly finalStep: CanonicalFinalStepInfo
  readonly messages: readonly Message[]
  readonly pendingApprovals?: readonly ApprovalRequestInfo[]
  readonly raw: TRaw
  readonly _meta: TraceMeta
}

/** One expected model step used to verify envelope accumulation semantics. */
export interface CanonicalResultStepExpectation {
  readonly text: string
  readonly usage: CanonicalTokenUsage
  readonly finishReason: string | undefined
  readonly responseId: string | undefined
  readonly modelId: string | undefined
}

/** Optional expectations layered on top of structural envelope validation. */
export interface CanonicalResultExpectation {
  /**
   * Expected step facts, in execution order.
   *
   * When provided, the helper verifies accumulated `text`, accumulated
   * `usage`, `steps`, and the `finalStep` snapshot. Detail usage fields that
   * are absent from every step must remain absent in the accumulated usage.
   */
  readonly steps?: readonly CanonicalResultStepExpectation[]
}

type MutableTokenDetails = {
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** Assert that a value has the canonical `generate()` result envelope shape. */
export function assertCanonicalResult(
  result: unknown,
  expectation: CanonicalResultExpectation = {},
): asserts result is CanonicalGenerateResultLike {
  const envelope = asRecord(result, 'result')

  assertString(requireField(envelope, 'text', 'result'), 'result.text')
  const usage = assertTokenUsage(requireField(envelope, 'usage', 'result'), 'result.usage')
  assertNumber(requireField(envelope, 'steps', 'result'), 'result.steps')
  assertFinalStep(requireField(envelope, 'finalStep', 'result'), 'result.finalStep')
  assertArray(requireField(envelope, 'messages', 'result'), 'result.messages')
  requireField(envelope, 'raw', 'result')
  asRecord(requireField(envelope, '_meta', 'result'), 'result._meta')

  if (hasOwn(envelope, 'pendingApprovals') && envelope.pendingApprovals !== undefined) {
    assertArray(envelope.pendingApprovals, 'result.pendingApprovals')
  }

  if (expectation.steps) {
    assertAccumulation(envelope, usage, expectation.steps)
  }
}

function assertAccumulation(
  envelope: Record<string, unknown>,
  usage: CanonicalTokenUsage,
  steps: readonly CanonicalResultStepExpectation[],
): void {
  const expectedText = steps.map((step) => step.text).join('')
  if (envelope.text !== expectedText) fail('result.text', `the accumulated step text ${JSON.stringify(expectedText)}`)
  if (envelope.steps !== steps.length) fail('result.steps', `the number of expected steps (${steps.length})`)

  assertUsageEquals(usage, sumUsage(steps), 'result.usage')

  const finalStep = steps.at(-1)
  if (!finalStep) return
  const actualFinalStep = asRecord(envelope.finalStep, 'result.finalStep')
  if (actualFinalStep.text !== finalStep.text) fail('result.finalStep.text', JSON.stringify(finalStep.text))
  assertUsageEquals(assertTokenUsage(actualFinalStep.usage, 'result.finalStep.usage'), finalStep.usage, 'result.finalStep.usage')
  assertEqual(actualFinalStep.finishReason, finalStep.finishReason, 'result.finalStep.finishReason')
  assertEqual(actualFinalStep.responseId, finalStep.responseId, 'result.finalStep.responseId')
  assertEqual(actualFinalStep.modelId, finalStep.modelId, 'result.finalStep.modelId')
}

function assertFinalStep(value: unknown, path: string): void {
  const finalStep = asRecord(value, path)
  assertString(requireField(finalStep, 'text', path), `${path}.text`)
  assertTokenUsage(requireField(finalStep, 'usage', path), `${path}.usage`)
  assertStringOrUndefined(requireField(finalStep, 'finishReason', path), `${path}.finishReason`)
  assertStringOrUndefined(requireField(finalStep, 'responseId', path), `${path}.responseId`)
  assertStringOrUndefined(requireField(finalStep, 'modelId', path), `${path}.modelId`)
}

function assertTokenUsage(value: unknown, path: string): CanonicalTokenUsage {
  const usage = asRecord(value, path)
  const inputTokenDetails = asRecord(requireField(usage, 'inputTokenDetails', path), `${path}.inputTokenDetails`)
  const outputTokenDetails = asRecord(requireField(usage, 'outputTokenDetails', path), `${path}.outputTokenDetails`)

  return {
    inputTokens: assertNumber(requireField(usage, 'inputTokens', path), `${path}.inputTokens`),
    outputTokens: assertNumber(requireField(usage, 'outputTokens', path), `${path}.outputTokens`),
    totalTokens: assertNumber(requireField(usage, 'totalTokens', path), `${path}.totalTokens`),
    inputTokenDetails: {
      ...optionalNumber(inputTokenDetails, 'cacheReadTokens', `${path}.inputTokenDetails.cacheReadTokens`),
      ...optionalNumber(inputTokenDetails, 'cacheWriteTokens', `${path}.inputTokenDetails.cacheWriteTokens`),
    },
    outputTokenDetails: {
      ...optionalNumber(outputTokenDetails, 'reasoningTokens', `${path}.outputTokenDetails.reasoningTokens`),
    },
  }
}

function sumUsage(steps: readonly CanonicalResultStepExpectation[]): CanonicalTokenUsage {
  const details: MutableTokenDetails = {}
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0

  for (const step of steps) {
    inputTokens += step.usage.inputTokens
    outputTokens += step.usage.outputTokens
    totalTokens += step.usage.totalTokens

    if (step.usage.inputTokenDetails.cacheReadTokens !== undefined) {
      details.cacheReadTokens = (details.cacheReadTokens ?? 0) + step.usage.inputTokenDetails.cacheReadTokens
    }
    if (step.usage.inputTokenDetails.cacheWriteTokens !== undefined) {
      details.cacheWriteTokens = (details.cacheWriteTokens ?? 0) + step.usage.inputTokenDetails.cacheWriteTokens
    }
    if (step.usage.outputTokenDetails.reasoningTokens !== undefined) {
      details.reasoningTokens = (details.reasoningTokens ?? 0) + step.usage.outputTokenDetails.reasoningTokens
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    inputTokenDetails: {
      ...(details.cacheReadTokens !== undefined ? { cacheReadTokens: details.cacheReadTokens } : {}),
      ...(details.cacheWriteTokens !== undefined ? { cacheWriteTokens: details.cacheWriteTokens } : {}),
    },
    outputTokenDetails: {
      ...(details.reasoningTokens !== undefined ? { reasoningTokens: details.reasoningTokens } : {}),
    },
  }
}

function assertUsageEquals(actual: CanonicalTokenUsage, expected: CanonicalTokenUsage, path: string): void {
  assertEqual(actual.inputTokens, expected.inputTokens, `${path}.inputTokens`)
  assertEqual(actual.outputTokens, expected.outputTokens, `${path}.outputTokens`)
  assertEqual(actual.totalTokens, expected.totalTokens, `${path}.totalTokens`)
  assertEqual(
    actual.inputTokenDetails.cacheReadTokens,
    expected.inputTokenDetails.cacheReadTokens,
    `${path}.inputTokenDetails.cacheReadTokens`,
  )
  assertEqual(
    actual.inputTokenDetails.cacheWriteTokens,
    expected.inputTokenDetails.cacheWriteTokens,
    `${path}.inputTokenDetails.cacheWriteTokens`,
  )
  assertEqual(
    actual.outputTokenDetails.reasoningTokens,
    expected.outputTokenDetails.reasoningTokens,
    `${path}.outputTokenDetails.reasoningTokens`,
  )
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'an object')
  return value as Record<string, unknown>
}

function requireField(record: Record<string, unknown>, key: string, path: string): unknown {
  if (!hasOwn(record, key)) fail(`${path}.${key}`, 'present')
  return record[key]
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function assertArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) fail(path, 'an array')
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'a string')
  return value
}

function assertStringOrUndefined(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') fail(path, 'a string or undefined')
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number')
  return value
}

function optionalNumber(record: Record<string, unknown>, key: string, path: string): Record<string, number> {
  const value = record[key]
  if (value === undefined) return {}
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number when present')
  return { [key]: value }
}

function assertEqual(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) fail(path, JSON.stringify(expected))
}

function fail(path: string, expected: string): never {
  throw new Error(`Expected canonical result ${path} to be ${expected}.`)
}
