import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetHooks } from '../runtime/runtime'
import type { CruxHooks } from '../runtime/runtime'
import { mergeHooks, applyPlugins } from '../runtime/plugin'
import type { CruxPlugin } from '../runtime/plugin'

describe('CruxPlugin system', () => {
  beforeEach(() => {
    resetHooks()
  })

  // ─────────────────────────────────────────────────────────────
  // mergeHooks
  // ─────────────────────────────────────────────────────────────

  describe('mergeHooks', () => {
    it('returns union when base and patch have no overlapping fields', () => {
      const middleware = vi.fn()
      const streamStartHook = vi.fn()
      const base: CruxHooks = { middleware: middleware as any }
      const patch: Partial<CruxHooks> = { streamStartHook }

      const merged = mergeHooks(base, patch)

      expect(merged.middleware).toBe(middleware)
      expect(merged.streamStartHook).toBe(streamStartHook)
    })

    it('fan-outs executionHook — both handlers called', async () => {
      const hook1 = vi.fn()
      const hook2 = vi.fn()
      const base: CruxHooks = { executionHook: hook1 }
      const patch: Partial<CruxHooks> = { executionHook: hook2 }

      const merged = mergeHooks(base, patch)
      const args = {
        promptId: 'test',
        startedAt: Date.now(),
        durationMs: 100,
        model: 'gpt-4',
        provider: 'openai',
      }
      await merged.executionHook!(args)

      expect(hook1).toHaveBeenCalledWith(args)
      expect(hook2).toHaveBeenCalledWith(args)
    })

    it('fan-outs resolveHook — both handlers called', async () => {
      const hook1 = vi.fn().mockResolvedValue({ traceId: 'trace-1' })
      const hook2 = vi.fn().mockResolvedValue({ traceId: 'trace-2' })
      const base: CruxHooks = { resolveHook: hook1 }
      const patch: Partial<CruxHooks> = { resolveHook: hook2 }

      const merged = mergeHooks(base, patch)
      const args = { promptId: 'test', input: {}, inspect: {} as any }
      const result = await merged.resolveHook!(args)

      expect(hook1).toHaveBeenCalledWith(args)
      expect(hook2).toHaveBeenCalledWith(args)
      // Last writer's result wins for resolve hooks (traceId propagation)
      expect(result).toEqual({ traceId: 'trace-2' })
    })

    it('fan-outs streamStartHook — both handlers called', async () => {
      const hook1 = vi.fn()
      const hook2 = vi.fn()
      const base: CruxHooks = { streamStartHook: hook1 }
      const patch: Partial<CruxHooks> = { streamStartHook: hook2 }

      const merged = mergeHooks(base, patch)
      const args = {
        traceId: 't',
        promptId: 'p',
        startedAt: 0,
        model: 'm',
        provider: 'pr',
      }
      await merged.streamStartHook!(args)

      expect(hook1).toHaveBeenCalledWith(args)
      expect(hook2).toHaveBeenCalledWith(args)
    })

    it('fan-outs streamProgressHook — both reporters receive chunks', () => {
      const reporter1 = { onChunk: vi.fn(), flush: vi.fn(), dispose: vi.fn() }
      const reporter2 = { onChunk: vi.fn(), flush: vi.fn(), dispose: vi.fn() }
      const hook1 = vi.fn().mockReturnValue(reporter1)
      const hook2 = vi.fn().mockReturnValue(reporter2)
      const base: CruxHooks = { streamProgressHook: hook1 }
      const patch: Partial<CruxHooks> = { streamProgressHook: hook2 }

      const merged = mergeHooks(base, patch)
      const combined = merged.streamProgressHook!('trace-1')

      combined!.onChunk('hello')
      expect(reporter1.onChunk).toHaveBeenCalledWith('hello')
      expect(reporter2.onChunk).toHaveBeenCalledWith('hello')
    })

    it('chains middleware — new wraps old (layered)', async () => {
      const order: string[] = []
      const oldMiddleware = vi.fn(async (args: any, next: any) => {
        order.push('old-before')
        const result = await next(args)
        order.push('old-after')
        return result
      })
      const newMiddleware = vi.fn(async (args: any, next: any) => {
        order.push('new-before')
        const result = await next(args)
        order.push('new-after')
        return result
      })
      const base: CruxHooks = { middleware: oldMiddleware }
      const patch: Partial<CruxHooks> = { middleware: newMiddleware }

      const merged = mergeHooks(base, patch)
      const mockNext = vi.fn(async () => 'result')
      await merged.middleware!({} as any, mockNext)

      expect(order).toEqual(['new-before', 'old-before', 'old-after', 'new-after'])
    })

    it('uses patch middleware directly when base has none', async () => {
      const patchMiddleware = vi.fn(async (args: any, next: any) => next(args))
      const base: CruxHooks = {}
      const patch: Partial<CruxHooks> = { middleware: patchMiddleware }

      const merged = mergeHooks(base, patch)
      expect(merged.middleware).toBe(patchMiddleware)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // applyPlugins
  // ─────────────────────────────────────────────────────────────

  describe('applyPlugins', () => {
    it('processes plugins in order, each seeing cumulative state', () => {
      const seenHooks: CruxHooks[] = []
      const hook1 = vi.fn()
      const hook2 = vi.fn()

      const plugin1: CruxPlugin = {
        name: 'plugin-1',
        install(hooks) {
          seenHooks.push({ ...hooks })
          return { executionHook: hook1 }
        },
      }
      const plugin2: CruxPlugin = {
        name: 'plugin-2',
        install(hooks) {
          seenHooks.push({ ...hooks })
          return { streamStartHook: hook2 }
        },
      }

      const result = applyPlugins([plugin1, plugin2], {})

      // plugin-1 sees empty hooks
      expect(seenHooks[0].executionHook).toBeUndefined()
      // plugin-2 sees plugin-1's hook
      expect(seenHooks[1].executionHook).toBeDefined()
      // Final hooks have both
      expect(result.hooks.executionHook).toBeDefined()
      expect(result.hooks.streamStartHook).toBeDefined()
    })

    it('returns dispose functions from all plugins', () => {
      const dispose1 = vi.fn()
      const dispose2 = vi.fn()

      const plugin1: CruxPlugin = {
        name: 'plugin-1',
        install: () => ({ dispose: dispose1 }),
      }
      const plugin2: CruxPlugin = {
        name: 'plugin-2',
        install: () => ({ dispose: dispose2 }),
      }

      const result = applyPlugins([plugin1, plugin2], {})
      result.dispose()

      // Dispose called in reverse order
      expect(dispose2).toHaveBeenCalled()
      expect(dispose1).toHaveBeenCalled()
      const order = [dispose2.mock.invocationCallOrder[0], dispose1.mock.invocationCallOrder[0]]
      expect(order[0]).toBeLessThan(order[1])
    })

    it('returns initial hooks when plugins array is empty', () => {
      const initial: CruxHooks = { observabilityDelivery: { timeoutMs: 100 } }
      const result = applyPlugins([], initial)
      expect(result.hooks).toEqual(initial)
    })

    it('dispose is a no-op when no plugins have dispose', () => {
      const plugin: CruxPlugin = {
        name: 'no-dispose',
        install: () => ({}),
      }
      const result = applyPlugins([plugin], {})
      expect(() => result.dispose()).not.toThrow()
    })
  })
})
