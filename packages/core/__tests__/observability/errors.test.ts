import { describe, expect, it } from 'vitest'
import { normalizeObservedError } from '../../observability/errors'

describe('observability error normalization', () => {
  it('preserves Error summaries, stacks, causes, and redacts sensitive raw fields', () => {
    const cause = new Error('inner failure')
    cause.stack = 'Error: inner failure\n    at inner'
    const error = new Error('outer failure', { cause })
    error.stack = 'Error: outer failure\n    at outer'
    Object.assign(error, {
      statusCode: 503,
      retryable: true,
      token: 'secret-token',
      metadata: {
        apiKey: 'secret-key',
        safe: 'visible',
      },
    })

    const normalized = normalizeObservedError(error, { errorKind: 'execute_error', phase: 'tool.execute' })

    expect(normalized.thrown).toBe('error')
    if (normalized.thrown !== 'error') throw new Error('expected Error normalization')
    expect(normalized.summary).toMatchObject({
      message: 'outer failure',
      name: 'Error',
      category: 'execute_error',
      retryable: true,
      statusCode: 503,
    })
    expect(normalized.stack).toContain('outer failure')
    expect(normalized.cause).toMatchObject({
      message: 'inner failure',
      name: 'Error',
      stack: expect.stringContaining('inner failure'),
    })
    expect(normalized.raw.token).toBe('[redacted]')
    const metadata = normalized.raw.metadata as Record<string, unknown>
    expect(metadata.apiKey).toBe('[redacted]')
    expect(metadata.safe).toBe('visible')
  })

  it('normalizes thrown values and keeps circular raw data JSON-safe', () => {
    const thrownValue: Record<string, unknown> = {
      message: 'plain object failed',
      password: 'secret-password',
    }
    thrownValue.self = thrownValue

    const normalized = normalizeObservedError(thrownValue)

    expect(normalized.thrown).toBe('value')
    if (normalized.thrown !== 'value') throw new Error('expected value normalization')
    expect(normalized.summary).toMatchObject({ message: 'plain object failed' })
    const raw = normalized.raw as Record<string, unknown>
    expect(raw.password).toBe('[redacted]')
    expect(raw.self).toBe('[Circular]')
  })
})
