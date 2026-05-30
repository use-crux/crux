import { describe, it, expect, afterEach } from 'vitest'
import { getRuntime, updateRuntime, resetRuntime } from '../runtime'

// Clean up all global state after each test
afterEach(() => {
  resetRuntime()
})

describe('updateRuntime / getRuntime — middleware', () => {
  it('initially returns undefined', () => {
    expect(getRuntime().middleware).toBeUndefined()
  })

  it('set and get middleware', () => {
    const mw = async (args: any, next: any) => next(args)
    updateRuntime({ middleware: mw })
    expect(getRuntime().middleware).toBe(mw)
  })

  it('clear with undefined', () => {
    updateRuntime({ middleware: async (args, next) => next(args) })
    updateRuntime({ middleware: undefined })
    expect(getRuntime().middleware).toBeUndefined()
  })
})

describe('updateRuntime / getRuntime — resolveHook', () => {
  it('initially returns undefined', () => {
    expect(getRuntime().resolveHook).toBeUndefined()
  })

  it('set and get hook', () => {
    const hook = () => {}
    updateRuntime({ resolveHook: hook })
    expect(getRuntime().resolveHook).toBe(hook)
  })

  it('clear with undefined', () => {
    updateRuntime({ resolveHook: () => {} })
    updateRuntime({ resolveHook: undefined })
    expect(getRuntime().resolveHook).toBeUndefined()
  })
})

describe('updateRuntime / getRuntime — executionHook', () => {
  it('initially returns undefined', () => {
    expect(getRuntime().executionHook).toBeUndefined()
  })

  it('set and get hook', () => {
    const hook = () => {}
    updateRuntime({ executionHook: hook })
    expect(getRuntime().executionHook).toBe(hook)
  })

  it('clear with undefined', () => {
    updateRuntime({ executionHook: () => {} })
    updateRuntime({ executionHook: undefined })
    expect(getRuntime().executionHook).toBeUndefined()
  })
})
