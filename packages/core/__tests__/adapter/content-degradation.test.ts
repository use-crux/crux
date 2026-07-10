import { afterEach, describe, expect, it } from 'vitest'
import { degradeContentPart } from '../../src/adapter'
import {
  CRUX_CONTENT_DEGRADED_EVENT,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { collectingDiagnostics } from '../../src/resolver/fakes'

describe('content degradation', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('emits a warning and content.degraded event for unsupported parts', async () => {
    const diagnostics = collectingDiagnostics()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.span({ name: 'encode', family: 'generation', primitive: 'generation.call' }, () => {
      expect(
        degradeContentPart(
          { type: 'file-data', data: 'base64-audio', mediaType: 'audio/mpeg' },
          {
            provider: 'anthropic',
            role: 'user',
            reason: 'audio is unsupported',
            diagnostics,
          },
        ),
      ).toEqual({ text: '[file audio/mpeg 9B sha256:7dc2623c5c71]' })
    })
    await observe.flush()

    expect(diagnostics.warnings).toEqual([
      {
        message: '[@use-crux/core] anthropic degraded unsupported file-data content for user messages.',
        detail: {
          partType: 'file-data',
          mediaType: 'audio/mpeg',
          role: 'user',
          provider: 'anthropic',
          reason: 'audio is unsupported',
        },
      },
    ])
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: CRUX_CONTENT_DEGRADED_EVENT,
        attributes: {
          partType: 'file-data',
          mediaType: 'audio/mpeg',
          role: 'user',
          provider: 'anthropic',
          reason: 'audio is unsupported',
        },
      }),
    )
  })

  it('throws typed errors in strict mode before producing placeholder text', () => {
    expect(() =>
      degradeContentPart(
        { type: 'file-data', data: 'base64-audio', mediaType: 'audio/mpeg' },
        {
          provider: 'anthropic',
          role: 'user',
          reason: 'audio is unsupported',
          unsupportedContent: 'error',
        },
      ),
    ).toThrow('anthropic does not support file-data (audio/mpeg) for user messages: audio is unsupported')
  })
})
