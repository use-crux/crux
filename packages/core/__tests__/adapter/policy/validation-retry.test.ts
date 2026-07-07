/**
 * Tests for `adapter/policy/validation-retry` — shared structured-output
 * validation policy used by both `adapter()` and `loopRuntimeAdapter()`.
 *
 * Boundary tests: assert on observable validation outcomes, not internals.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validateStructuredOutput, formatValidationFeedback } from '../../../adapter/policy/validation-retry'

const schema = z.object({ title: z.string(), count: z.number() })

describe('validateStructuredOutput', () => {
  it('accepts valid JSON matching the schema', () => {
    const result = validateStructuredOutput('{"title":"hi","count":2}', schema)
    expect(result.valid).toBe(true)
    expect(result.repairedText).toBe('{"title":"hi","count":2}')
    expect(result.error).toBeUndefined()
  })

    it('repairs markdown-fenced JSON before validating', () => {
    const fenced = '```json\n{"title":"hi","count":2}\n```'
    const result = validateStructuredOutput(fenced, schema)
    expect(result.valid).toBe(true)
    expect(JSON.parse(result.repairedText)).toEqual({ title: 'hi', count: 2 })
  })

    it('reports unparseable output as a synthetic ZodError', () => {
    const result = validateStructuredOutput('not json at all', schema)
    expect(result.valid).toBe(false)
    expect(result.error).toBeInstanceOf(z.ZodError)
    expect(result.error?.issues[0]?.message).toContain('Invalid JSON')
  })

    it('reports schema mismatches with issue paths', () => {
    const result = validateStructuredOutput('{"title":"hi","count":"two"}', schema)
    expect(result.valid).toBe(false)
    expect(result.error?.issues.some((issue) => issue.path.includes('count'))).toBe(true)
  })
})

describe('formatValidationFeedback', () => {
  it('includes each issue path without leaking the failed raw output', () => {
    const parsed = schema.safeParse({ title: 1, count: 'two' })
    if (parsed.success) throw new Error('expected validation failure')

    const failedOutput = '{"title":1,"count":"two","apiKey":"sk-live-secret"}'
    const feedback = formatValidationFeedback(failedOutput, parsed.error)

    expect(feedback).not.toContain(failedOutput)
    expect(feedback).not.toContain('sk-live-secret')
    expect(feedback).toContain('[redacted-secret]')
    expect(feedback).toContain('at "title"')
    expect(feedback).toContain('at "count"')
    expect(feedback).toContain('Validation failed')
  })

  it('does not leak raw text from JSON parse errors', () => {
    const failedOutput = 'not json sk-live-secret private@example.com'
    const result = validateStructuredOutput(failedOutput, schema)
    if (result.valid || !result.error) throw new Error('expected validation failure')

    const feedback = formatValidationFeedback(failedOutput, result.error)

    expect(feedback).not.toContain('sk-live-secret')
    expect(feedback).not.toContain('private@example.com')
    expect(feedback).toContain('[redacted-secret]')
    expect(feedback).toContain('[redacted-email]')
    expect(feedback).toContain('Invalid JSON')
  })
})
