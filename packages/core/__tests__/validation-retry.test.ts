import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ValidationExhaustedError, isValidationExhaustedError } from '../src/generation/validation-retry'
import type { ValidationRetryOptions } from '../src/generation/validation-retry'

describe('ValidationExhaustedError', () => {
  const zodSchema = z.object({ name: z.string(), age: z.number() })
  const zodError = zodSchema.safeParse({ name: 123, age: 'wrong' }).error!

  it('constructs with all required fields', () => {
    const err = new ValidationExhaustedError({
      lastRawOutput: '{"name": 123}',
      zodErrors: zodError,
      attempts: 3,
      maxAttempts: 3,
      promptId: 'test-prompt',
    })

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ValidationExhaustedError)
    expect(err.name).toBe('ValidationExhaustedError')
    // Evidence only: a public terminal error describes output the caller was never
    // allowed to see, so it carries size and hash but no preview.
    expect(err.lastOutput.preview).toBeUndefined()
    expect(err.lastOutput.sizeBytes).toBeGreaterThan(0)
    expect(err.lastOutput.hash).toEqual(expect.any(String))
    expect(err.decisions).toEqual([
      expect.objectContaining({
        policyId: 'validation.feedback',
        boundary: 'validation.feedback',
        action: 'block',
        captured: expect.not.objectContaining({ preview: expect.anything() }),
      }),
    ])
    // Sanitized rather than stored by identity: issue paths/codes survive, authored
    // messages (which can embed the rejected value) do not.
    expect(err.zodErrors).not.toBe(zodError)
    expect(err.issues).toEqual([
      { path: 'name', depth: 1, code: 'invalid_type' },
      { path: 'age', depth: 1, code: 'invalid_type' },
    ])
    expect(err.attempts).toBe(3)
    expect(err.maxAttempts).toBe(3)
    expect(err.promptId).toBe('test-prompt')
  })

    it('has a descriptive message', () => {
    const err = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: zodError,
      attempts: 3,
      maxAttempts: 3,
      promptId: 'my-prompt',
    })

    expect(err.message).toContain('my-prompt')
    expect(err.message).toContain('3')
  })

    it('preserves the prototype chain for instanceof checks', () => {
    const err = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: zodError,
      attempts: 1,
      maxAttempts: 3,
      promptId: 'test',
    })

    expect(err instanceof ValidationExhaustedError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })
})

describe('isValidationExhaustedError()', () => {
  const zodError = z.object({ x: z.number() }).safeParse({ x: 'bad' }).error!

  it('returns true for ValidationExhaustedError instances', () => {
    const err = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: zodError,
      attempts: 1,
      maxAttempts: 3,
      promptId: 'test',
    })
    expect(isValidationExhaustedError(err)).toBe(true)
  })

    it('returns false for regular Error instances', () => {
    expect(isValidationExhaustedError(new Error('nope'))).toBe(false)
  })

    it('returns false for null/undefined', () => {
    expect(isValidationExhaustedError(null)).toBe(false)
    expect(isValidationExhaustedError(undefined)).toBe(false)
  })
})

describe('ValidationRetryOptions type', () => {
  it('accepts valid options', () => {
    const opts: ValidationRetryOptions = {
      maxRetries: 3,
      onRetry: (_attempt, _error) => {},
      onExhausted: (_attempts, _lastError) => {},
    }
    expect(opts.maxRetries).toBe(3)
  })

    it('all fields are optional', () => {
    const opts: ValidationRetryOptions = {}
    expect(opts.maxRetries).toBeUndefined()
  })
})
