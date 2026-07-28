import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../src'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
} from '../../src/observability'
import { resetHooks } from '../../src/runtime/runtime'

describe('observability redaction patterns', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('redacts a configured artifact preview before subscribers and transports', async () => {
    const transport = createInMemoryObservabilityTransport()
    const subscriberRecords: CruxGraphRecord[] = []
    const artifact = {
      kind: 'output',
      contentType: 'text/plain',
      encoding: 'text',
      preview: 'order ACME-928471',
    } as const
    const runtime = config({
      observability: {
        transport,
        redactPatterns: [/\bACME-\d{6}\b/],
      },
    })
    const unsubscribe = subscribeObservability((record) => {
      subscriberRecords.push(record)
    })

    try {
      await observe.run(
        { name: 'redaction tracer', rootPrimitive: 'custom.operation' },
        async () => {
          observe.artifact(artifact)
        },
      )
      await observe.flush()

      const subscriberArtifact = findOutputArtifact(subscriberRecords)
      const transportedArtifact = findOutputArtifact(transport.records)

      expect(subscriberArtifact.preview).toBe('order [REDACTED]')
      expect(transportedArtifact.preview).toBe('order [REDACTED]')
      expect(artifact.preview).toBe('order ACME-928471')
      expect(JSON.stringify(subscriberRecords)).not.toContain('ACME-928471')
      expect(JSON.stringify(transport.records)).not.toContain('ACME-928471')
    } finally {
      unsubscribe()
      runtime.dispose()
    }
  })
})

function findOutputArtifact(
  records: readonly CruxGraphRecord[],
): Extract<CruxGraphRecord, { readonly type: 'artifact' }> {
  const artifact = records.find(
    (
      record,
    ): record is Extract<CruxGraphRecord, { readonly type: 'artifact' }> =>
      record.type === 'artifact' && record.kind === 'output',
  )
  expect(artifact).toBeDefined()
  if (!artifact) throw new Error('Expected an output artifact')
  return artifact
}
