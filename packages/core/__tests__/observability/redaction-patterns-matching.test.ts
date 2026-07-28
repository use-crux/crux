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
import { normalizeObservabilityRedactionPatterns } from '../../src/observability/redaction-patterns'

describe('observability redaction pattern matching', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('uses a literal custom replacement', async () => {
    const preview = await emittedPreview(
      [{ pattern: /(ACME)-\d+/, replacement: '$&:$1:$$:$<name>' }],
      'order ACME-928471',
    )

    expect(preview).toBe('order $&:$1:$$:$<name>')
  })

  it('replaces every match without requiring a global expression', async () => {
    const preview = await emittedPreview(
      [/ACME-\d+/],
      'ACME-100001 and ACME-100002',
    )

    expect(preview).toBe('[REDACTED] and [REDACTED]')
  })

  it('turns sticky expressions into global matching while preserving flags', async () => {
    const preview = await emittedPreview(
      [/ACME-\d+/iy],
      'ACME-100001 and acme-100002',
    )

    expect(preview).toBe('[REDACTED] and [REDACTED]')
  })

  it('does not insert replacements for zero-length matches', async () => {
    const preview = await emittedPreview([/(?=ACME)/], 'order ACME-928471')

    expect(preview).toBe('order ACME-928471')
  })

  it('applies rules in declaration order', async () => {
    const preview = await emittedPreview(
      [
        { pattern: /ACME/, replacement: 'ORG' },
        { pattern: /ORG-\d+/, replacement: '[identifier]' },
      ],
      'order ACME-928471',
    )

    expect(preview).toBe('order [identifier]')
  })

  it('does not mutate caller expressions, entries, or arrays', async () => {
    const pattern = /ACME-\d+/gy
    pattern.lastIndex = 7
    const entry = { pattern, replacement: '[identifier]' } as const
    const patterns: CruxObservabilityRedactionPattern[] = [entry]

    await emittedPreview(patterns, 'ACME-928471')

    expect(pattern.flags).toBe('gy')
    expect(pattern.lastIndex).toBe(7)
    expect(patterns).toEqual([entry])
    expect(Object.isFrozen(patterns)).toBe(false)
  })

  it('returns owned normalized snapshots by reference', () => {
    const snapshot = normalizeObservabilityRedactionPatterns([/ACME-\d+/])

    expect(normalizeObservabilityRedactionPatterns(snapshot)).toBe(snapshot)
  })
})

async function emittedPreview(
  redactPatterns: readonly CruxObservabilityRedactionPattern[],
  preview: string,
): Promise<unknown> {
  const transport = createInMemoryObservabilityTransport()
  const runtime = config({ observability: { transport, redactPatterns } })
  try {
    await observe.run(
      { name: 'matching test', rootPrimitive: 'custom.operation' },
      async () => {
        observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          preview,
        })
      },
    )
    await observe.flush()
    return findOutputArtifact(transport.records).preview
  } finally {
    runtime.dispose()
  }
}

function findOutputArtifact(
  records: readonly CruxGraphRecord[],
): Extract<CruxGraphRecord, { readonly type: 'artifact' }> {
  const artifact = records.find(
    (
      record,
    ): record is Extract<CruxGraphRecord, { readonly type: 'artifact' }> =>
      record.type === 'artifact' && record.kind === 'output',
  )
  if (!artifact) throw new Error('Expected an output artifact')
  return artifact
}
