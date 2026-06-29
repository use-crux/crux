import { describe, expect, it } from 'vitest'
import { ulid } from '../../quality/internal/ulid'
import { applyRedaction, truncateOutput, OUTPUT_TRUNCATION_LIMIT } from '../../quality/internal/redact'

describe('ulid()', () => {
  it('produces 26-char Crockford base32 ids', () => {
    const id = ulid()
    expect(id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
  })

    it('is monotonically sortable by creation time', () => {
    const a = ulid(1_000_000)
    const b = ulid(2_000_000)
    expect(a < b).toBe(true)
  })

    it('never collides across same-millisecond calls', () => {
    const seen = new Set(Array.from({ length: 200 }, () => ulid(42)))
    expect(seen.size).toBe(200)
  })
})

describe('applyRedaction()', () => {
  it('redacts configured dot-paths', () => {
    const value = { user: { email: 'a@b.c' }, keep: 1 }
    expect(applyRedaction(value, ['user.email'])).toEqual({ user: { email: '[redacted]' }, keep: 1 })
  })

    it('applies always-on defaults for authorization headers and api keys at any depth', () => {
    const value = {
      headers: { Authorization: 'Bearer xyz' },
      nested: { apiKey: 'k', api_key: 'k2', 'x-api-key': 'k3' },
      token: 'should stay - token alone is not an always-on default',
    }
    const redacted = applyRedaction(value, []) as typeof value
    expect(redacted.headers.Authorization).toBe('[redacted]')
    expect(redacted.nested.apiKey).toBe('[redacted]')
    expect(redacted.nested.api_key).toBe('[redacted]')
    expect(redacted.nested['x-api-key']).toBe('[redacted]')
  })

    it('does not mutate the input and passes primitives through', () => {
    const value = { a: { apiKey: 'k' } }
    applyRedaction(value, [])
    expect(value.a.apiKey).toBe('k')
    expect(applyRedaction('text', [])).toBe('text')
    expect(applyRedaction(7, [])).toBe(7)
  })

    it('redacts dot-paths through arrays', () => {
    const value = { items: [{ secretValue: 1, keep: 2 }] }
    expect(applyRedaction(value, ['items.secretValue'])).toEqual({
      items: [{ secretValue: '[redacted]', keep: 2 }],
    })
  })
})

describe('truncateOutput()', () => {
  it('passes small outputs through untouched', () => {
    expect(truncateOutput({ a: 1 })).toEqual({ value: { a: 1 }, truncated: false })
    expect(truncateOutput('short')).toEqual({ value: 'short', truncated: false })
  })

    it('truncates oversized string outputs at the 32 KiB limit with a marker', () => {
    const big = 'x'.repeat(OUTPUT_TRUNCATION_LIMIT + 1000)
    const result = truncateOutput(big)
    expect(result.truncated).toBe(true)
    const text = result.value as string
    expect(text.endsWith('…[truncated]')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(OUTPUT_TRUNCATION_LIMIT + '…[truncated]'.length)
  })

    it('truncates oversized structured outputs via their JSON rendering', () => {
    const big = { text: 'y'.repeat(OUTPUT_TRUNCATION_LIMIT + 1000) }
    const result = truncateOutput(big)
    expect(result.truncated).toBe(true)
    expect(typeof result.value).toBe('string')
    expect((result.value as string).endsWith('…[truncated]')).toBe(true)
  })
})
