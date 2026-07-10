import { afterEach, describe, expect, it } from 'vitest'
import type {
  CruxGraphRecord,
  CruxGraphRecordBatch,
} from '@use-crux/core/observability'
import {
  observe,
  resetObservabilityRuntime,
} from '@use-crux/core/observability'
import { SEMCONV_VERSION } from '../src/semconv'
import generationRun from '../../core/src/observability/fixtures/generation-run.json'
import { withTelemetry } from '../src'
import { createCallbackExporter } from '../src/exporter'
import { createOtelRecordSubscriber } from '../src/record-mapper'
import { createLightweightSpanManager } from '../src/span-manager'
import type { TraceSpan } from '../src/types'
import { resetHooks, updateHooks } from '../../core/src/runtime/runtime'
import { messageContentAttributesForArtifact } from '../src/message-content'
import { imagePart, textPart } from '@use-crux/core'

describe('GenAI semconv projection', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('exports generation spans with the versioned GenAI semantic convention table', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})

    const span = observe.openSpan({
      name: 'generate support reply',
      primitive: 'generation.call',
      attributes: {
        provider: 'openai',
        model: 'gpt-4o',
      },
    })
    span.end({
      attributes: {
        finishReason: 'stop',
      },
      metrics: {
        'gen.duration_ms': 250,
        'gen.time_to_first_token_ms': 50,
        inputTokens: 12,
        outputTokens: 7,
      },
    })
    installed.dispose?.()

    const generation = spans.find(
      (candidate) =>
        candidate.attributes['crux.primitive.name'] === 'generation.call',
    )

    expect(SEMCONV_VERSION).toBe('genai-dev-2026-06')
    expect(generation).toMatchObject({
      name: 'chat gpt-4o',
      attributes: expect.objectContaining({
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openai',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.response.finish_reasons': ['stop'],
        'gen_ai.client.operation.duration': 0.25,
        'gen_ai.server.time_to_first_token': 0.05,
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 7,
        'crux.primitive.name': 'generation.call',
      }),
    })
    expect(generation?.attributes).not.toHaveProperty('gen_ai.system')
    expect(generation?.attributes).not.toHaveProperty(
      'gen_ai.client.duration_ms',
    )
    expect(generation?.attributes).not.toHaveProperty(
      'gen_ai.client.time_to_first_token_ms',
    )
  })

  it('exports every routing primitive with a stable OTel span name', () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})

    for (const primitive of [
      'routing.router',
      'routing.split',
      'routing.retry',
      'routing.cascade',
      'routing.fallback',
    ] as const) {
      observe
        .openSpan({ name: `${primitive} resolution`, primitive })
        .end()
    }
    installed.dispose?.()

    expect(
      spans
        .filter((span) =>
          String(span.attributes['crux.primitive.name']).startsWith('routing.'),
        )
        .map((span) => span.name),
    ).toEqual([
      'crux.routing.router',
      'crux.routing.split',
      'crux.routing.retry',
      'crux.routing.cascade',
      'crux.routing.fallback',
    ])
  })

  it('exports generation message content only when explicitly enabled', async () => {
    const defaultSpans: TraceSpan[] = []
    const defaultInstall = withTelemetry({
      exporter: (batch) => {
        defaultSpans.push(...batch)
      },
    }).install({})

    await emitGenerationWithArtifacts()
    defaultInstall.dispose?.()

    expect(JSON.stringify(defaultSpans)).not.toContain('Can I get a refund?')
    expect(JSON.stringify(defaultSpans)).not.toContain('Refunds are available.')
    expect(JSON.stringify(defaultSpans)).not.toContain('You help customers.')

    const capturedSpans: TraceSpan[] = []
    const capturedInstall = withTelemetry({
      captureMessageContent: true,
      exporter: (batch) => {
        capturedSpans.push(...batch)
      },
    }).install({})

    await emitGenerationWithArtifacts()
    capturedInstall.dispose?.()

    const generation = capturedSpans.find(
      (candidate) =>
        candidate.attributes['crux.primitive.name'] === 'generation.call',
    )
    const inputMessages = JSON.parse(
      String(generation?.attributes['gen_ai.input.messages']),
    )
    const outputMessages = JSON.parse(
      String(generation?.attributes['gen_ai.output.messages']),
    )

    expect(inputMessages).toEqual([
      {
        role: 'user',
        parts: [{ type: 'text', content: 'Can I get a refund?' }],
      },
    ])
    expect(outputMessages).toEqual([
      {
        role: 'assistant',
        parts: [{ type: 'text', content: 'Refunds are available.' }],
      },
    ])
    expect(generation?.attributes['gen_ai.system_instructions']).toBe(
      'You help customers.',
    )
  })

  it('does not read a bare process global when checking message content env opt-in', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')
    try {
      Object.defineProperty(globalThis, 'process', {
        configurable: true,
        value: undefined,
      })
      expect(() =>
        messageContentAttributesForArtifact(messageArtifact('No process'), {}),
      ).not.toThrow()
      expect(
        messageContentAttributesForArtifact(messageArtifact('No process'), {}),
      ).toEqual({})
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'process', descriptor)
    }
  })

  it('exports multimodal message content as the canonical text projection', () => {
    const attributes = messageContentAttributesForArtifact(
      {
        ...messageArtifact('fallback'),
        preview: {
          messages: [
            {
              role: 'user',
              content: [
                textPart('inspect this chart'),
                imagePart({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }),
              ],
            },
          ],
        },
      },
      { captureMessageContent: true },
    )

    const inputMessages = JSON.parse(String(attributes['gen_ai.input.messages']))
    expect(inputMessages).toEqual([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: expect.stringContaining('inspect this chart\n[image image/png 3B sha256:'),
          },
        ],
      },
    ])
    expect(JSON.stringify(inputMessages)).not.toContain('AQID')
  })

  it('continues to fallback text fields when structured content projects empty', () => {
    const attributes = messageContentAttributesForArtifact(
      {
        ...messageArtifact('fallback'),
        kind: 'output',
        preview: {
          content: [],
          answer: 'fallback answer',
        },
      },
      { captureMessageContent: true },
    )

    const outputMessages = JSON.parse(String(attributes['gen_ai.output.messages']))
    expect(outputMessages).toEqual([
      {
        role: 'assistant',
        parts: [{ type: 'text', content: 'fallback answer' }],
      },
    ])
  })

  it('does not export output messages when local output capture is off even with content opt-in', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      captureMessageContent: true,
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})
    updateHooks({
      observabilityCapture: {
        recordOutputs: 'off',
      },
    })

    await emitGenerationWithArtifacts()
    installed.dispose?.()

    const serialized = JSON.stringify(spans)
    const generation = spans.find(
      (candidate) =>
        candidate.attributes['crux.primitive.name'] === 'generation.call',
    )
    expect(generation?.attributes).not.toHaveProperty('gen_ai.output.messages')
    expect(serialized).not.toContain('Refunds are available.')
  })

  it('does not export fixture message content when message content capture is off', () => {
    const spans: TraceSpan[] = []
    const spanManager = createLightweightSpanManager(
      createCallbackExporter((batch) => {
        spans.push(...batch)
      }),
    )
    const subscriber = createOtelRecordSubscriber(spanManager, {})
    const batch = generationRun as CruxGraphRecordBatch

    for (const record of batch.records) {
      subscriber(record)
    }

    const serialized = JSON.stringify(spans)
    const generation = spans.find(
      (candidate) =>
        candidate.attributes['crux.primitive.name'] === 'generation.call',
    )
    expect(generation?.attributes).not.toHaveProperty('gen_ai.input.messages')
    expect(generation?.attributes).not.toHaveProperty('gen_ai.output.messages')
    expect(generation?.attributes).not.toHaveProperty(
      'gen_ai.system_instructions',
    )
    expect(serialized).not.toContain('Can I get a refund for my monthly plan?')
    expect(serialized).not.toContain(
      'Monthly plans are refundable within 14 days.',
    )
    expect(serialized).not.toContain('Refunds are available within 14 days.')
  })

  it('keeps truncated message content JSON parseable and marks the span truncated', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      captureMessageContent: true,
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})
    const longContent = 'x'.repeat(40 * 1024)

    const span = observe.openSpan({
      name: 'generate long reply',
      primitive: 'generation.call',
    })
    await span.withContext(async () => {
      observe.artifact({
        kind: 'output',
        contentType: 'application/json',
        encoding: 'json',
        preview: { text: longContent },
      })
    })
    span.end()
    installed.dispose?.()

    const generation = spans.find(
      (candidate) =>
        candidate.attributes['crux.primitive.name'] === 'generation.call',
    )
    const outputMessages = String(
      generation?.attributes['gen_ai.output.messages'],
    )
    expect(() => JSON.parse(outputMessages)).not.toThrow()
    expect(outputMessages.length).toBeLessThanOrEqual(32 * 1024)
    expect(generation?.attributes['crux.truncated']).toBe(true)
  })

  it('passes homogeneous arrays through and JSON-encodes mixed arrays and objects', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})

    await observe.span(
      {
        name: 'array attrs',
        primitive: 'custom.operation',
        attributes: {
          tags: ['alpha', 'beta'],
          scores: [1, 2],
          mixed: ['alpha', 1],
          nested: { ok: true },
        },
      },
      async () => {},
    )
    installed.dispose?.()

    const span = spans.find(
      (candidate) => candidate.name === 'crux.custom.operation',
    )

    expect(span?.attributes).toMatchObject({
      'crux.tags': ['alpha', 'beta'],
      'crux.scores': [1, 2],
      'crux.mixed': '["alpha",1]',
      'crux.nested': '{"ok":true}',
    })
  })

  it('keeps fixture stream projection pinned to the semconv table version', () => {
    const spans: TraceSpan[] = []
    const spanManager = createLightweightSpanManager(
      createCallbackExporter((batch) => {
        spans.push(...batch)
      }),
    )
    const subscriber = createOtelRecordSubscriber(spanManager, {
      captureMessageContent: true,
    })
    const batch = generationRun as CruxGraphRecordBatch

    for (const record of batch.records) {
      subscriber(record)
    }

    const snapshot = {
      semconvVersion: SEMCONV_VERSION,
      spans: spans.map((span) => ({
        name: span.name,
        parentSpanId: span.parentSpanId ? '<parent>' : undefined,
        status: span.status,
        attributes: span.attributes,
        events: span.events?.map((event) => ({
          name: event.name,
          attributes: event.attributes,
        })),
      })),
    }

    expect(snapshot).toMatchInlineSnapshot(`
      {
        "semconvVersion": "genai-dev-2026-06",
        "spans": [
          {
            "attributes": {
              "crux.cost": 0.00042,
              "crux.duration_ms": 510,
              "crux.mode": "object",
              "crux.primitive.family": "generation",
              "crux.primitive.name": "generation.call",
              "crux.prompt.id": "support.reply",
              "crux.run.id": "run_d202cd4d27c2073026a950af",
              "crux.span.id": "841e9c04c4d09a6e",
              "crux.temperature": 0.2,
              "crux.totalTokens": 60,
              "gen_ai.input.messages": "[{"role":"user","parts":[{"type":"text","content":"Can I get a refund for my monthly plan?"}]}]",
              "gen_ai.operation.name": "chat",
              "gen_ai.output.messages": "[{"role":"assistant","parts":[{"type":"text","content":"Monthly plans are refundable within 14 days."}]}]",
              "gen_ai.provider.name": "openai",
              "gen_ai.request.model": "gpt-4o",
              "gen_ai.response.finish_reasons": [
                "stop",
              ],
              "gen_ai.usage.input_tokens": 42,
              "gen_ai.usage.output_tokens": 18,
            },
            "events": [
              {
                "attributes": {
                  "crux.artifact.content_type": "application/json",
                  "crux.artifact.encoding": "json",
                  "crux.artifact.kind": "messages",
                  "crux.artifact.size_bytes": 137,
                },
                "name": "crux.artifact",
              },
              {
                "attributes": {
                  "crux.edge.from": "span:841e9c04c4d09a6e",
                  "crux.edge.to": "artifact:artifact_8ae65ffeda275825",
                  "crux.edge.type": "consumed",
                },
                "name": "crux.edge",
              },
              {
                "attributes": {
                  "crux.artifact.content_type": "application/json",
                  "crux.artifact.encoding": "json",
                  "crux.artifact.kind": "context.contribution",
                  "crux.artifact.size_bytes": 93,
                },
                "name": "crux.artifact",
              },
              {
                "attributes": {
                  "crux.edge.from": "artifact:artifact_d7574595f8c307ac",
                  "crux.edge.to": "span:841e9c04c4d09a6e",
                  "crux.edge.type": "consumed",
                  "crux.source": "context:refund-policy",
                },
                "name": "crux.edge",
              },
              {
                "attributes": {
                  "crux.artifact.content_type": "application/json",
                  "crux.artifact.encoding": "json",
                  "crux.artifact.kind": "prompt.budget",
                },
                "name": "crux.artifact",
              },
              {
                "attributes": {
                  "crux.edge.from": "span:841e9c04c4d09a6e",
                  "crux.edge.to": "artifact:artifact_f357626b26538e36",
                  "crux.edge.type": "produced",
                },
                "name": "crux.edge",
              },
              {
                "attributes": {
                  "crux.totalTokens": 60,
                  "gen_ai.usage.input_tokens": 42,
                  "gen_ai.usage.output_tokens": 18,
                },
                "name": "usage.observed",
              },
              {
                "attributes": {
                  "crux.artifact.content_type": "application/json",
                  "crux.artifact.encoding": "json",
                  "crux.artifact.kind": "output",
                  "crux.artifact.size_bytes": 91,
                },
                "name": "crux.artifact",
              },
              {
                "attributes": {
                  "crux.edge.from": "span:841e9c04c4d09a6e",
                  "crux.edge.to": "artifact:artifact_92678937d69b54b5",
                  "crux.edge.type": "produced",
                },
                "name": "crux.edge",
              },
            ],
            "name": "chat gpt-4o",
            "parentSpanId": "<parent>",
            "status": {
              "code": "OK",
            },
          },
          {
            "attributes": {
              "crux.cost": 0.00042,
              "crux.duration_ms": 530,
              "crux.environment": "test",
              "crux.run.id": "run_d202cd4d27c2073026a950af",
              "crux.run.root_primitive": "generation.call",
              "crux.totalTokens": 60,
              "gen_ai.usage.input_tokens": 42,
              "gen_ai.usage.output_tokens": 18,
              "meta.ticketId": "ticket_123",
            },
            "events": undefined,
            "name": "support reply",
            "parentSpanId": undefined,
            "status": {
              "code": "OK",
            },
          },
        ],
      }
    `)
  })
})

async function emitGenerationWithArtifacts(): Promise<void> {
  const span = observe.openSpan({
    name: 'generate support reply',
    primitive: 'generation.call',
    attributes: { provider: 'openai', model: 'gpt-4o' },
  })

  await span.withContext(async () => {
    observe.artifact({
      kind: 'messages',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        system: 'You help customers.',
        messages: [{ role: 'user', content: 'Can I get a refund?' }],
      },
    })
    observe.artifact({
      kind: 'output',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        text: 'Refunds are available.',
      },
    })
  })

  span.end()
}

function messageArtifact(
  text: string,
): Extract<CruxGraphRecord, { type: 'artifact' }> {
  return {
    type: 'artifact',
    schemaVersion: 1,
    recordId: 'rec_message_env_guard',
    runId: 'run_message_env_guard',
    seq: 1,
    traceId: '11111111111111111111111111111111',
    spanId: '1111111111111111',
    artifactId: 'artifact_message_env_guard',
    kind: 'messages',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      messages: [{ role: 'user', content: text }],
    },
    createdAt: '2026-07-03T00:00:00.000Z',
  } as Extract<CruxGraphRecord, { type: 'artifact' }>
}
