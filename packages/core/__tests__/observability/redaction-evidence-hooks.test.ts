import { afterEach, describe, expect, it } from 'vitest'
import {
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
} from '../../src/observability'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'

describe('observability redaction evidence hook boundary', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('keeps the old hook shape and merges pre-pass with final-pass matches', async () => {
    let hookKeys: PropertyKey[] = []
    let hookRecord: CruxGraphRecord | undefined
    updateHooks({
      observabilityCapture: {
        redactPatterns: [/ACME-\d+/],
        redactRecord(record) {
          if (record.type !== 'artifact' || record.kind !== 'output') {
            return record
          }
          hookKeys = Reflect.ownKeys(record)
          hookRecord = record
          return {
            ...record,
            preview: 'hook ACME-100002',
          }
        },
      },
    })

    const output = await emitOutput({
      preview: 'original ACME-100000',
      attributes: { account: 'ACME-100001' },
    })

    expect(hookKeys.every((key) => typeof key === 'string')).toBe(true)
    expect([...hookKeys].sort()).toEqual([
      'artifactId',
      'attributes',
      'contentType',
      'createdAt',
      'encoding',
      'kind',
      'operationId',
      'preview',
      'recordId',
      'runId',
      'schemaVersion',
      'segmentId',
      'segmentSeq',
      'traceId',
      'type',
    ])
    expect(hookRecord).not.toHaveProperty('privacy')
    expect(hookRecord?.preview).toBe('original [REDACTED]')
    expect(output).toMatchObject({
      preview: 'hook [REDACTED]',
      attributes: { account: '[REDACTED]' },
      privacy: {
        redaction: {
          applied: true,
          surfaces: ['artifact.preview', 'attributes'],
        },
      },
    })
  })

  it('does not claim pattern evidence for hook-only edits or forged metadata', async () => {
    updateHooks({
      observabilityCapture: {
        redactPatterns: [/ACME-\d+/],
        redactRecord(record) {
          if (record.type !== 'artifact' || record.kind !== 'output') {
            return record
          }
          return {
            ...record,
            preview: 'changed only by the custom hook',
            privacy: {
              redaction: {
                applied: true,
                surfaces: ['attributes'],
              },
            },
          }
        },
      },
    })

    const output = await emitOutput({ preview: 'safe' })

    expect(output?.preview).toBe('changed only by the custom hook')
    expect(output).not.toHaveProperty('privacy')
  })

  it.each(['drop', 'throw'] as const)(
    'emits no partial evidence when the hook must %s the record',
    async (behavior) => {
      const seen: CruxGraphRecord[] = []
      updateHooks({
        observabilityCapture: {
          redactPatterns: [/ACME-\d+/],
          redactRecord(record) {
            if (record.type !== 'artifact') return record
            if (behavior === 'throw') throw new Error('hook failed')
            return null
          },
        },
      })
      const unsubscribe = subscribeObservability((record) => seen.push(record))
      try {
        await emitOutput({ preview: 'ACME-100001' })
      } finally {
        unsubscribe()
      }

      expect(seen.some((record) => record.type === 'artifact')).toBe(false)
      expect(observabilityDiagnostics().redactedRecords).toBe(1)
    },
  )
})

async function emitOutput(
  fields: Partial<Parameters<typeof observe.artifact>[0]>,
): Promise<
  Extract<CruxGraphRecord, { readonly type: 'artifact' }> | undefined
> {
  const records: CruxGraphRecord[] = []
  const unsubscribe = subscribeObservability((record) => records.push(record))
  try {
    await observe.run(
      { name: 'evidence hook', rootPrimitive: 'custom.operation' },
      async () => {
        observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          ...fields,
        })
      },
    )
  } finally {
    unsubscribe()
  }
  return records.find(
    (
      record,
    ): record is Extract<CruxGraphRecord, { readonly type: 'artifact' }> =>
      record.type === 'artifact' && record.kind === 'output',
  )
}
