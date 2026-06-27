import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetRuntime, getRuntime, prompt as cruxPrompt } from '@use-crux/core'
import { configure } from '../../core/configure'
import { withTelemetry } from '../index'
import { createCallbackExporter, createUrlExporter } from '../exporter'
import type { TraceSpan } from '../types'

function makePrompt(id: string) {
  return cruxPrompt({ id, system: `Prompt ${id}` })
}

function makeSpan(overrides?: Partial<TraceSpan>): TraceSpan {
  return {
    spanId: 's1',
    traceId: 't1',
    name: 'crux.generate',
    startTime: 1000,
    endTime: 1100,
    durationMs: 100,
    attributes: {},
    status: { code: 'OK' },
    ...overrides,
  }
}

describe('withTelemetry', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('returns a CruxPlugin with name crux:otel', () => {
    const plugin = withTelemetry()

    expect(plugin.name).toBe('crux:otel')
    expect(typeof plugin.install).toBe('function')
  })

  it('installs via configure() without errors', () => {
    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [withTelemetry({ serviceName: 'test-app' })],
    })

    expect(reg.get('a')).toBeDefined()
    reg.dispose()
  })

  it('can coexist with other plugins', () => {
    const hook = vi.fn()
    const otherPlugin = {
      name: 'other',
      install: () => ({ instrumentationHooks: { onToolStart: hook } }),
    }

    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [withTelemetry(), otherPlugin],
    })

    // Other plugin's hook should still work
    getRuntime().instrumentationHooks?.onToolStart?.({
      toolCallId: 'tc1',
      toolName: 'test',
      args: {},
    })
    expect(hook).toHaveBeenCalled()

    reg.dispose()
  })

})

describe('createCallbackExporter', () => {
  it('delivers spans to the callback', async () => {
    const received: TraceSpan[] = []
    const exporter = createCallbackExporter((spans) => {
      received.push(...spans)
    })

    const span = makeSpan()
    await exporter.export([span])

    expect(received).toHaveLength(1)
    expect(received[0].name).toBe('crux.generate')
  })

  it('ignores empty batches', async () => {
    const callback = vi.fn()
    const exporter = createCallbackExporter(callback)

    await exporter.export([])

    expect(callback).not.toHaveBeenCalled()
  })

  it('silently ignores callback errors', async () => {
    const exporter = createCallbackExporter(() => {
      throw new Error('callback failed')
    })

    // Should not throw
    await expect(exporter.export([makeSpan()])).resolves.toBeUndefined()
  })

  it('stops exporting after shutdown', async () => {
    const callback = vi.fn()
    const exporter = createCallbackExporter(callback)

    await exporter.shutdown()
    await exporter.export([makeSpan()])

    expect(callback).not.toHaveBeenCalled()
  })
})

describe('createUrlExporter', () => {
  it('POSTs spans as JSON to the configured URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

    const exporter = createUrlExporter({
      url: 'https://collector.example.com/v1/traces',
      headers: { 'X-Api-Key': 'test-key' },
    })

    const span = makeSpan()
    await exporter.export([span])

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://collector.example.com/v1/traces',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Api-Key': 'test-key',
        }),
        body: JSON.stringify([span]),
      }),
    )

    fetchSpy.mockRestore()
  })

  it('silently ignores fetch errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

    const exporter = createUrlExporter({ url: 'https://fail.example.com' })

    await expect(exporter.export([makeSpan()])).resolves.toBeUndefined()

    fetchSpy.mockRestore()
  })

  it('stops exporting after shutdown', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

    const exporter = createUrlExporter({ url: 'https://example.com' })
    await exporter.shutdown()
    await exporter.export([makeSpan()])

    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
