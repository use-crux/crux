import { channel } from 'node:diagnostics_channel'
import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../src'
import {
  CRUX_OBSERVABILITY_CHANNEL,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
  type CruxObservabilityChannelMessage,
} from '../../src/observability'
import { registerEvalObservabilityCaptureHooks } from '../../src/observability/eval-capture-hooks'
import { resetHooks } from '../../src/runtime/runtime'

let evalRecords: CruxGraphRecord[] | undefined

registerEvalObservabilityCaptureHooks({
  currentCaptureSession: () =>
    evalRecords
      ? { send: (records) => evalRecords?.push(...records) }
      : undefined,
  shouldQuarantineWrite: () => false,
})

describe('observability redaction evidence downstream compatibility', () => {
  afterEach(() => {
    evalRecords = undefined
    resetObservabilityRuntime()
    resetHooks()
  })

  it('fans the same safe evidence out without field-picking the record', async () => {
    const transport = createInMemoryObservabilityTransport()
    const subscriberRecords: CruxGraphRecord[] = []
    const channelMessages: CruxObservabilityChannelMessage[] = []
    evalRecords = []
    const diagnostics = channel(CRUX_OBSERVABILITY_CHANNEL)
    const onMessage = (message: unknown) => {
      channelMessages.push(message as CruxObservabilityChannelMessage)
    }
    diagnostics.subscribe(onMessage)
    const unsubscribe = subscribeObservability((record) =>
      subscriberRecords.push(record),
    )
    const runtime = config({
      observability: {
        transport,
        redactPatterns: [/ACME-\d+/],
      },
    })

    try {
      await observe.run(
        { name: 'downstream evidence', rootPrimitive: 'custom.operation' },
        async () => {
          observe.artifact({
            kind: 'output',
            contentType: 'text/plain',
            encoding: 'text',
            preview: 'order ACME-100001',
          })
        },
      )
      await observe.flush()

      const subscriberArtifact = outputArtifact(subscriberRecords)
      const channelArtifact = outputArtifact(
        channelMessages.map(({ record }) => record),
      )
      const transportArtifact = outputArtifact(transport.records)
      const evalArtifact = outputArtifact(evalRecords)

      expect(channelArtifact).toBe(subscriberArtifact)
      expect(evalArtifact).toBe(subscriberArtifact)
      expect(transportArtifact.privacy).toEqual(subscriberArtifact.privacy)
      expect(subscriberArtifact.privacy?.redaction).toEqual({
        applied: true,
        surfaces: ['artifact.preview'],
      })
      for (const artifact of [
        subscriberArtifact,
        channelArtifact,
        transportArtifact,
        evalArtifact,
      ]) {
        expect(JSON.stringify(artifact)).not.toContain('ACME-100001')
      }
    } finally {
      runtime.dispose()
      unsubscribe()
      diagnostics.unsubscribe(onMessage)
    }
  })
})

function outputArtifact(
  records: readonly CruxGraphRecord[] | undefined,
): Extract<CruxGraphRecord, { readonly type: 'artifact' }> {
  const artifact = records?.find(
    (
      record,
    ): record is Extract<CruxGraphRecord, { readonly type: 'artifact' }> =>
      record.type === 'artifact' && record.kind === 'output',
  )
  expect(artifact).toBeDefined()
  if (!artifact) throw new Error('Expected output artifact')
  return artifact
}
