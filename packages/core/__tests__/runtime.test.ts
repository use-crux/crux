import { beforeEach, describe, expect, it } from 'vitest'
import type { PromptMiddleware } from '../src/runtime/types'
import {
  getHooks,
  pushHooksLayer,
  resetHooks,
  restoreHooksLayer,
  setHooks,
  updateHooks,
  type CruxHooks,
} from '../src/runtime/runtime'

describe('CruxHooks', () => {
  beforeEach(() => {
    resetHooks()
  })

  describe('getHooks', () => {
    it('returns empty object initially', () => {
      expect(getHooks()).toEqual({})
    })

    it('returns a frozen object', () => {
      expect(Object.isFrozen(getHooks())).toBe(true)
    })
  })

  describe('setHooks', () => {
    it('replaces the entire runtime', () => {
      const middleware: PromptMiddleware = async (args, next) => next(args)

      setHooks({ middleware })

      expect(getHooks().middleware).toBe(middleware)
    })

    it('does not share reference with the passed object', () => {
      const input: CruxHooks = {}

      setHooks(input)
      input.middleware = async (args, next) => next(args)

      expect(getHooks().middleware).toBeUndefined()
    })
  })

  describe('updateHooks', () => {
    it('can set a field to undefined to clear it', () => {
      const middleware: PromptMiddleware = async (args, next) => next(args)

      setHooks({ middleware })
      updateHooks({ middleware: undefined })

      expect(getHooks().middleware).toBeUndefined()
    })
  })

  describe('hook layers', () => {
    it('restores only the keys captured by the layer token', () => {
      const middleware: PromptMiddleware = async (args, next) => next(args)
      const executionHook: NonNullable<CruxHooks['executionHook']> = () => undefined

      const middlewareToken = pushHooksLayer({ middleware })
      const hookToken = pushHooksLayer({ executionHook })

      restoreHooksLayer(middlewareToken)

      expect(getHooks().middleware).toBeUndefined()
      expect(getHooks().executionHook).toBe(executionHook)

      restoreHooksLayer(hookToken)
      expect(getHooks()).toEqual({})
    })
  })
})
