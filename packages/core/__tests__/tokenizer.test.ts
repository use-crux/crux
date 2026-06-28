import { describe, it, expect, afterEach } from 'vitest'
import { defaultTokenizer, setTokenizer, countTokens } from '../shared/tokenizer'

// Reset to default after each test to avoid state leakage
afterEach(() => {
  setTokenizer(defaultTokenizer)
})

describe('tokenizer', () => {
  it('default estimator: Math.ceil(text.length / 4)', () => {
    expect(defaultTokenizer('hello')).toBe(Math.ceil(5 / 4)) // 2
    expect(defaultTokenizer('')).toBe(0)
    expect(defaultTokenizer('a')).toBe(1)
    expect(defaultTokenizer('abcd')).toBe(1)
    expect(defaultTokenizer('abcde')).toBe(2)
  })

  it('countTokens uses the default tokenizer', () => {
    expect(countTokens('hello world')).toBe(Math.ceil(11 / 4)) // 3
  })

  it('setTokenizer swaps implementation', () => {
    setTokenizer((text) => text.split(' ').length)

    expect(countTokens('hello world')).toBe(2)
    expect(countTokens('one two three four')).toBe(4)
  })

  it('countTokens uses the swapped tokenizer', () => {
    const custom = (text: string) => text.length // 1 token per char
    setTokenizer(custom)

    expect(countTokens('abc')).toBe(3)
  })
})
