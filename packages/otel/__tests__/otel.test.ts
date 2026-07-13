import { describe, it, expect, vi, beforeEach } from 'vitest'
import { config, resetHooks } from '@use-crux/core'
import {
  observe,
  observabilityTelemetryFlushFailures,
  resetObservabilityRuntime,
  subscribeObservability,
} from '@use-crux/core/observability'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { withTelemetry } from '../src'
import { createCallbackExporter, createUrlExporter } from '../src/exporter'
import { __resetOpenTelemetryFallbackForTesting, createOpenTelemetrySpanManager } from '../src/otel-span-manager'
import { createLightweightSpanManager } from '../src/span-manager'
import type { TraceSpan } from '../src/types'

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
    resetHooks()
    resetObservabilityRuntime()
    __resetOpenTelemetryFallbackForTesting()
    trace.disable()
  })

  it('returns a CruxPlugin with name crux:otel', () => {
    const plugin = withTelemetry()

    expect(plugin.name).toBe('crux:otel')
    expect(typeof plugin.install).toBe('function')
  })

  it('installs via config() without errors', () => {
    const crux = config({
      plugins: [withTelemetry({ serviceName: 'test-app' })],
    })

    crux.dispose()
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

    const crux = config({
      plugins: [withTelemetry({ exporter: () => {} }), otherPlugin],
    })

    await observe.span({ name: 'test', primitive: 'tool.call' }, async () => {})

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ type: 'span:start', primitive: 'tool.call' }))

    crux.dispose()
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

  it('binds forceFlush/shutdown to the registered TracerProvider forceFlush', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    trace.setGlobalTracerProvider(provider)
    const forceFlushSpy = vi.spyOn(provider, 'forceFlush')

    const manager = createOpenTelemetrySpanManager('flush-binding')
    expect(manager).toBeDefined()
    const result = await manager?.forceFlush()

    expect(forceFlushSpy).toHaveBeenCalled()
    expect(result).toEqual({ flushed: 1, pending: 0, timedOut: false })

    trace.disable()
    await provider.shutdown()
  })

  it('exporter failure does not throw through withTelemetry dispose', async () => {
    const installed = withTelemetry({
      exporter: () => {
        throw new Error('exporter is down')
      },
    }).install({})

    await observe.span({ name: 'still works', primitive: 'tool.call' }, async () => {})

    await expect(installed.dispose?.()).resolves.toBeUndefined()
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

describe('observe.flush()/observe.shutdown() bind to the installed telemetry manager', () => {
  beforeEach(() => {
    resetHooks()
    resetObservabilityRuntime()
    __resetOpenTelemetryFallbackForTesting()
    trace.disable()
  })

  it('observe.flush() (not only plugin dispose) awaits a slow lightweight exporter export', async () => {
    const releaseExports: Array<() => void> = []
    const exported: TraceSpan[] = []
    const crux = config({
      plugins: [
        withTelemetry({
          exporter: async (spans) => {
            await new Promise<void>((resolve) => {
              releaseExports.push(resolve)
            })
            exported.push(...spans)
          },
        }),
      ],
    })

    // Opening the run explicitly (rather than an implicit run via
    // observe.span alone) keeps this to exactly one export/one exporter call.
    const run = observe.openRun({ name: 'flush-bound run', rootPrimitive: 'tool.call' })
    await run.withContext(() =>
      observe.span({ name: 'flush-bound export', primitive: 'tool.call', implicitRun: false }, async () => {}),
    )
    run.end()

    let flushResolved = false
    const flush = observe.flush().then((result) => {
      flushResolved = true
      return result
    })

    // The exporter promise has not settled yet — observe.flush() itself
    // (not just crux.dispose()) must still be waiting on it.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(flushResolved).toBe(false)
    expect(exported).toHaveLength(0)

    for (const release of releaseExports) release()
    await flush

    expect(flushResolved).toBe(true)
    expect(exported.map((s) => s.name)).toContain('execute_tool flush-bound export')

    await crux.dispose()
  })

  it('observe.shutdown() force-flushes the real OTel TracerProvider through provider.forceFlush', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    trace.setGlobalTracerProvider(provider)
    const forceFlushSpy = vi.spyOn(provider, 'forceFlush')

    const crux = config({ plugins: [withTelemetry({ serviceName: 'flush-bound-otel' })] })
    await observe.span({ name: 'standard flush', primitive: 'tool.call' }, async () => {})

    await observe.shutdown()

    expect(forceFlushSpy).toHaveBeenCalled()

    await crux.dispose()
    trace.disable()
    await provider.shutdown()
  })

  it('bounds the flush to an explicit timeoutMs and reports failure without throwing', async () => {
    const crux = config({
      plugins: [
        withTelemetry({
          exporter: () => new Promise<void>(() => {}),
        }),
      ],
    })
    const before = observabilityTelemetryFlushFailures()

    await observe.span({ name: 'never settles', primitive: 'tool.call' }, async () => {})

    const result = await observe.flush({ timeoutMs: 10 })

    expect(result).toBeDefined()
    expect(observabilityTelemetryFlushFailures()).toBeGreaterThan(before)

    await crux.dispose()
  })

  it('does not call the flush hook when no telemetry plugin is installed', async () => {
    const before = observabilityTelemetryFlushFailures()
    await expect(observe.flush()).resolves.toBeDefined()
    expect(observabilityTelemetryFlushFailures()).toBe(before)
  })
})

describe('lightweight span manager exporter promise tracking', () => {
  it('flush waits for an outstanding slow export before resolving', async () => {
    let releaseExport: (() => void) | undefined
    const exported: TraceSpan[][] = []
    const manager = createLightweightSpanManager({
      export: async (spans) => {
        await new Promise<void>((resolve) => {
          releaseExport = resolve
        })
        exported.push([...spans])
      },
      shutdown: async () => {},
    })

    const ref = manager.startSpan('slow export')
    manager.endSpan(ref)

    let flushed = false
    const flush = manager.forceFlush().then((result) => {
      flushed = true
      return result
    })

    // The exporter promise has not settled yet — flush must still be pending.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(flushed).toBe(false)
    expect(exported).toHaveLength(0)

    releaseExport?.()
    const result = await flush

    expect(flushed).toBe(true)
    expect(exported).toHaveLength(1)
    expect(result).toEqual({ flushed: 1, pending: 0, timedOut: false })
  })

  it('bounded forceFlush reports timedOut and leaves the export pending past the deadline', async () => {
    const manager = createLightweightSpanManager({
      export: () => new Promise<void>(() => {}),
      shutdown: async () => {},
    })

    const ref = manager.startSpan('never settles')
    manager.endSpan(ref)

    const result = await manager.forceFlush({ deadlineMs: 10 })

    expect(result.timedOut).toBe(true)
    expect(result.pending).toBe(1)
    expect(result.flushed).toBe(0)
  })

  it('shutdown force-flushes pending exports before tearing down the exporter', async () => {
    const exported: TraceSpan[][] = []
    let shutdownCalled = false
    const manager = createLightweightSpanManager({
      export: async (spans) => {
        await Promise.resolve()
        exported.push([...spans])
      },
      shutdown: async () => {
        shutdownCalled = true
      },
    })

    const ref = manager.startSpan('flush before shutdown')
    manager.endSpan(ref)
    await manager.shutdown()

    expect(exported).toHaveLength(1)
    expect(shutdownCalled).toBe(true)
  })

  it('forceFlush is a no-op when nothing is pending', async () => {
    const manager = createLightweightSpanManager({
      export: () => {},
      shutdown: async () => {},
    })

    const result = await manager.forceFlush()

    expect(result).toEqual({ flushed: 0, pending: 0, timedOut: false })
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
