import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observabilityDiagnostics,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
  type CruxGraphRecord,
} from '../../observability'
import { resetRuntime, updateRuntime } from '../../runtime/runtime'

describe('observability privacy capture policy', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetRuntime()
  })

  it('keeps disabled output payloads out of subscribers and transports', async () => {
    const transport = createInMemoryObservabilityTransport()
    const subscriberRecords: CruxGraphRecord[] = []
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    subscribeObservability((record) => {
      subscriberRecords.push(record)
    })
    updateRuntime({
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
            name: 'token.delta',
            attributes: {
              index: 0,
              text: 'OUTPUT-TOKEN-TEXT',
              length: 17,
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
          const error = new Error('provider failed') as Error & { body?: string }
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
    updateRuntime({
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

    const output = transport.records.find((record) => record.type === 'artifact' && record.kind === 'output')
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
    expect(JSON.stringify(transport.records)).not.toContain('OUTPUT-OFF-PAYLOAD')
  })

  it('drops records when redactRecord returns null or throws', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    updateRuntime({
      observabilityCapture: {
        redactRecord: (record) => {
          if (record.type === 'span:event' && record.name === 'drop-me') return null
          if (record.type === 'artifact' && record.kind === 'output') throw new Error('redactor failed')
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

    expect(transport.records).not.toContainEqual(expect.objectContaining({ type: 'span:event', name: 'drop-me' }))
    expect(transport.records).not.toContainEqual(expect.objectContaining({ type: 'artifact', kind: 'output' }))
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
