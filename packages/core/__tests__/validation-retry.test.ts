import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ValidationExhaustedError, isValidationExhaustedError } from '../generation/validation-retry'
import type { ValidationRetryOptions } from '../generation/validation-retry'

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
    expect(err.lastRawOutput).toBe('{"name": 123}')
    expect(err.zodErrors).toBe(zodError)
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
