import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../src'
import {
  CRUX_OBSERVABILITY_REDACTION_SURFACES,
  CruxObservabilityRedactionEvidenceSchema,
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
  type CruxObservabilityRedactionSurface,
} from '../../src/observability'
import {
  redactObservabilityArtifactDetailed,
  redactObservabilityRecordDetailed,
} from '../../src/observability/redaction-record'
import { resetHooks } from '../../src/runtime/runtime'

describe('observability redaction evidence', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('maps every writable pattern-redaction site to the closed surface union', () => {
    const cases = [
      {
        surface: 'artifact.preview',
        redact: () =>
          redactObservabilityArtifactDetailed(
            artifact({ preview: 'ACME-100001' }),
            [/ACME-\d+/],
          ),
      },
      {
        surface: 'artifact.uri',
        redact: () =>
          redactObservabilityArtifactDetailed(
            artifact({ uri: 'https://example.test/ACME-100001' }),
            [/ACME-\d+/],
          ),
      },
      {
        surface: 'attributes',
        redact: () =>
          redactObservabilityRecordDetailed(
            spanEnd({
              attributes: { account: 'ACME-100001' },
            }),
            [/ACME-\d+/],
          ),
      },
      {
        surface: 'error.message',
        redact: () =>
          redactObservabilityRecordDetailed(
            spanEnd({
              error: { message: 'failed for ACME-100001' },
            }),
            [/ACME-\d+/],
          ),
      },
    ] satisfies readonly {
      readonly surface: CruxObservabilityRedactionSurface
      readonly redact: () => {
        readonly surfaces: readonly CruxObservabilityRedactionSurface[]
      }
    }[]

    expect(cases.map(({ surface }) => surface)).toEqual(
      CRUX_OBSERVABILITY_REDACTION_SURFACES,
    )
    for (const { surface, redact } of cases) {
      expect(redact().surfaces).toEqual([surface])
    }
  })

  it('reports a changed artifact preview to graph subscribers', async () => {
    const records: CruxGraphRecord[] = []
    const runtime = config({
      observability: {
        redactPatterns: [/ACME-\d+/],
      },
    })
    const unsubscribe = subscribeObservability((record) => records.push(record))

    try {
      await observe.run(
        { name: 'evidence', rootPrimitive: 'custom.operation' },
        async () => {
          observe.artifact({
            kind: 'output',
            contentType: 'text/plain',
            encoding: 'text',
            preview: 'order ACME-100001',
          })
        },
      )

      const output = records.find(
        (record) => record.type === 'artifact' && record.kind === 'output',
      )
      expect(output?.privacy?.redaction).toEqual({
        applied: true,
        surfaces: ['artifact.preview'],
      })
    } finally {
      unsubscribe()
      runtime.dispose()
    }
  })

  it('accepts non-empty known metadata without making order or duplicates fatal', () => {
    expect(
      CruxObservabilityRedactionEvidenceSchema.safeParse({
        applied: true,
        surfaces: ['attributes', 'artifact.preview', 'attributes'],
      }).success,
    ).toBe(true)
    expect(
      CruxObservabilityRedactionEvidenceSchema.safeParse({
        applied: true,
        surfaces: [],
      }).success,
    ).toBe(false)
    expect(
      CruxObservabilityRedactionEvidenceSchema.safeParse({
        applied: true,
        surfaces: ['prompt.text'],
      }).success,
    ).toBe(false)
  })
})

function artifact(
  fields: Partial<{
    readonly preview: unknown
    readonly uri: string
    readonly attributes: Readonly<Record<string, unknown>>
  }>,
) {
  return {
    kind: 'output',
    contentType: 'text/plain',
    encoding: 'text',
    ...fields,
  } as const
}

function spanEnd(
  fields: Partial<{
    readonly attributes: Readonly<Record<string, unknown>>
    readonly error: { readonly message: string }
  }>,
) {
  return {
    schemaVersion: 4,
    recordId: 'rec_evidence',
    type: 'span:end',
    operationId: 'run_evidence',
    runId: 'run_evidence',
    segmentId: 'seg_evidence',
    segmentSeq: 1,
    spanId: '1111111111111111',
    endedAt: '2026-07-28T00:00:00.000Z',
    durationMs: 1,
    status: 'error',
    ...fields,
  } as const
}
