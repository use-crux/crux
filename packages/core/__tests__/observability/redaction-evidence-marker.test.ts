import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../src'
import {
  applyConfiguredObservabilityCapturePolicy,
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
} from '../../src/observability'
import {
  attachResolvedArtifactRedactionMarker,
  consumeObservabilityRedactionMarker,
  markArtifactRedactionEvidence,
  resolveArtifactRedactionMarker,
} from '../../src/observability/redaction-evidence'
import { resetHooks } from '../../src/runtime/runtime'

describe('artifact redaction evidence handoff', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('retains helper preview evidence without exposing the marker', async () => {
    const records: CruxGraphRecord[] = []
    const runtime = config({
      observability: {
        redactPatterns: [/ACME-\d+/],
      },
    })
    const unsubscribe = subscribeObservability((record) => records.push(record))

    try {
      const options = applyConfiguredObservabilityCapturePolicy({
        kind: 'output',
        contentType: 'text/plain',
        encoding: 'text',
        preview: 'order ACME-100001',
      })

      await observe.run(
        { name: 'marker handoff', rootPrimitive: 'custom.operation' },
        async () => {
          observe.artifact(options)
        },
      )

      const artifact = records.find(
        (record) => record.type === 'artifact' && record.kind === 'output',
      )
      expect(artifact?.privacy?.redaction).toEqual({
        applied: true,
        surfaces: ['artifact.preview'],
      })
      expect(Reflect.ownKeys(artifact ?? {}).every(isStringKey)).toBe(true)
    } finally {
      unsubscribe()
      runtime.dispose()
    }
  })

  it('keeps normal adapter spreads truthful and rejects changed surfaces', async () => {
    const runtime = config({
      observability: {
        redactPatterns: [/ACME-\d+/],
      },
    })
    try {
      const marked = applyConfiguredObservabilityCapturePolicy({
        kind: 'output',
        contentType: 'text/plain',
        encoding: 'text',
        preview: 'order ACME-100001',
      })

      const artifacts = await emitOptions([
        { ...marked },
        { ...marked, preview: 'safe overwrite' },
        {
          ...marked,
          preview: 'unrelated payload',
          attributes: { source: 'replacement' },
        },
      ])

      expect(artifacts[0]?.privacy?.redaction.surfaces).toEqual([
        'artifact.preview',
      ])
      expect(artifacts[1]).not.toHaveProperty('privacy')
      expect(artifacts[2]).not.toHaveProperty('privacy')
    } finally {
      runtime.dispose()
    }
  })

  it('supports unchanged reuse and frozen helper results', async () => {
    const runtime = config({
      observability: {
        redactPatterns: [/ACME-\d+/],
      },
    })
    try {
      const marked = Object.freeze(
        applyConfiguredObservabilityCapturePolicy({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          preview: 'order ACME-100001',
        }),
      )

      const artifacts = await emitOptions([marked, marked])

      expect(artifacts).toHaveLength(2)
      for (const artifact of artifacts) {
        expect(artifact.privacy?.redaction.surfaces).toEqual([
          'artifact.preview',
        ])
        expect(Reflect.ownKeys(artifact).every(isStringKey)).toBe(true)
      }
    } finally {
      runtime.dispose()
    }
  })

  it('loses evidence safely across schema, deep, and structured clones', async () => {
    const runtime = config({
      observability: {
        redactPatterns: [/ACME-\d+/],
      },
    })
    try {
      const marked = applyConfiguredObservabilityCapturePolicy({
        kind: 'output',
        contentType: 'text/plain',
        encoding: 'text',
        preview: 'order ACME-100001',
      })
      const schemaClone = {
        kind: marked.kind,
        contentType: marked.contentType,
        encoding: marked.encoding,
        preview: marked.preview,
      }
      const deepClone = JSON.parse(JSON.stringify(marked)) as typeof marked
      const structured = structuredClone(marked)

      const artifacts = await emitOptions([
        schemaClone,
        deepClone,
        structured,
      ])

      expect(artifacts).toHaveLength(3)
      for (const artifact of artifacts) {
        expect(artifact.preview).toBe('order [REDACTED]')
        expect(artifact).not.toHaveProperty('privacy')
      }
    } finally {
      runtime.dispose()
    }
  })

  it('removes a record marker by copy-on-write when the input is frozen', () => {
    const options = markArtifactRedactionEvidence(
      { preview: '[REDACTED]' },
      ['artifact.preview'],
    )
    const marked = attachResolvedArtifactRedactionMarker(
      artifactRecord(),
      resolveArtifactRedactionMarker(options),
    )
    const frozen = Object.freeze(marked)

    const consumed = consumeObservabilityRedactionMarker(frozen)

    expect(consumed.surfaces).toEqual(['artifact.preview'])
    expect(consumed.record).not.toBe(frozen)
    expect(Reflect.ownKeys(consumed.record).every(isStringKey)).toBe(true)
    expect(Reflect.ownKeys(frozen).some((key) => typeof key === 'symbol')).toBe(
      true,
    )
  })
})

async function emitOptions(
  options: readonly Parameters<typeof observe.artifact>[0][],
): Promise<Extract<CruxGraphRecord, { readonly type: 'artifact' }>[]> {
  const records: CruxGraphRecord[] = []
  const unsubscribe = subscribeObservability((record) => records.push(record))
  try {
    await observe.run(
      { name: 'marker cases', rootPrimitive: 'custom.operation' },
      async () => {
        for (const option of options) observe.artifact(option)
      },
    )
  } finally {
    unsubscribe()
  }
  return records.filter(
    (
      record,
    ): record is Extract<CruxGraphRecord, { readonly type: 'artifact' }> =>
      record.type === 'artifact' && record.kind === 'output',
  )
}

function isStringKey(key: PropertyKey): key is string {
  return typeof key === 'string'
}

function artifactRecord(): Extract<
  CruxGraphRecord,
  { readonly type: 'artifact' }
> {
  return {
    schemaVersion: 4,
    recordId: 'rec_marker' as never,
    type: 'artifact',
    operationId: 'run_marker' as never,
    runId: 'run_marker' as never,
    segmentId: 'seg_marker' as never,
    segmentSeq: 1,
    artifactId: 'art_marker' as never,
    kind: 'output',
    createdAt: '2026-07-28T00:00:00.000Z',
    contentType: 'text/plain',
    encoding: 'text',
    preview: '[REDACTED]',
  }
}
