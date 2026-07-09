import { afterEach, describe, expect, it } from 'vitest'
import {
  observe,
  resetObservabilityRuntime,
} from '@use-crux/core/observability'
import { withTelemetry } from '../src'
import type { TraceSpan } from '../src/types'

describe('OTel record subscriber', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('exports spans from canonical observability records and unsubscribes on dispose', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    })

    const installed = plugin.install({})

    expect(installed).not.toHaveProperty('instrumentationHooks')
    expect(installed).not.toHaveProperty('middleware')

    await observe.span(
      {
        name: 'search',
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

    expect(spans.map((span) => span.name)).toEqual([
      'execute_tool search',
      'search',
    ])
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
        primitive: 'tool.call',
        attributes: { toolName: 'afterDispose' },
      },
      async () => {},
    )

    expect(spans.map((span) => span.name)).toEqual([
      'execute_tool search',
      'search',
    ])
  })

  it('preserves parentage and maps artifact, edge, and error records onto spans', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
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
          primitive: 'generation.call',
          attributes: {
            provider: 'openai',
            model: 'gpt-4o',
            promptId: 'support',
          },
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
            { name: 'validate', primitive: 'constraint.check' },
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
    const parent = spans.find((span) => span.name === 'chat gpt-4o')
    const run = spans.find((span) => span.name === 'generate')

    expect(child).toBeDefined()
    expect(parent).toBeDefined()
    expect(run).toBeDefined()
    expect(parent!.parentSpanId).toBe(run!.spanId)
    expect(child!.parentSpanId).toBe(parent!.spanId)
    expect(child!.status).toMatchObject({
      code: 'ERROR',
      message: 'constraint failed',
    })
    expect(parent!.attributes).toMatchObject({
      'deployment.environment': 'test',
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
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

  it('maps tool span names and key attributes from canonical records', async () => {
    const recordSpans: TraceSpan[] = []
    const recordInstall = withTelemetry({
      exporter: (batch) => {
        recordSpans.push(...batch)
      },
    }).install({})

    await observe.span(
      {
        name: 'lookup',
        primitive: 'tool.call',
        attributes: {
          toolCallId: 'tc-parity',
          toolName: 'lookup',
        },
      },
      async () => {},
    )
    recordInstall.dispose?.()

    const recordSpan = recordSpans.find(
      (span) => span.name === 'execute_tool lookup',
    )

    expect(recordSpan).toBeDefined()
    expect(recordSpan?.attributes).toMatchObject({
      'crux.tool.name': 'lookup',
      'crux.tool.call_id': 'tc-parity',
    })
  })

  it('uses Crux W3C span identifiers directly in the lightweight exporter path', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})

    await observe.span(
      {
        name: 'identity lookup',
        primitive: 'tool.call',
        attributes: { toolName: 'identityLookup' },
      },
      async () => {},
    )
    installed.dispose?.()

    const span = spans.find(
      (item) => item.name === 'execute_tool identityLookup',
    )
    expect(span).toBeDefined()
    expect(span?.spanId).toBe(span?.attributes['crux.span.id'])
    expect(span?.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(span?.traceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('maps generation performance metrics to GenAI client attributes', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})

    await observe.span(
      {
        name: 'generate',
        primitive: 'generation.call',
      },
      async () => {},
    )

    observe
      .openSpan({
        name: 'generate with metrics',
        primitive: 'generation.call',
      })
      .end({
        metrics: {
          'gen.duration_ms': 42,
          'gen.time_to_first_token_ms': 12,
          'gen.output_tokens_per_second': 18,
          'gen.time_per_output_chunk_ms': 5,
        },
      })
    installed.dispose?.()

    const span = spans.find(
      (candidate) =>
        candidate.name === 'chat generate with metrics' &&
        candidate.attributes['gen_ai.client.operation.duration'] === 0.042,
    )

    expect(span?.attributes).toMatchObject({
      'gen_ai.client.operation.duration': 0.042,
      'gen_ai.server.time_to_first_token': 0.012,
      'crux.gen.output_tokens_per_second': 18,
      'crux.gen.time_per_output_chunk_ms': 5,
    })
    expect(span?.attributes).not.toHaveProperty(
      'gen_ai.client.output_tokens_per_second',
    )
    expect(span?.attributes).not.toHaveProperty(
      'gen_ai.client.time_per_output_chunk_ms',
    )
  })
})
