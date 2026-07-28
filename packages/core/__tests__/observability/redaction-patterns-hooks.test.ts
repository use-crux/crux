import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from '../../src/observability'
import { byteLength, hashString } from '../../src/observability/capture-policy-utils'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'

describe('observability redaction hooks', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('keeps the pre-sanitization hook input shape', async () => {
    let hookPreview: unknown
    updateHooks({
      observabilityCapture: {
        redactPatterns: [/ACME-\d+/],
        redactRecord(record) {
          if (record.type === 'artifact' && record.kind === 'output') {
            hookPreview = record.preview
          }
          return record
        },
      },
    })

    await emitOutput({
      identifier: 'ACME-100001',
      optional: undefined,
    })

    expect(hookPreview).toEqual({
      identifier: '[REDACTED]',
      optional: undefined,
    })
  })

  it('preserves nested redactRecord precedence', async () => {
    const calls: string[] = []
    updateHooks({
      observabilityCapture: {
        capture: {
          redactRecord(record) {
            calls.push('nested')
            return record
          },
        },
        redactRecord(record) {
          calls.push('top-level')
          return record
        },
      },
    })

    await emitOutput('safe')

    expect(calls).not.toContain('top-level')
    expect(calls).toContain('nested')
  })

  it('redacts hook-injected payloads and refreshes stale evidence', async () => {
    updateHooks({
      observabilityCapture: {
        redactPatterns: [/ACME-\d+/],
        redactRecord(record) {
          if (record.type !== 'artifact' || record.kind !== 'output') {
            return record
          }
          return {
            ...record,
            preview: 'hook ACME-100001',
            attributes: { identifier: 'ACME-100002' },
            sizeBytes: 999,
            hash: 'stale',
          }
        },
      },
    })

    const records = await emitOutput('safe')
    const output = records.find(
      (record) => record.type === 'artifact' && record.kind === 'output',
    )

    expect(output).toMatchObject({
      preview: 'hook [REDACTED]',
      attributes: { identifier: '[REDACTED]' },
      sizeBytes: byteLength('hook [REDACTED]'),
      hash: hashString('hook [REDACTED]'),
    })
  })

  it('redacts hook-injected compact error messages in the final pass', async () => {
    updateHooks({
      observabilityCapture: {
        redactPatterns: [/ACME-\d+/],
        redactRecord(record) {
          if (record.type !== 'span:end' || record.error === undefined) {
            return record
          }
          return {
            ...record,
            error: {
              ...record.error,
              message: 'hook ACME-100001',
            },
          }
        },
      },
    })
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })

    await observe.run(
      { name: 'error hook test', rootPrimitive: 'custom.operation' },
      async () => {
        const span = observe.openSpan({
          name: 'error span',
          primitive: 'custom.operation',
        })
        span.error(new Error('safe'))
      },
    )
    await observe.flush()

    expect(
      transport.records.find((record) => record.type === 'span:end'),
    ).toMatchObject({
      error: { message: 'hook [REDACTED]' },
    })
  })

  it('snapshots mutable advanced-hook patterns for each emission', async () => {
    const patterns = [/FIRST-\d+/]
    updateHooks({
      observabilityCapture: {
        redactPatterns: patterns,
      },
    })

    const firstRecords = await emitOutput('FIRST-100001')
    patterns[0] = /SECOND-\d+/
    const secondRecords = await emitOutput('SECOND-100002')

    expect(outputPreview(firstRecords)).toBe('[REDACTED]')
    expect(outputPreview(secondRecords)).toBe('[REDACTED]')
    expect(outputPreview(firstRecords)).toBe('[REDACTED]')
    expect(patterns[0].lastIndex).toBe(0)
  })

  it('keeps hook null and throw fail-closed', async () => {
    updateHooks({
      observabilityCapture: {
        redactRecord: (record) =>
          record.type === 'artifact' ? null : record,
      },
    })
    const dropped = await emitOutput('drop')
    expect(outputPreview(dropped)).toBeUndefined()
    expect(observabilityDiagnostics().redactedRecords).toBe(1)

    resetObservabilityRuntime()
    resetHooks()
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          if (record.type === 'artifact') throw new Error('hook failed')
          return record
        },
      },
    })
    const thrown = await emitOutput('throw')
    expect(outputPreview(thrown)).toBeUndefined()
    expect(observabilityDiagnostics().redactedRecords).toBe(1)
  })

  it('drops telemetry on pattern failures without failing the operation', async () => {
    const failure = new Error('pattern access failed')
    const brokenPattern = new Proxy(/ACME-\d+/, {
      get() {
        throw failure
      },
    })
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    updateHooks({
      observabilityCapture: {
        redactPatterns: [brokenPattern],
      },
    })

    const result = await observe.run(
      { name: 'successful operation', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await observe.flush()

    expect(result).toBe('ok')
    expect(transport.records).toEqual([])
    expect(observabilityDiagnostics().redactedRecords).toBeGreaterThan(0)
  })
})

async function emitOutput(preview: unknown): Promise<readonly CruxGraphRecord[]> {
  const transport = createInMemoryObservabilityTransport()
  setObservabilityTransport(transport, { scheduledDelayMs: 0 })
  await observe.run(
    { name: 'hook test', rootPrimitive: 'custom.operation' },
    async () => {
      observe.artifact({
        kind: 'output',
        contentType: 'application/json',
        encoding: 'json',
        preview,
      })
    },
  )
  await observe.flush()
  return transport.records
}

function outputPreview(records: readonly CruxGraphRecord[]): unknown {
  return records.find(
    (record) => record.type === 'artifact' && record.kind === 'output',
  )?.preview
}
