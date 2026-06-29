/**
 * Characterization tests for the **generation lifecycle public surface** of
 * `@use-crux/core`.
 *
 * Companion to `public-import-surface.test.ts` and `runtime-public-surface.test.ts`,
 * scoped to the provider-neutral generation domain that the structure refactor
 * relocates into `packages/core/generation/`. Every assertion imports through the
 * **package specifier** (`@use-crux/core`), never a relative path, so the suite
 * is immune to internal file moves: when `orchestrate.ts`, `fallback.ts`,
 * `retry.ts`, `validation-retry.ts`, `repair-json.ts`, and `messages.ts` migrate
 * into the `generation/` domain (and `orchestrate.ts` splits by concern), these
 * tests must stay green without edits.
 *
 * What this suite pins:
 * - the documented generation values resolve and are callable;
 * - `fallback()` builds a recognizable wrapper and classifies retryable errors;
 * - `repairJsonText()` repairs malformed JSON;
 * - `ValidationExhaustedError` round-trips through its type guard;
 * - the `@internal` orchestration helpers (`orchestrateGenerate`,
 *   `orchestrateStream`, `executeFallbackLoop`, `withAttemptTimeout`,
 *   `wrapStreamIterable`) are present on the package surface.
 */

import { describe, it, expect } from 'vitest'
import {
  fallback,
  isFallback,
  classifyError,
  shouldAttemptFallback,
  repairJsonText,
  ValidationExhaustedError,
  isValidationExhaustedError,
  orchestrateGenerate,
  orchestrateStream,
  executeFallbackLoop,
  withAttemptTimeout,
  wrapStreamIterable,
} from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// Documented generation entry points
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core (generation surface)', () => {
  it('exposes the documented generation values', () => {
    expect(typeof fallback).toBe('function')
    expect(typeof isFallback).toBe('function')
    expect(typeof classifyError).toBe('function')
    expect(typeof shouldAttemptFallback).toBe('function')
    expect(typeof repairJsonText).toBe('function')
    expect(typeof ValidationExhaustedError).toBe('function')
    expect(typeof isValidationExhaustedError).toBe('function')
  })

  it('exposes the internal orchestration helpers', () => {
    expect(typeof orchestrateGenerate).toBe('function')
    expect(typeof orchestrateStream).toBe('function')
    expect(typeof executeFallbackLoop).toBe('function')
    expect(typeof withAttemptTimeout).toBe('function')
    expect(typeof wrapStreamIterable).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────
// fallback() — model fallback wrapper + error classification
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core fallback()', () => {
  it('wraps models into a recognizable fallback reference', () => {
    const fb = fallback('model-a', 'model-b', { on: ['rate_limit', 'timeout'] })

    expect(isFallback(fb)).toBe(true)
    expect(fb.models).toEqual(['model-a', 'model-b'])
    expect(fb.options.on).toEqual(['rate_limit', 'timeout'])
    expect(isFallback('model-a')).toBe(false)
  })

  it('classifies retryable errors and gates fallback by category', () => {
    const rateLimited = Object.assign(new Error('429'), { status: 429 })
    expect(classifyError(rateLimited)).toBe('rate_limit')
    expect(shouldAttemptFallback(rateLimited, { on: ['rate_limit'] })).toBe(true)
    expect(shouldAttemptFallback(rateLimited, { on: ['timeout'] })).toBe(false)

    const badRequest = Object.assign(new Error('400'), { status: 400 })
    expect(classifyError(badRequest)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// repairJsonText() — JSON repair
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core repairJsonText()', () => {
  it('strips markdown fences and returns valid JSON text', () => {
    const repaired = repairJsonText('```json\n{ "a": 1 }\n```')
    expect(repaired).not.toBeNull()
    expect(JSON.parse(repaired!)).toEqual({ a: 1 })
  })

  it('returns null for unrepairable text', () => {
    expect(repairJsonText('not json at all')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// ValidationExhaustedError — structured-output retry exhaustion
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core ValidationExhaustedError', () => {
  it('round-trips through its type guard and is fallback-classified', () => {
    const err = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: { message: 'invalid' } as never,
      attempts: 3,
      maxAttempts: 3,
      promptId: 'p',
    })

    expect(isValidationExhaustedError(err)).toBe(true)
    expect(err.name).toBe('ValidationExhaustedError')
    expect(classifyError(err)).toBe('validation_exhausted')
  })
})

// ─────────────────────────────────────────────────────────────────
// withAttemptTimeout() — generic per-attempt timeout
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core withAttemptTimeout()', () => {
  it('resolves a fast function and aborts a slow one', async () => {
    await expect(withAttemptTimeout(() => Promise.resolve('ok'), 1000)).resolves.toBe('ok')

    await expect(
      withAttemptTimeout(() => new Promise((resolve) => setTimeout(() => resolve('late'), 50)), 1),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
