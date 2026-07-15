import { afterEach, describe, expect, it } from 'vitest'
import { config, resetHooks } from '@use-crux/core'
import {
  observe,
  resetObservabilityRuntime,
  type DefinitionRef,
} from '@use-crux/core/observability'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { withTelemetry, type TraceSpan } from '../src'
import { definitionRefProjection } from '../src/definition-ref-mapper'

function definitionRef(index: number): DefinitionRef {
  return {
    id: `tool:search-${index}`,
    kind: 'tool',
    role: 'invoked-tool',
    source: {
      file: `src/tools/search-${index}.ts`,
      line: index + 1,
      column: 2,
    },
  }
}

describe('OTel DefinitionRef projection', () => {
  afterEach(() => {
    resetHooks()
    resetObservabilityRuntime()
    trace.disable()
  })

  it('drops unexpected ref fields without leaking or throwing', () => {
    const projection = definitionRefProjection([
      {
        id: 'secret-definition',
        kind: 'not-a-definition-kind',
        role: 'invoked-tool',
        prompt: 'do not export this prompt',
      },
    ])

    expect(() => JSON.stringify(projection)).not.toThrow()
    expect(JSON.stringify(projection)).not.toContain('secret-definition')
    expect(JSON.stringify(projection)).not.toContain('do not export')
    expect(projection).toEqual({
      attributes: {
        'crux.definition.refs_truncated': true,
        'crux.definition.refs_total': 1,
      },
      events: [],
    })
  })

  it.each([
    '/home/alice/private/tool.ts',
    '../private/tool.ts',
    'C:\\Users\\alice\\private\\tool.ts',
    'src/tools/private\u0000.ts',
  ])('drops an unsafe DefinitionRef source path: %s', (file) => {
    const projection = definitionRefProjection([
      {
        id: 'tool:search',
        kind: 'tool',
        role: 'invoked-tool',
        source: { file, line: 1 },
      },
    ])

    expect(JSON.stringify(projection)).not.toContain(file)
    expect(projection.events).toEqual([
      {
        attributes: {
          'crux.definition.id': 'tool:search',
          'crux.definition.kind': 'tool',
          'crux.definition.role': 'invoked-tool',
        },
      },
    ])
  })

  it('projects identical bounded semantics through standard and lightweight paths', async () => {
    const refs = Array.from({ length: 18 }, (_, index) => definitionRef(index))
    const standardExporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(new SimpleSpanProcessor(standardExporter))
    trace.setGlobalTracerProvider(provider)
    const standard = config({ plugins: [withTelemetry()] })

    await observe.span(
      { name: 'standard refs', primitive: 'tool.call', definitionRefs: refs },
      async () => undefined,
    )
    await observe.flush()
    const standardSpan = standardExporter.getFinishedSpans().find(
      (span) => span.name === 'execute_tool standard refs',
    )
    const standardSemantic = {
      attributes: standardSpan?.attributes,
      events: standardSpan?.events.map((event) => ({
        name: event.name,
        attributes: event.attributes,
      })),
    }
    await standard.dispose()
    trace.disable()
    await provider.shutdown()
    resetHooks()
    resetObservabilityRuntime()

    const lightweightSpans: TraceSpan[] = []
    const lightweight = config({
      plugins: [
        withTelemetry({
          exporter: (batch) => {
            lightweightSpans.push(...batch)
          },
        }),
      ],
    })
    await observe.span(
      { name: 'lightweight refs', primitive: 'tool.call', definitionRefs: refs },
      async () => undefined,
    )
    await observe.flush()
    const lightweightSpan = lightweightSpans.find(
      (span) => span.name === 'execute_tool lightweight refs',
    )

    for (const semantic of [standardSemantic, lightweightSpan]) {
      expect(semantic?.attributes).toMatchObject({
        'crux.definition.id': refs[0]?.id,
        'crux.definition.kind': 'tool',
        'crux.definition.role': 'invoked-tool',
        'crux.definition.refs_truncated': true,
        'crux.definition.refs_total': 18,
      })
      expect(semantic?.events).toHaveLength(16)
      expect(semantic?.events?.[0]).toMatchObject({
        name: 'crux.definition.ref',
        attributes: {
          'crux.definition.id': refs[0]?.id,
          'crux.definition.kind': 'tool',
          'crux.definition.role': 'invoked-tool',
          'crux.definition.source.file': 'src/tools/search-0.ts',
          'crux.definition.source.line': 1,
          'crux.definition.source.column': 2,
        },
      })
    }

    await lightweight.dispose()
  })

  it('fails closed when definition-ref text exceeds the per-span budget', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})
    const secret = `secret-${'x'.repeat(9_000)}`

    await observe.span(
      {
        name: 'oversized ref',
        primitive: 'tool.call',
        definitionRefs: [
          {
            id: secret,
            kind: 'tool',
            role: 'invoked-tool',
          },
        ],
      },
      async () => undefined,
    )
    await observe.flush()

    const serialized = JSON.stringify(spans)
    expect(serialized).not.toContain(secret)
    expect(spans[0]?.attributes).toMatchObject({
      'crux.definition.refs_truncated': true,
      'crux.definition.refs_total': 1,
    })
    expect(spans[0]?.events).toBeUndefined()
    await installed.dispose?.()
  })
})
