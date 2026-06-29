import { describe, it, expect, vi } from 'vitest'
import { router, isRouter } from '../../routing'

describe('router()', () => {
  it('creates a RouterModel with correct _tag and config', () => {
    const r = router({
      classify: (input) => (input.size > 1000 ? 'big' : 'small'),
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

describe('.select()', () => {
  it('creates a new RouterModel with forced route', () => {
    const r = router({
      classify: () => 'a',
      routes: { a: 'model-a', b: 'model-b', default: 'model-a' },
    })

    const selected = r.select('b')

    expect(selected._tag).toBe('crux.router')
    expect(selected._forcedRoute).toBe('b')
    expect(selected).not.toBe(r) // new instance
  })

    it('returns a frozen instance', () => {
    const r = router({
      classify: () => 'default',
      routes: { default: 'model-a' },
    })

    expect(Object.isFrozen(r.select('default'))).toBe(true)
  })
})

describe('.with()', () => {
  it('creates a new RouterModel with hints', () => {
    const r = router({
      classify: (_input, _hints?: { cheap?: boolean }) => 'default',
      routes: { default: 'model-a' },
    })

    const hinted = r.with({ cheap: true })

    expect(hinted._tag).toBe('crux.router')
    expect(hinted._hints).toEqual({ cheap: true })
    expect(hinted).not.toBe(r)
  })

    it('preserves forced route when adding hints', () => {
    const r = router({
      classify: (_input, _hints?: { fast?: boolean }) => 'default',
      routes: { x: 'model-x', default: 'model-a' },
    })

    const both = r.select('x').with({ fast: true })

    expect(both._forcedRoute).toBe('x')
    expect(both._hints).toEqual({ fast: true })
  })
})
