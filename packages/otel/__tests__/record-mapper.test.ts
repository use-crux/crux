import { afterEach, describe, expect, it } from 'vitest'
import { observe, resetObservabilityRuntime } from '@use-crux/core/observability'
import { withTelemetry } from '../index'
import type { TraceSpan } from '../types'

describe('OTel record subscriber', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('exports spans from canonical observability records and unsubscribes on dispose', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      mode: 'records',
      exporter: (batch) => {
        spans.push(...batch)
      },
    })

    const installed = plugin.install({})

    await observe.span(
      {
        name: 'search',
        family: 'tool',
        primitive: 'tool.call',
        attributes: {
          toolCallId: 'tc1',
          toolName: 'search',
          modelOutputType: 'json',
          outputSize: 42,
        },
      },
      async () => {
        observe.event({
          name: 'usage.observed',
          attributes: {
            inputTokens: 8,
            outputTokens: 5,
            costUsd: 0.001,
          },
        })
      },
    )

    expect(spans.map((span) => span.name)).toEqual(['crux.tool.search', 'search'])
    expect(spans[0].attributes).toMatchObject({
      'crux.tool.name': 'search',
      'crux.tool.call_id': 'tc1',
      'crux.tool.model_output.type': 'json',
      'crux.tool.output.size': 42,
    })
    expect(spans[0].events).toEqual([
      expect.objectContaining({
        name: 'usage.observed',
        attributes: expect.objectContaining({
          'gen_ai.usage.input_tokens': 8,
          'gen_ai.usage.output_tokens': 5,
          'crux.cost': 0.001,
        }),
      }),
    ])

    installed.dispose?.()

    await observe.span(
      {
        name: 'after-dispose',
        family: 'tool',
        primitive: 'tool.call',
        attributes: { toolName: 'afterDispose' },
      },
      async () => {},
    )

    expect(spans.map((span) => span.name)).toEqual(['crux.tool.search', 'search'])
  })

  it('preserves parentage and maps artifact, edge, and error records onto spans', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      mode: 'records',
      attributes: { 'deployment.environment': 'test' },
      exporter: (batch) => {
        spans.push(...batch)
      },
    })
    const installed = plugin.install({})

    await expect(
      observe.span(
        {
          name: 'generate',
          family: 'generation',
          primitive: 'generation.call',
          attributes: { provider: 'openai', model: 'gpt-4o', promptId: 'support' },
        },
        async () => {
          const context = observe.captureContext()
          const artifactId = observe.artifact({
            kind: 'input',
            contentType: 'application/json',
            encoding: 'json',
            sizeBytes: 17,
            preview: { question: 'refund' },
          })

          await observe.span(
            { name: 'validate', family: 'constraint', primitive: 'constraint.check' },
            async () => {
              if (context?.currentSpanId && artifactId) {
                observe.edge({
                  edgeType: 'consumed',
                  from: { kind: 'artifact', id: artifactId },
                  to: { kind: 'span', id: context.currentSpanId },
                })
              }
              throw new Error('constraint failed')
            },
          )
        },
      ),
    ).rejects.toThrow('constraint failed')

    installed.dispose?.()

    const child = spans.find((span) => span.name === 'crux.constraint.check')
    const parent = spans.find((span) => span.name === 'crux.generate')
    const run = spans.find((span) => span.name === 'generate')

    expect(child).toBeDefined()
    expect(parent).toBeDefined()
    expect(run).toBeDefined()
    expect(parent!.parentSpanId).toBe(run!.spanId)
    expect(child!.parentSpanId).toBe(parent!.spanId)
    expect(child!.status).toMatchObject({ code: 'ERROR', message: 'constraint failed' })
    expect(parent!.attributes).toMatchObject({
      'deployment.environment': 'test',
      'gen_ai.system': 'openai',
      'gen_ai.request.model': 'gpt-4o',
      'crux.prompt.id': 'support',
    })
    expect(parent!.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'crux.artifact',
          attributes: expect.objectContaining({
            'crux.artifact.kind': 'input',
            'crux.artifact.size_bytes': 17,
          }),
        }),
        expect.objectContaining({
          name: 'crux.edge',
          attributes: expect.objectContaining({
            'crux.edge.type': 'consumed',
          }),
        }),
      ]),
    )
  })

  it('matches the existing hooks path for tool span names and key attributes', async () => {
    const hookSpans: TraceSpan[] = []
    const recordSpans: TraceSpan[] = []
    const hookInstall = withTelemetry({
      exporter: (batch) => {
        hookSpans.push(...batch)
      },
    }).install({})

    hookInstall.instrumentationHooks!.onToolStart!({
      toolCallId: 'tc-parity',
      toolName: 'lookup',
      args: { query: 'refund' },
    })
    hookInstall.instrumentationHooks!.onToolEnd!({
      toolCallId: 'tc-parity',
      toolName: 'lookup',
      durationMs: 25,
      modelOutputType: 'text',
      outputSize: 120,
      modelOutputSize: 48,
      tokenSavingsEstimate: 72,
    })
    hookInstall.dispose?.()

    const recordInstall = withTelemetry({
      mode: 'records',
      exporter: (batch) => {
        recordSpans.push(...batch)
      },
    }).install({})

    await observe.span(
      {
        name: 'lookup',
        family: 'tool',
        primitive: 'tool.call',
        attributes: {
          toolCallId: 'tc-parity',
          toolName: 'lookup',
        },
      },
      async () => {},
    )
    recordInstall.dispose?.()

    const hookSpan = hookSpans.find((span) => span.name === 'crux.tool.lookup')
    const recordSpan = recordSpans.find((span) => span.name === 'crux.tool.lookup')

    expect(recordSpan).toBeDefined()
    expect(recordSpan?.name).toBe(hookSpan?.name)
    expect(recordSpan?.attributes).toMatchObject({
      'crux.tool.name': hookSpan?.attributes['crux.tool.name'],
      'crux.tool.call_id': hookSpan?.attributes['crux.tool.call_id'],
    })
  })
})
