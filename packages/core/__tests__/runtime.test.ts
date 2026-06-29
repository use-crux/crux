import { describe, it, expect, beforeEach } from 'vitest'
import { getRuntime, setRuntime, updateRuntime, resetRuntime, type CruxRuntime } from '../runtime/runtime'

describe('CruxRuntime', () => {
  beforeEach(() => {
    resetRuntime()
  })

  describe('getRuntime', () => {
    it('returns empty object initially', () => {
      const rt = getRuntime()
      expect(rt).toEqual({})
    })

    it('returns a frozen object', () => {
      const rt = getRuntime()
      expect(Object.isFrozen(rt)).toBe(true)
    })
  })

  describe('setRuntime', () => {
    it('replaces the entire runtime', () => {
      const middleware = async (args: any, next: any) => next(args)
      setRuntime({ middleware })
      expect(getRuntime().middleware).toBe(middleware)
    })

    it('clears fields not present in the new runtime', () => {
      const middleware = async (args: any, next: any) => next(args)
      setRuntime({ middleware, instrumentationHooks: {} })
      setRuntime({ middleware })
      expect(getRuntime().instrumentationHooks).toBeUndefined()
    })

    it('does not share reference with the passed object', () => {
      const input: CruxRuntime = {}
      setRuntime(input)
      ;(input as any).middleware = 'injected'
      expect(getRuntime().middleware).toBeUndefined()
    })
  })

  describe('updateRuntime', () => {
    it('merges partial fields into existing runtime', () => {
      const middleware = async (args: any, next: any) => next(args)
      const instrumentationHooks = {}
      setRuntime({ middleware })
      updateRuntime({ instrumentationHooks })
      const rt = getRuntime()
      expect(rt.middleware).toBe(middleware)
      expect(rt.instrumentationHooks).toBe(instrumentationHooks)
    })

    it('preserves unmentioned fields', () => {
      const middleware = async (args: any, next: any) => next(args)
      setRuntime({ middleware })
      updateRuntime({ instrumentationHooks: {} })
      expect(getRuntime().middleware).toBe(middleware)
    })

    it('can set a field to undefined to clear it', () => {
      const middleware = async (args: any, next: any) => next(args)
      setRuntime({ middleware })
      updateRuntime({ middleware: undefined })
      expect(getRuntime().middleware).toBeUndefined()
    })
  })

  describe('resetRuntime', () => {
    it('clears all fields', () => {
      setRuntime({
        middleware: async (args: any, next: any) => next(args),
        instrumentationHooks: {},
      })
      resetRuntime()
      expect(getRuntime()).toEqual({})
    })
  })
})
