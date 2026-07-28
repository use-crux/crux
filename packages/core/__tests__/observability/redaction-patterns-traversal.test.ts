import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../src'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  type CruxGraphRecord,
  type CruxObservabilityRedactionPattern,
} from '../../src/observability'
import { resetHooks } from '../../src/runtime/runtime'

describe('observability redaction pattern traversal', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('redacts nested preview values without mutating the caller graph', async () => {
    const nested = { identifier: 'ACME-928471' }
    const preview = {
      identifier: 'ACME-100001',
      values: [nested, 'ACME-100002'],
    }

    const emitted = await emittedOutput(preview)

    expect(emitted.preview).toEqual({
      identifier: '[REDACTED]',
      values: [{ identifier: '[REDACTED]' }, '[REDACTED]'],
    })
    expect(preview).toEqual({
      identifier: 'ACME-100001',
      values: [nested, 'ACME-100002'],
    })
    expect(preview.values[0]).toBe(nested)
  })

  it('preserves cycles until sanitization emits a safe marker', async () => {
    interface CircularPreview {
      identifier: string
      self?: CircularPreview
    }
    const preview: CircularPreview = { identifier: 'ACME-928471' }
    preview.self = preview

    const emitted = await emittedOutput(preview)

    expect(emitted.preview).toEqual({
      identifier: '[REDACTED]',
      self: '[Circular]',
    })
    expect(preview.identifier).toBe('ACME-928471')
    expect(preview.self).toBe(preview)
  })

  it('does not leak values beyond depth or collection bounds', async () => {
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let depth = 0; depth < 9; depth += 1) {
      const next: Record<string, unknown> = {}
      cursor.next = next
      cursor = next
    }
    cursor.identifier = 'ACME-100001'

    const array = Array.from({ length: 201 }, (_, index) =>
      index === 200 ? 'ACME-100002' : index,
    )
    const object = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [
        `key${index}`,
        index === 200 ? 'ACME-100003' : index,
      ]),
    )

    const emitted = await emittedOutput({ deep, array, object })

    expect(JSON.stringify(emitted)).not.toContain('ACME-')
    expect(JSON.stringify(emitted)).toContain('[Truncated]')
  })

  it('matches the entire string before sanitizer truncation', async () => {
    const preview = `ACME-928471${'x'.repeat(63_990)}ACME-100002`

    const emitted = await emittedOutput(preview, [
      { pattern: /ACME-\d+/, replacement: '' },
    ])

    expect(String(emitted.preview)).not.toContain('ACME-')
  })
})

async function emittedOutput(
  preview: unknown,
  redactPatterns: readonly CruxObservabilityRedactionPattern[] = [/ACME-\d+/],
): Promise<Extract<CruxGraphRecord, { readonly type: 'artifact' }>> {
  const transport = createInMemoryObservabilityTransport()
  const runtime = config({
    observability: {
      transport,
      redactPatterns,
    },
  })
  try {
    await observe.run(
      { name: 'traversal test', rootPrimitive: 'custom.operation' },
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
    const artifact = transport.records.find(
      (
        record,
      ): record is Extract<CruxGraphRecord, { readonly type: 'artifact' }> =>
        record.type === 'artifact' && record.kind === 'output',
    )
    if (!artifact) throw new Error('Expected an output artifact')
    return artifact
  } finally {
    runtime.dispose()
  }
}
