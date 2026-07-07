import { afterEach, describe, expect, it } from 'vitest'
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  createInMemoryObservabilityTransport,
  observabilityDiagnostics,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
  type CruxGraphRecord,
} from '../../observability'
import { resetHooks, updateHooks } from '../../runtime/runtime'

const exemptArtifactKinds = new Set([
  'error.stack',
  'routing.report',
  'cache.report',
  'embedding.report',
  'indexing.report',
  'ingest.report',
  'corpus.report',
  'security.report',
  'constraint.report',
])

describe('observability privacy capture policy', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('keeps disabled output payloads out of subscribers and transports', async () => {
    const transport = createInMemoryObservabilityTransport()
    const subscriberRecords: CruxGraphRecord[] = []
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    subscribeObservability((record) => {
      subscriberRecords.push(record)
    })
    updateHooks({
      observabilityCapture: {
        recordOutputs: false,
      },
    })

    await expect(
      observe.span(
        {
          name: 'stream answer',
          primitive: 'generation.stream',
          attributes: {
            text: 'OUTPUT-SPAN-TEXT',
            query: 'OUTPUT-QUERY-TEXT',
            output: 'OUTPUT-ATTRIBUTE-TEXT',
            filter: 'OUTPUT-FILTER-TEXT',
          },
        },
        async () => {
          observe.event({
            name: 'token.chunk',
            attributes: {
              chunkIndex: 0,
              text: 'OUTPUT-TOKEN-TEXT',
              charCount: 17,
            },
          })
          observe.artifact({
            kind: 'retrieval.hits',
            contentType: 'application/json',
            encoding: 'json',
            preview: {
              kind: 'retrieval.hits',
              query: 'OUTPUT-RETRIEVAL-QUERY',
              hits: [{ preview: 'OUTPUT-RETRIEVAL-DOCUMENT' }],
            },
          })
          observe.artifact({
            kind: 'memory.recall',
            contentType: 'application/json',
            encoding: 'json',
            preview: {
              kind: 'memory.recall',
              query: 'OUTPUT-MEMORY-QUERY',
              blocks: [{ preview: 'OUTPUT-MEMORY-CONTENT' }],
            },
          })
          const error = new Error('provider failed') as Error & {
            body?: string
          }
          error.body = 'OUTPUT-ERROR-RAW-BODY'
          throw error
        },
      ),
    ).rejects.toThrow('provider failed')
    await observe.flush()

    expectPayloadStringsAbsent(subscriberRecords)
    expectPayloadStringsAbsent(transport.records)
  })

  it('supports off mode by omitting payload previews and reference metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    updateHooks({
      observabilityCapture: {
        recordOutputs: 'off',
      },
    })

    await observe.span(
      {
        name: 'generate',
        primitive: 'generation.call',
      },
      async () => {
        observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          sizeBytes: 19,
          hash: 'sha256:payload',
          uri: 'memory://payload',
          preview: 'OUTPUT-OFF-PAYLOAD',
        })
      },
    )
    await observe.flush()

    const output = transport.records.find(
      (record) => record.type === 'artifact' && record.kind === 'output',
    )
    expect(output).toMatchObject({
      type: 'artifact',
      kind: 'output',
      contentType: 'text/plain',
      encoding: 'reference',
    })
    expect(output).not.toHaveProperty('preview')
    expect(output).not.toHaveProperty('sizeBytes')
    expect(output).not.toHaveProperty('hash')
    expect(output).not.toHaveProperty('uri')
    expect(JSON.stringify(transport.records)).not.toContain(
      'OUTPUT-OFF-PAYLOAD',
    )
  })

  it('strips previews for every non-exempt canonical artifact kind when capture is disabled', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    updateHooks({
      observabilityCapture: {
        recordInputs: false,
        recordOutputs: false,
      },
    })

    await observe.span(
      {
        name: 'all artifact kinds',
        primitive: 'generation.call',
      },
      async () => {
        for (const kind of CRUX_CANONICAL_ARTIFACT_KINDS) {
          observe.artifact({
            kind,
            contentType: 'text/plain',
            encoding: 'text',
            preview: `PAYLOAD-${kind}`,
          })
        }
        observe.artifact({
          kind: 'custom.payload',
          contentType: 'text/plain',
          encoding: 'text',
          preview: 'PAYLOAD-custom.payload',
        })
      },
    )
    await observe.flush()

    const serialized = JSON.stringify(transport.records)
    for (const kind of CRUX_CANONICAL_ARTIFACT_KINDS) {
      if (!exemptArtifactKinds.has(kind)) {
        expect(serialized).not.toContain(`PAYLOAD-${kind}`)
      }
    }
    expect(serialized).not.toContain('PAYLOAD-custom.payload')
  })

  it('drops records when redactRecord returns null or throws', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    updateHooks({
      observabilityCapture: {
        redactRecord: (record) => {
          if (record.type === 'span:event' && record.name === 'drop-me')
            return null
          if (record.type === 'artifact' && record.kind === 'output')
            throw new Error('redactor failed')
          return record
        },
      },
    })

    await observe.span(
      {
        name: 'generate',
        primitive: 'generation.call',
      },
      async () => {
        observe.event({ name: 'drop-me', attributes: { value: 'removed' } })
        observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          preview: 'dropped by hook throw',
        })
      },
    )
    await observe.flush()

    expect(transport.records).not.toContainEqual(
      expect.objectContaining({ type: 'span:event', name: 'drop-me' }),
    )
    expect(transport.records).not.toContainEqual(
      expect.objectContaining({ type: 'artifact', kind: 'output' }),
    )
    expect(observabilityDiagnostics().redactedRecords).toBe(2)
  })
})

const payloadStrings = [
  'OUTPUT-SPAN-TEXT',
  'OUTPUT-QUERY-TEXT',
  'OUTPUT-ATTRIBUTE-TEXT',
  'OUTPUT-FILTER-TEXT',
  'OUTPUT-TOKEN-TEXT',
  'OUTPUT-RETRIEVAL-QUERY',
  'OUTPUT-RETRIEVAL-DOCUMENT',
  'OUTPUT-MEMORY-QUERY',
  'OUTPUT-MEMORY-CONTENT',
  'OUTPUT-ERROR-RAW-BODY',
] as const

function expectPayloadStringsAbsent(records: readonly CruxGraphRecord[]): void {
  const serialized = JSON.stringify(records)
  for (const payload of payloadStrings) {
    expect(serialized).not.toContain(payload)
  }
}
