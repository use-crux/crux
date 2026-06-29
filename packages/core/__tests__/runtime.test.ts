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

    it('does not share reference with the passed object', () => {
      const input: CruxRuntime = {}
      setRuntime(input)
      ;(input as any).middleware = 'injected'
      expect(getRuntime().middleware).toBeUndefined()
    })
  })

describe('updateRuntime', () => {    it('can set a field to undefined to clear it', () => {
      const middleware = async (args: any, next: any) => next(args)
      setRuntime({ middleware })
      updateRuntime({ middleware: undefined })
      expect(getRuntime().middleware).toBeUndefined()
    })
  })})
