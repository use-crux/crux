/**
 * Pure unit tests for `mapAiSdkFinishReason` and `mapAiSdkError`
 * (packages/ai/src/normalized-outcome.ts) — no gateway, no SDK involvement.
 */

import { describe, expect, it } from 'vitest'
import { describeNormalizedOutcomeConformance } from '@use-crux/core/adapter/testing'
import { mapAiSdkError, mapAiSdkFinishReason } from '../src/normalized-outcome'

describeNormalizedOutcomeConformance({
  name: 'ai-sdk',
  mapFinishReason: (raw: string) => mapAiSdkFinishReason(raw),
  finishReasonCases: [
    { label: 'stop', raw: 'stop', expected: 'stop' },
    { label: 'length', raw: 'length', expected: 'length' },
    { label: 'tool-calls', raw: 'tool-calls', expected: 'tool-calls' },
    { label: 'content-filter', raw: 'content-filter', expected: 'content-filter' },
  ],
  unrecognizedFinishReason: 'other',
  modelSideBlocking: true,
  mapError: mapAiSdkError,
  errorCases: [
    { label: '429', error: Object.assign(new Error('rate limited'), { statusCode: 429 }), kind: 'rate-limit', retryable: true },
    { label: '400', error: Object.assign(new Error('bad request'), { statusCode: 400 }), kind: 'invalid-request', retryable: false },
    { label: '408', error: Object.assign(new Error('timeout'), { statusCode: 408 }), kind: 'timeout', retryable: true },
    { label: '500', error: Object.assign(new Error('server'), { statusCode: 500 }), kind: 'provider-error', retryable: true },
    { label: 'abort', error: Object.assign(new Error('abort'), { name: 'AbortError' }), kind: 'aborted', retryable: false },
  ],
  unrecognizedError: new Error('mystery'),
})

describe('mapAiSdkFinishReason', () => {
  it('returns undefined for null/undefined', () => {
    expect(mapAiSdkFinishReason(null)).toBeUndefined()
    expect(mapAiSdkFinishReason(undefined)).toBeUndefined()
  })

  const cases: Array<[string, string]> = [
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool-calls', 'tool-calls'],
    ['content-filter', 'content-filter'],
    ['error', 'error'],
  ]
  for (const [raw, expected] of cases) {
    it(`maps "${raw}" to "${expected}"`, () => {
      expect(mapAiSdkFinishReason(raw)).toBe(expected)
    })
  }

  it('clamps "other" and any unrecognized value to "unknown"', () => {
    expect(mapAiSdkFinishReason('other')).toBe('unknown')
    expect(mapAiSdkFinishReason('some-future-reason')).toBe('unknown')
  })

  it('never produces "refusal" (the SDK has no distinct refusal signal)', () => {
    for (const raw of ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'other']) {
      expect(mapAiSdkFinishReason(raw)).not.toBe('refusal')
    }
  })
})

describe('mapAiSdkError', () => {
  it('returns undefined for non-Error values', () => {
    expect(mapAiSdkError('boom')).toBeUndefined()
    expect(mapAiSdkError(undefined)).toBeUndefined()
    expect(mapAiSdkError({ status: 500 })).toBeUndefined()
  })

  it('classifies AbortError/AI_AbortError as non-retryable aborted', () => {
    for (const name of ['AbortError', 'AI_AbortError']) {
      const error = Object.assign(new Error('aborted'), { name })
      expect(mapAiSdkError(error)).toMatchObject({ kind: 'aborted', retryable: false })
    }
  })

  it('classifies a *TimeoutError name as retryable timeout', () => {
    const error = Object.assign(new Error('too slow'), { name: 'AI_TimeoutError' })
    expect(mapAiSdkError(error)).toMatchObject({ kind: 'timeout', retryable: true })
  })

  it('classifies statusCode 429 as retryable rate-limit', () => {
    const error = Object.assign(new Error('rate limited'), { statusCode: 429 })
    expect(mapAiSdkError(error)).toMatchObject({ kind: 'rate-limit', retryable: true })
  })

  it('classifies status 408 as retryable timeout', () => {
    const error = Object.assign(new Error('timed out'), { status: 408 })
    expect(mapAiSdkError(error)).toMatchObject({ kind: 'timeout', retryable: true })
  })

  it('classifies 401/403 as non-retryable invalid-request (authentication)', () => {
    for (const status of [401, 403]) {
      const error = Object.assign(new Error('unauthorized'), { statusCode: status })
      expect(mapAiSdkError(error)).toMatchObject({
        kind: 'invalid-request',
        code: 'ai-sdk.authentication',
        retryable: false,
      })
    }
  })

  it('classifies other 4xx as non-retryable invalid-request', () => {
    const error = Object.assign(new Error('bad request'), { statusCode: 400 })
    expect(mapAiSdkError(error)).toMatchObject({
      kind: 'invalid-request',
      code: 'ai-sdk.invalid_request',
      retryable: false,
    })
  })

  it('classifies 5xx as retryable provider-error', () => {
    const error = Object.assign(new Error('server exploded'), { statusCode: 503 })
    expect(mapAiSdkError(error)).toMatchObject({
      kind: 'provider-error',
      code: 'ai-sdk.server_error',
      retryable: true,
    })
  })

  it('classifies a statusless isRetryable error as a retryable connection error', () => {
    const error = Object.assign(new Error('connection reset'), { isRetryable: true })
    expect(mapAiSdkError(error)).toMatchObject({
      kind: 'provider-error',
      code: 'ai-sdk.connection_error',
      retryable: true,
    })
  })

  it('classifies AI_RetryError by name as a retryable connection error', () => {
    const error = Object.assign(new Error('exhausted retries'), { name: 'AI_RetryError' })
    expect(mapAiSdkError(error)).toMatchObject({
      kind: 'provider-error',
      code: 'ai-sdk.connection_error',
      retryable: true,
    })
  })

  it('classifies a statusless AI_APICallError as a non-retryable provider-error', () => {
    const error = Object.assign(new Error('call failed'), { name: 'AI_APICallError' })
    expect(mapAiSdkError(error)).toMatchObject({
      kind: 'provider-error',
      code: 'ai-sdk.provider_error',
      retryable: false,
    })
  })

  it('classifies AI_NoOutputGeneratedError as an invalid response', () => {
    const error = Object.assign(new Error('No output generated.'), { name: 'AI_NoOutputGeneratedError' })
    expect(mapAiSdkError(error)).toMatchObject({
      kind: 'invalid-response',
      code: 'ai-sdk.no_output_generated',
      retryable: true,
    })
  })

  it('defers a fully unrecognized error to core generic classification', () => {
    const error = new Error('mystery failure')
    expect(mapAiSdkError(error)).toBeUndefined()
  })
})
