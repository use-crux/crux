import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetRuntime, prompt as cruxPrompt } from '@use-crux/core'
import { observe, resetObservabilityRuntime, subscribeObservability } from '@use-crux/core/observability'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { configure } from '../../core/runtime/configure'
import { withTelemetry } from '../index'
import { createCallbackExporter, createUrlExporter } from '../exporter'
import { __resetOpenTelemetryFallbackForTesting, createOpenTelemetrySpanManager } from '../otel-span-manager'
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
    resetObservabilityRuntime()
    __resetOpenTelemetryFallbackForTesting()
    trace.disable()
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

  it('uses the globally registered OTel tracer when no lightweight exporter is configured', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    trace.setGlobalTracerProvider(provider)

    const installed = withTelemetry({ serviceName: 'test-app' }).install({})

    await observe.span(
      {
        name: 'generate',
        primitive: 'generation.call',
        attributes: { provider: 'openai', model: 'gpt-4o' },
      },
      async () => {},
    )
    installed.dispose?.()

    const spans = exporter.getFinishedSpans()
    expect(spans.map((span) => span.name)).toContain('chat gpt-4o')
    expect(spans.find((span) => span.name === 'chat gpt-4o')?.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-4o',
    })
    expect(spans.find((span) => span.name === 'chat gpt-4o')?.status.code).toBe(SpanStatusCode.OK)

    trace.disable()
    await provider.shutdown()
  })

  it('can coexist with other subscriber plugins', async () => {
    const subscriber = vi.fn()
    const otherPlugin = {
      name: 'other',
      install: () => ({ dispose: subscribeObservability(subscriber) }),
    }

    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [withTelemetry({ exporter: () => {} }), otherPlugin],
    })

    await observe.span({ name: 'test', primitive: 'tool.call' }, async () => {})

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ type: 'span:start', primitive: 'tool.call' }))

    reg.dispose()
  })

  it('guards against double telemetry installs so spans are exported once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const firstSpans: TraceSpan[] = []
    const secondSpans: TraceSpan[] = []
    const first = withTelemetry({
      exporter: (batch) => {
        firstSpans.push(...batch)
      },
    }).install({})
    const second = withTelemetry({
      exporter: (batch) => {
        secondSpans.push(...batch)
      },
    }).install({})

    await observe.span({ name: 'double install', primitive: 'tool.call' }, async () => {})
    second.dispose?.()
    first.dispose?.()

    expect(firstSpans.map((span) => span.name)).toEqual(['execute_tool double install', 'double install'])
    expect(secondSpans).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already installed'))
    warn.mockRestore()
  })

  it('falls back to lightweight spans when no TracerProvider is registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spans: TraceSpan[] = []
    const manager = createOpenTelemetrySpanManager(
      'test-app',
      createCallbackExporter((batch) => {
        spans.push(...batch)
      }),
    )

    const ref = manager?.startSpan('no provider span')
    expect(ref).toBeDefined()
    if (!ref) return
    manager?.endSpan(ref)

    expect(ref.spanId).not.toBe('0000000000000000')
    expect(ref.traceId).not.toBe('00000000000000000000000000000000')
    expect(spans).toEqual([
      expect.objectContaining({
        name: 'no provider span',
        spanId: ref.spanId,
        traceId: ref.traceId,
      }),
    ])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No OpenTelemetry TracerProvider registered'))
    warn.mockRestore()
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
