import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetHooks, getHooks } from '../src/runtime/runtime'
import { withDevtools, enableDevtools } from '../src/observability'
import { configure } from '../src/runtime/configure'
import { prompt as cruxPrompt } from '../src/prompt/prompt'
import { observe, resetObservabilityRuntime } from '../src/observability'
import type { CruxPlugin } from '../src/runtime/plugin'

function makePrompt(id: string) {
  return cruxPrompt({ id, system: `Prompt ${id}` })
}

describe('withDevtools — CruxPlugin', () => {
  beforeEach(() => {
    resetHooks()
    resetObservabilityRuntime()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetObservabilityRuntime()
  })

  it('returns a CruxPlugin with name crux:devtools', () => {
    const plugin = withDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })

    expect(plugin.name).toBe('crux:devtools')
    expect(typeof plugin.install).toBe('function')
  })

  it('install() registers the index through the canonical index endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const plugin = withDevtools({
      prompts: [makePrompt('index-prompt')],
      serverUrl: 'http://localhost:4400',
    })

    plugin.install(getHooks())
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4400/api/index/snapshot',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('index-prompt'),
      }),
    )
  })

  it('enableDevtools() still works for imperative use', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const cleanup = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })

    const rt = getHooks()
    expect(rt.middleware).toBeUndefined()
    expect(rt.observabilityTransport).toBeDefined()

    cleanup()
    expect(getHooks().observabilityTransport).toBeUndefined()
    fetchMock.mockClear()

    await observe.run({ name: 'after-cleanup', rootPrimitive: 'custom.operation' }, async () => undefined)
    await observe.flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores imperative devtools installs by cleanup token', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })))

    const cleanupFirst = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })
    const firstTransport = getHooks().observabilityTransport

    const cleanupSecond = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4401',
    })
    const secondTransport = getHooks().observabilityTransport

    expect(firstTransport).toBeDefined()
    expect(secondTransport).toBeDefined()
    expect(secondTransport).not.toBe(firstTransport)

    cleanupSecond()
    expect(getHooks().observabilityTransport).toBe(firstTransport)

    cleanupFirst()
    expect(getHooks().observabilityTransport).toBeUndefined()
  })

  it('passes the devtools sessionId through as an observability default correlator', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const cleanup = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
      sessionId: 'dev-session',
    })

    await observe.run({ name: 'devtools session', rootPrimitive: 'custom.operation' }, async () => undefined)
    await observe.flush()
    cleanup()

    const recordsCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/observability/records'))
    expect(recordsCall).toBeDefined()
    const body = JSON.parse(String(recordsCall?.[1]?.body)) as { records: Array<{ sessionId?: string }> }
    expect(body.records).not.toHaveLength(0)
    expect(body.records.every((record) => record.sessionId === 'dev-session')).toBe(true)
  })

  it('flushes pending observability records before devtools restore', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const flushSpy = vi.spyOn(observe, 'flush')

    const cleanup = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })

    cleanup()

    expect(flushSpy).toHaveBeenCalledWith({ timeoutMs: 2000 })
  })
})
