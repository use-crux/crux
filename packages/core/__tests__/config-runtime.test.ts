import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config'
import {
  configureObservability,
  currentObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  type CruxObservabilityTransport,
} from '../observability'
import type { CruxPlugin } from '../plugin'
import { getRuntime, resetRuntime, updateRuntime } from '../runtime'
import { inMemoryCruxStore } from '../store'
import { countTokens, defaultTokenizer, setTokenizer } from '../tokenizer'
import type { PromptMiddleware } from '../types'

describe('config — runtime domain mapping', () => {
  beforeEach(() => {
    resetRuntime()
    resetObservabilityRuntime()
    setTokenizer(defaultTokenizer)
  })

  afterEach(() => {
    resetRuntime()
    resetObservabilityRuntime()
    setTokenizer(defaultTokenizer)
  })

  it('does not install observability transport from config defaults', () => {
    const crux = config({})

    expect(getRuntime().observabilityTransport).toBeUndefined()
    expect(getRuntime().observabilityDelivery).toBeUndefined()
    expect(currentObservabilityTransport()).toBeUndefined()

    crux.dispose()
  })

  it('installs persistence.store before plugins run', () => {
    const store = inMemoryCruxStore()
    const seenStores: unknown[] = []
    const plugin: CruxPlugin = {
      name: 'store-aware-plugin',
      install(runtime) {
        seenStores.push(runtime.store)
        return {}
      },
    }

    const crux = config({
      persistence: { store },
      plugins: [plugin],
    })

    expect(seenStores).toEqual([store])
    expect(getRuntime().store).toBe(store)

    crux.dispose()
  })

  it('installs explicit observability transport before plugins run', () => {
    const transport: CruxObservabilityTransport = { send: vi.fn() }
    const seenTransports: Array<{ runtime: unknown; active: unknown }> = []
    const plugin: CruxPlugin = {
      name: 'transport-aware-plugin',
      install(runtime) {
        seenTransports.push({
          runtime: runtime.observabilityTransport,
          active: currentObservabilityTransport(),
        })
        return {}
      },
    }

    const crux = config({
      observability: { transport },
      plugins: [plugin],
    })

    expect(seenTransports).toEqual([{ runtime: transport, active: transport }])
    expect(getRuntime().observabilityTransport).toBe(transport)
    expect(currentObservabilityTransport()).toBe(transport)

    crux.dispose()
    expect(currentObservabilityTransport()).toBeUndefined()
  })

  it('installs explicit observability server URL and delivery before plugins run', () => {
    const seen: Array<{ runtimeTransport: unknown; activeTransport: unknown; delivery: unknown }> = []
    const delivery = { maxPendingDeliveries: 2 }
    const plugin: CruxPlugin = {
      name: 'observability-server-url-plugin',
      install(runtime) {
        seen.push({
          runtimeTransport: runtime.observabilityTransport,
          activeTransport: currentObservabilityTransport(),
          delivery: runtime.observabilityDelivery,
        })
        return {}
      },
    }

    const crux = config({
      observability: {
        serverUrl: 'https://collector.example.com',
        delivery,
      },
      plugins: [plugin],
    })

    expect(seen).toEqual([
      {
        runtimeTransport: expect.any(Object),
        activeTransport: expect.any(Object),
        delivery,
      },
    ])
    expect(getRuntime().observabilityTransport).toBeDefined()
    expect(getRuntime().observabilityDelivery).toBe(delivery)
    expect(currentObservabilityTransport()).toBeDefined()

    crux.dispose()
    expect(currentObservabilityTransport()).toBeUndefined()
  })

  it('passes observability token into the generated HTTP transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchImpl)
    const crux = config({
      observability: {
        serverUrl: 'https://collector.example.com',
        token: 'config-ingest-token',
      },
    })

    try {
      await observe.run({ name: 'config bearer run', rootPrimitive: 'custom.operation' }, async () => 'ok')
      await observe.flush()

      expect(fetchImpl).toHaveBeenCalled()
      expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer config-ingest-token',
      })
    } finally {
      crux.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('lets explicit observability override devtools before plugins run', () => {
    const transport: CruxObservabilityTransport = { send: vi.fn() }
    const seenTransports: Array<{ runtime: unknown; active: unknown }> = []
    const plugin: CruxPlugin = {
      name: 'explicit-observability-plugin',
      install(runtime) {
        seenTransports.push({
          runtime: runtime.observabilityTransport,
          active: currentObservabilityTransport(),
        })
        return {}
      },
    }

    const crux = config({
      devtools: { serverUrl: 'http://localhost:4400' },
      observability: { transport },
      plugins: [plugin],
    })

    expect(seenTransports).toEqual([{ runtime: transport, active: transport }])
    expect(getRuntime().observabilityTransport).toBe(transport)
    expect(currentObservabilityTransport()).toBe(transport)

    crux.dispose()
  })

  it('disables observability before plugins run', () => {
    const previousTransport: CruxObservabilityTransport = { send: vi.fn() }
    const restorePrevious = configureObservability({ transport: previousTransport })
    updateRuntime({ observabilityTransport: previousTransport })
    const seenTransports: Array<{ runtime: unknown; active: unknown }> = []
    const plugin: CruxPlugin = {
      name: 'observability-disabled-plugin',
      install(runtime) {
        seenTransports.push({
          runtime: runtime.observabilityTransport,
          active: currentObservabilityTransport(),
        })
        return {}
      },
    }

    try {
      const crux = config({
        devtools: { serverUrl: 'http://localhost:4400' },
        observability: { enabled: false },
        plugins: [plugin],
      })

      expect(seenTransports).toEqual([{ runtime: undefined, active: undefined }])
      expect(getRuntime().observabilityTransport).toBeUndefined()
      expect(currentObservabilityTransport()).toBeUndefined()

      crux.dispose()
      expect(currentObservabilityTransport()).toBe(previousTransport)
    } finally {
      restorePrevious()
    }
  })

  it('maps generation middleware and tokenizer into runtime setup', () => {
    const promptMiddleware: PromptMiddleware = async (args, next) => next(args)
    const crux = config({
      generation: {
        middleware: promptMiddleware,
        tokenizer: (text) => text.length,
      },
    })

    expect(getRuntime().middleware).toBe(promptMiddleware)
    expect(countTokens('abcde')).toBe(5)

    crux.dispose()
  })

  it('disables config side effects in CRUX_INDEX mode', () => {
    const previous = process.env.CRUX_INDEX
    process.env.CRUX_INDEX = '1'
    const install = vi.fn().mockReturnValue({})
    const previousStore = inMemoryCruxStore()
    const ignoredStore = inMemoryCruxStore()
    const previousMiddleware: PromptMiddleware = async (args, next) => next(args)
    const ignoredMiddleware: PromptMiddleware = async (args, next) => next(args)
    const transport: CruxObservabilityTransport = { send: vi.fn() }
    const previousTransport: CruxObservabilityTransport = { send: vi.fn() }
    const restorePrevious = configureObservability({ transport: previousTransport })
    setTokenizer((text) => text.length * 2)
    updateRuntime({
      store: previousStore,
      middleware: previousMiddleware,
      observabilityTransport: previousTransport,
    })

    try {
      const crux = config({
        persistence: { store: ignoredStore },
        generation: {
          middleware: ignoredMiddleware,
          tokenizer: (text) => text.length,
        },
        observability: { transport },
        devtools: { serverUrl: 'http://localhost:4400' },
        plugins: [{ name: 'side-effect-plugin', install }],
      })

      expect(install).not.toHaveBeenCalled()
      expect(getRuntime().store).toBe(previousStore)
      expect(getRuntime().middleware).toBe(previousMiddleware)
      expect(getRuntime().observabilityTransport).toBe(previousTransport)
      expect(currentObservabilityTransport()).toBe(previousTransport)
      expect(countTokens('abc')).toBe(6)

      crux.dispose()
      expect(getRuntime().store).toBe(previousStore)
      expect(currentObservabilityTransport()).toBe(previousTransport)
    } finally {
      restorePrevious()
      resetRuntime()
      resetObservabilityRuntime()
      setTokenizer(defaultTokenizer)
      if (previous === undefined) {
        delete process.env.CRUX_INDEX
      } else {
        process.env.CRUX_INDEX = previous
      }
    }
  })
})
