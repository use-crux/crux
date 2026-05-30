import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetRuntime, getRuntime } from '../runtime'
import { withDevtools, enableDevtools } from '../observability'
import { configure } from '../configure'
import { prompt as cruxPrompt } from '../define'
import { observe, resetObservabilityRuntime } from '../observability'
import type { CruxPlugin } from '../plugin'

function makePrompt(id: string) {
  return cruxPrompt({ id, system: `Prompt ${id}` })
}

describe('withDevtools — CruxPlugin', () => {
  beforeEach(() => {
    resetRuntime()
    resetObservabilityRuntime()
  })

  afterEach(() => {
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

  it('install() configures the canonical observability transport only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const plugin = withDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })

    const result = plugin.install(getRuntime())

    expect(result.middleware).toBeUndefined()
    expect(result.resolveHook).toBeUndefined()
    expect(result.executionHook).toBeUndefined()
    expect(result.streamProgressHook).toBeUndefined()
    expect(result.streamStartHook).toBeUndefined()
    expect(result.instrumentationHooks).toBeUndefined()
    expect(result.evalReporter).toBeUndefined()
    expect(result.flowEvalReporter).toBeUndefined()
    expect(result.observabilityTransport).toBeDefined()
    expect(result.dispose).toBeDefined()
    expect(typeof result.dispose).toBe('function')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4400/api/catalog/snapshot',
      expect.objectContaining({ method: 'POST' }),
    )
    fetchMock.mockClear()

    await observe.run({ name: 'devtools-test', rootPrimitive: 'custom.operation' }, async () => undefined)
    await observe.flush()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4400/api/observability/records',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('install() registers the catalog through the canonical catalog endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const plugin = withDevtools({
      prompts: [makePrompt('catalog-prompt')],
      serverUrl: 'http://localhost:4400',
    })

    plugin.install(getRuntime())
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4400/api/catalog/snapshot',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('catalog-prompt'),
      }),
    )
  })

  it('configure() auto-prepends devtools plugin when serverUrl is set', () => {
    const reg = configure({
      prompts: [makePrompt('a')],
      devtools: { serverUrl: 'http://localhost:4400' },
    })

    // Devtools configures canonical graph delivery without installing legacy collector hooks.
    const rt = getRuntime()
    expect(rt.middleware).toBeUndefined()
    expect(rt.instrumentationHooks).toBeUndefined()
    expect(rt.observabilityTransport).toBeDefined()

    reg.dispose()
  })

  it('enableDevtools() still works for imperative use', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const cleanup = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })

    const rt = getRuntime()
    expect(rt.middleware).toBeUndefined()
    expect(rt.observabilityTransport).toBeDefined()

    cleanup()
    expect(getRuntime().observabilityTransport).toBeUndefined()
    fetchMock.mockClear()

    await observe.run({ name: 'after-cleanup', rootPrimitive: 'custom.operation' }, async () => undefined)
    await observe.flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not duplicate canonical records through legacy instrumentation hooks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const plugin = withDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })
    const result = plugin.install(getRuntime())
    fetchMock.mockClear()

    expect(result.instrumentationHooks).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
