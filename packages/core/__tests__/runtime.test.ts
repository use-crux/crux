import { beforeEach, describe, expect, it } from 'vitest'
import type { PromptMiddleware } from '../runtime/types'
import {
  getRuntime,
  pushHooksLayer,
  resetRuntime,
  restoreHooksLayer,
  setRuntime,
  updateRuntime,
  type CruxRuntime,
} from '../runtime/runtime'

describe('CruxRuntime', () => {
  beforeEach(() => {
    resetRuntime()
  })

  describe('getRuntime', () => {
    it('returns empty object initially', () => {
      expect(getRuntime()).toEqual({})
    })

    it('returns a frozen object', () => {
      expect(Object.isFrozen(getRuntime())).toBe(true)
    })
  })

  describe('setRuntime', () => {
    it('replaces the entire runtime', () => {
      const middleware: PromptMiddleware = async (args, next) => next(args)

      setRuntime({ middleware })

      expect(getRuntime().middleware).toBe(middleware)
    })

    it('does not share reference with the passed object', () => {
      const input: CruxRuntime = {}

      setRuntime(input)
      input.middleware = async (args, next) => next(args)

      expect(getRuntime().middleware).toBeUndefined()
    })
  })

  describe('updateRuntime', () => {
    it('can set a field to undefined to clear it', () => {
      const middleware: PromptMiddleware = async (args, next) => next(args)

      setRuntime({ middleware })
      updateRuntime({ middleware: undefined })

      expect(getRuntime().middleware).toBeUndefined()
    })
  })

  describe('hook layers', () => {
    it('restores only the keys captured by the layer token', () => {
      const middleware: PromptMiddleware = async (args, next) => next(args)
      const executionHook: NonNullable<CruxRuntime['executionHook']> = () => undefined

      const middlewareToken = pushHooksLayer({ middleware })
      const hookToken = pushHooksLayer({ executionHook })

      restoreHooksLayer(middlewareToken)

      expect(getRuntime().middleware).toBeUndefined()
      expect(getRuntime().executionHook).toBe(executionHook)

      restoreHooksLayer(hookToken)
      expect(getRuntime()).toEqual({})
    })
  })
})
