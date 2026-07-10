import { describe, it, expect } from 'vitest'
import { router, isRouter } from '../../routing'

describe('router()', () => {
  it('creates a RouterModel with correct _tag and config', () => {
    const r = router({
      classify: ({ input }: { input: { size: number }; context: object }) =>
        input.size > 1000 ? 'big' : 'small',
      routes: {
        big: 'model-big',
        small: 'model-small',
        default: 'model-small',
      },
    })

    expect(r._tag).toBe('crux.router')
    expect(r.config.routes).toEqual({
      big: 'model-big',
      small: 'model-small',
      default: 'model-small',
    })
  })

    it('returns a frozen immutable object', () => {
    const r = router({
      classify: () => 'default',
      routes: { default: 'model-a' },
    })

    expect(Object.isFrozen(r)).toBe(true)
  })
})

describe('isRouter()', () => {
  it('returns true for a RouterModel', () => {
    const r = router({
      classify: () => 'default',
      routes: { default: 'model-a' },
    })
    expect(isRouter(r)).toBe(true)
  })

    it('returns false for regular objects', () => {
    expect(isRouter({ provider: 'openai', modelId: 'gpt-4o' })).toBe(false)
  })

    it('returns false for null/undefined/strings', () => {
    expect(isRouter(null)).toBe(false)
    expect(isRouter(undefined)).toBe(false)
    expect(isRouter('gpt-4o')).toBe(false)
  })
})
