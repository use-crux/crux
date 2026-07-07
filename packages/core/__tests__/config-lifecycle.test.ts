import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableDevtools, resetObservabilityRuntime } from '../observability'
import { config } from '../runtime/config'
import type { ExecutionHookArgs } from '../runtime/middleware'
import type { CruxPlugin } from '../runtime/plugin'
import { getHooks, resetHooks } from '../runtime/runtime'
import type { PromptMiddleware, PromptMiddlewareArgs } from '../runtime/types'

describe('config lifecycle', () => {
  beforeEach(() => {
    resetHooks()
    resetObservabilityRuntime()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetHooks()
    resetObservabilityRuntime()
  })

  it('replaces repeated config installations instead of stacking plugin hooks', async () => {
    const events: string[] = []
    const first = config({ plugins: [lifecyclePlugin('one', events)] })
    const second = config({ plugins: [lifecyclePlugin('two', events)] })
    const third = config({ plugins: [lifecyclePlugin('three', events)] })

    try {
      await getHooks().middleware?.(middlewareArgs, async () => {
        events.push('middleware:next')
        return { text: 'ok' }
      })
      await getHooks().executionHook?.(executionArgs)

      expect(events).toEqual([
        'dispose:one',
        'dispose:two',
        'middleware:three',
        'middleware:next',
        'hook:three',
      ])
    } finally {
      third.dispose()
      second.dispose()
      first.dispose()
    }
  })

  it('keeps imperative devtools hooks intact when config is disposed', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })))
    const middleware: PromptMiddleware = async (args, next) => next(args)
    const crux = config({ generation: { middleware } })
    const cleanupDevtools = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })

    try {
      const transport = getHooks().observabilityTransport

      expect(getHooks().middleware).toBe(middleware)
      expect(transport).toBeDefined()

      crux.dispose()

      expect(getHooks().middleware).toBeUndefined()
      expect(getHooks().observabilityTransport).toBe(transport)
    } finally {
      cleanupDevtools()
      crux.dispose()
    }
  })
})

function lifecyclePlugin(name: string, events: string[]): CruxPlugin {
  return {
    name: `lifecycle-${name}`,
    install() {
      return {
        async middleware(args, next) {
          events.push(`middleware:${name}`)
          return next(args)
        },
        executionHook() {
          events.push(`hook:${name}`)
        },
        dispose() {
          events.push(`dispose:${name}`)
        },
      }
    },
  }
}

const middlewareArgs: PromptMiddlewareArgs = {
  promptId: undefined,
  preparedArgs: {},
}

const executionArgs: ExecutionHookArgs = {
  promptId: undefined,
  startedAt: 0,
  durationMs: 0,
  model: 'test-model',
  provider: 'test-provider',
}
