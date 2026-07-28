import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../src'
import {
  createInMemoryObservabilityTransport,
  definitionRef,
  observe,
  resetObservabilityRuntime,
  type CruxGraphRecord,
} from '../../src/observability'
import { resetHooks } from '../../src/runtime/runtime'

describe('observability redaction pattern surfaces', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('redacts every attributes value without changing matching keys', async () => {
    const records = await captureRecords(async () => {
      const span = observe.openSpan({
        name: 'attribute span',
        primitive: 'custom.operation',
        attributes: sensitiveAttributes(),
      })
      await span.withContext(async () => {
        observe.event({
          name: 'attribute event',
          attributes: sensitiveAttributes(),
        })
        const artifactId = observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          preview: 'safe',
          attributes: sensitiveAttributes(),
        })
        observe.edge({
          edgeType: 'produced',
          from: { kind: 'span', id: span.spanId },
          to: { kind: 'artifact', id: artifactId! },
          attributes: sensitiveAttributes(),
        })
      })
      span.end()
    })

    for (const type of ['span:start', 'span:event', 'artifact', 'edge']) {
      const record = records.find((candidate) => candidate.type === type)
      expect(record?.attributes).toEqual({
        'ACME-100001': {
          identifier: '[REDACTED]',
          nested: ['[REDACTED]'],
        },
      })
    }
  })

  it('redacts artifact URIs and compact error messages', async () => {
    const records = await captureRecords(() => {
      observe.artifact({
        kind: 'output',
        contentType: 'text/plain',
        encoding: 'reference',
        uri: 'ACME-100001',
      })
      const span = observe.openSpan({
        name: 'failing span',
        primitive: 'custom.operation',
      })
      span.error(new Error('provider failed for ACME-100002'))
    })

    const output = records.find(
      (record) => record.type === 'artifact' && record.kind === 'output',
    )
    const spanEnd = records.find((record) => record.type === 'span:end')
    const errorArtifacts = records.filter(
      (record) =>
        record.type === 'artifact' &&
        (record.kind === 'error.stack' || record.kind === 'error.raw'),
    )

    expect(output).toMatchObject({
      uri: '[url]',
    })
    expect(spanEnd).toMatchObject({
      error: { message: 'provider failed for [REDACTED]' },
    })
    expect(JSON.stringify(errorArtifacts)).not.toContain('ACME-')
  })

  it('preserves structural graph identity', async () => {
    const ref = definitionRef('prompt', 'ACME-100001')
    const records = await captureRecords(async () => {
      await observe.span(
        {
          name: 'ACME-100002',
          primitive: 'custom.operation',
          definitionRefs: [ref],
          attributes: { identifier: 'ACME-100003' },
        },
        async () => undefined,
      )
    })

    const span = records.find((record) => record.type === 'span:start')
    expect(span).toMatchObject({
      name: 'ACME-100002',
      definitionRefs: [ref],
      attributes: { identifier: '[REDACTED]' },
    })
  })

  it('redacts strings produced by JSON-safe coercion', async () => {
    const records = await captureRecords(async () => {
      await observe.span(
        {
          name: 'coercion span',
          primitive: 'custom.operation',
          attributes: {
            identifier: Symbol('ACME-100001'),
          },
        },
        async () => undefined,
      )
    })

    const span = records.find((record) => record.type === 'span:start')
    expect(span?.attributes).toEqual({
      identifier: 'Symbol([REDACTED])',
    })
  })
})

function sensitiveAttributes() {
  return {
    'ACME-100001': {
      identifier: 'ACME-100002',
      nested: ['ACME-100003'],
    },
  }
}

async function captureRecords(
  emit: () => Promise<void> | void,
): Promise<readonly CruxGraphRecord[]> {
  const transport = createInMemoryObservabilityTransport()
  const runtime = config({
    observability: {
      transport,
      redactPatterns: [/ACME-\d+/],
    },
  })
  try {
    await observe.run(
      { name: 'surface test', rootPrimitive: 'custom.operation' },
      emit,
    )
    await observe.flush()
    return transport.records
  } finally {
    runtime.dispose()
  }
}
