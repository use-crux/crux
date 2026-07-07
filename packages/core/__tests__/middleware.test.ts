import { describe, it, expect, afterEach } from 'vitest'
import { getHooks, updateHooks, resetHooks } from '../runtime/runtime'

// Clean up all global state after each test
afterEach(() => {
  resetHooks()
})

describe('updateHooks / getHooks — middleware', () => {
  it('initially returns undefined', () => {
    expect(getHooks().middleware).toBeUndefined()
  })

    it('set and get middleware', () => {
    const mw = async (args: any, next: any) => next(args)
    updateHooks({ middleware: mw })
    expect(getHooks().middleware).toBe(mw)
  })

    it('clear with undefined', () => {
    updateHooks({ middleware: async (args, next) => next(args) })
    updateHooks({ middleware: undefined })
    expect(getHooks().middleware).toBeUndefined()
  })
})

describe('updateHooks / getHooks — resolveHook', () => {
  it('initially returns undefined', () => {
    expect(getHooks().resolveHook).toBeUndefined()
  })

    it('set and get hook', () => {
    const hook = () => {}
    updateHooks({ resolveHook: hook })
    expect(getHooks().resolveHook).toBe(hook)
  })

    it('clear with undefined', () => {
    updateHooks({ resolveHook: () => {} })
    updateHooks({ resolveHook: undefined })
    expect(getHooks().resolveHook).toBeUndefined()
  })
})

describe('updateHooks / getHooks — executionHook', () => {
  it('initially returns undefined', () => {
    expect(getHooks().executionHook).toBeUndefined()
  })

    it('set and get hook', () => {
    const hook = () => {}
    updateHooks({ executionHook: hook })
    expect(getHooks().executionHook).toBe(hook)
  })

    it('clear with undefined', () => {
    updateHooks({ executionHook: () => {} })
    updateHooks({ executionHook: undefined })
    expect(getHooks().executionHook).toBeUndefined()
  })
})
