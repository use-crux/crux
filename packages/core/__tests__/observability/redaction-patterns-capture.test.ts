import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../src'
import {
  applyConfiguredObservabilityCapturePolicy,
  applyObservabilityCapturePolicy,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  type CruxGraphRecord,
  type CruxObservabilityCaptureConfig,
} from '../../src/observability'
import { byteLength, hashString } from '../../src/observability/capture-policy-utils'
import { resetHooks } from '../../src/runtime/runtime'

const rawPreview = 'order ACME-928471'
const redactedPreview = 'order [REDACTED]'

describe('observability redaction capture composition', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it.each(['full', 'safe'] as const)(
    '%s retains redacted previews and refreshes existing evidence',
    async (capture) => {
      const artifact = await emittedArtifact(capture)

      expect(artifact).toMatchObject({
        preview: redactedPreview,
        sizeBytes: byteLength(redactedPreview),
        hash: hashString(redactedPreview),
      })
    },
  )

  it('derives evidence from the redacted preview', async () => {
    const artifact = await emittedArtifact('evidence')

    expect(artifact).not.toHaveProperty('preview')
    expect(artifact).toMatchObject({
      encoding: 'reference',
      sizeBytes: byteLength(redactedPreview),
      hash: hashString(redactedPreview),
    })
    expect(artifact.hash).not.toBe(hashString(rawPreview))
  })

  it('redacts direct artifact helper calls before evidence derivation', () => {
    const artifact = {
      kind: 'output',
      contentType: 'text/plain',
      encoding: 'text',
      preview: rawPreview,
      uri: 'ACME-100001',
      attributes: { identifier: 'ACME-100002' },
    } as const
    const runtime = config({
      observability: {
        capture: 'evidence',
        redactPatterns: [/ACME-\d+/],
      },
    })

    try {
      const directional = applyObservabilityCapturePolicy('output', artifact)
      const configured = applyConfiguredObservabilityCapturePolicy(artifact)

      for (const result of [directional, configured]) {
        expect(result).not.toHaveProperty('preview')
        expect(result).toMatchObject({
          encoding: 'reference',
          sizeBytes: byteLength(redactedPreview),
          hash: hashString(redactedPreview),
          uri: '[REDACTED]',
          attributes: { identifier: '[REDACTED]' },
        })
      }
      expect(artifact.preview).toBe(rawPreview)
      expect(artifact.uri).toBe('ACME-100001')
    } finally {
      runtime.dispose()
    }
  })

  it('does not read direct-helper values beyond traversal bounds', () => {
    const values = Array.from({ length: 201 }, (_, index) => index)
    Object.defineProperty(values, 200, {
      enumerable: true,
      get() {
        throw new Error('out-of-bounds array getter was read')
      },
    })
    const preview: Record<string, unknown> = {
      identifier: rawPreview,
      values,
    }
    for (let index = 0; index < 198; index += 1) {
      preview[`key${index}`] = index
    }
    Object.defineProperty(preview, 'hostile', {
      enumerable: true,
      get() {
        throw new Error('out-of-bounds getter was read')
      },
    })
    const runtime = config({
      observability: {
        redactPatterns: [/ACME-\d+/],
      },
    })

    try {
      const result = applyObservabilityCapturePolicy('output', {
        kind: 'output',
        contentType: 'application/json',
        encoding: 'json',
        preview,
      })

      expect(result.preview).toMatchObject({
        identifier: redactedPreview,
      })
    } finally {
      runtime.dispose()
    }
  })

  it('keeps off empty and preserves artifact-kind override precedence', async () => {
    const off = await emittedArtifact('off')
    expect(off).not.toHaveProperty('preview')
    expect(off).not.toHaveProperty('hash')
    expect(off).not.toHaveProperty('sizeBytes')
    expect(off).not.toHaveProperty('uri')

    const overridden = await emittedArtifact({
      default: 'off',
      overrides: { output: 'full' },
    })
    expect(overridden).toMatchObject({
      preview: redactedPreview,
      encoding: 'text',
    })
  })
})

async function emittedArtifact(
  capture: CruxObservabilityCaptureConfig,
): Promise<Extract<CruxGraphRecord, { readonly type: 'artifact' }>> {
  const transport = createInMemoryObservabilityTransport()
  const runtime = config({
    observability: {
      transport,
      capture,
      redactPatterns: [/ACME-\d+/],
    },
  })
  try {
    await observe.run(
      { name: 'capture test', rootPrimitive: 'custom.operation' },
      async () => {
        observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          preview: rawPreview,
          sizeBytes: 999,
          hash: 'stale',
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
