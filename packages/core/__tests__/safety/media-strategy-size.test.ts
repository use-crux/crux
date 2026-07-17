/** Composite media size policy behavior through the public Safety session. */

import { describe, expect, it, vi } from 'vitest'
import { parseDataUrl } from '../../src/content/media-data-url'
import {
  boundary,
  createSafety,
  guardrail,
  GuardrailBlockedError,
  type MediaPart,
  SafetyConfigError,
} from '../../src/safety'

vi.mock('../../src/content/media-data-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/content/media-data-url')>()
  return { ...actual, parseDataUrl: vi.fn(actual.parseDataUrl) }
})

type MediaRun = ReturnType<typeof guardrail.media>

function runOn(run: MediaRun, part: MediaPart) {
  return run({ part, messageIndex: 0, partIndex: 0 }, {} as never)
}

describe('guardrail.media — size', () => {
  it('blocks an oversized Uint8Array with byte-only evidence', async () => {
    const policy = guardrail({
      id: 'small-attachments',
      on: boundary.input.media(),
      run: guardrail.media({ size: { maxBytes: 3 } }),
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const error = await safety
      .guardInput({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this.' },
              { type: 'file', source: new Uint8Array([10, 20, 30, 40]) },
            ],
          },
        ],
      })
      .then(() => undefined)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(error).toMatchObject({
      decisions: [
        expect.objectContaining({
          action: 'block',
          reason: 'Media attachment violates policy: media size 4 bytes exceeds the 3 byte limit.',
        }),
      ],
    })
    expect(String(error)).not.toContain('10,20,30,40')
  })

  it('uses an ArrayBuffer byte length', async () => {
    const run = guardrail.media({ size: { maxBytes: 3 } })

    await expect(runOn(run, {
      type: 'file',
      source: new ArrayBuffer(4),
    })).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('media size 4 bytes'),
    })
  })

  it('uses Blob.size without reading the payload', async () => {
    const run = guardrail.media({ size: { maxBytes: 3 } })
    const source = new Blob([new Uint8Array([1, 2, 3, 4])])
    const arrayBuffer = vi.spyOn(source, 'arrayBuffer')

    await expect(runOn(run, { type: 'file', source })).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('media size 4 bytes'),
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('uses the actual data Asset payload size', async () => {
    const run = guardrail.media({ size: { maxBytes: 3 } })
    const bytes = {
      type: 'data' as const,
      data: new Uint8Array(4),
      mediaType: 'application/pdf',
    }
    const blob = {
      type: 'data' as const,
      data: new Blob([new Uint8Array(4)]),
      mediaType: 'application/pdf',
    }

    await expect(runOn(run, { type: 'file', source: bytes })).resolves.toMatchObject({
      reason: expect.stringContaining('media size 4 bytes'),
    })
    await expect(runOn(run, { type: 'file', source: blob })).resolves.toMatchObject({
      reason: expect.stringContaining('media size 4 bytes'),
    })
  })

  it('uses the decoded data URL payload size', async () => {
    const run = guardrail.media({ size: { maxBytes: 3 } })

    await expect(runOn(run, {
      type: 'file',
      source: 'data:application/octet-stream;base64,AQIDBA==',
    })).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('media size 4 bytes'),
    })
  })

  it('parses a data URL once while deriving its type, size, and source facts', async () => {
    const parse = vi.mocked(parseDataUrl)
    parse.mockClear()
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
      size: { maxBytes: 8 },
      sources: {},
    })

    await expect(runOn(run, {
      type: 'image',
      source: 'data:;base64,iVBORwAAAAA=',
    })).resolves.toEqual({ action: 'allow' })
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('uses declared URL Asset and provider-file sizes without external I/O', async () => {
    const run = guardrail.media({ size: { maxBytes: 3 } })
    const url = {
      type: 'url' as const,
      url: new URL('https://example.com/report.pdf'),
      size: 4,
    }
    const providerFile = {
      type: 'provider-file' as const,
      provider: 'example',
      fileId: 'file-1',
      size: 4,
    }

    await expect(runOn(run, { type: 'file', source: url })).resolves.toMatchObject({
      reason: expect.stringContaining('media size 4 bytes'),
    })
    await expect(runOn(run, { type: 'file', source: providerFile })).resolves.toMatchObject({
      reason: expect.stringContaining('media size 4 bytes'),
    })
  })

  it('enforces finite fractional Asset sizes instead of treating them as unknown', async () => {
    const run = guardrail.media({ size: { maxBytes: 3, allowUnknown: true } })
    const source = {
      type: 'provider-file' as const,
      provider: 'example',
      fileId: 'file-1',
      size: 3.5,
    }

    await expect(runOn(run, { type: 'file', source })).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('media size 3.5 bytes'),
    })
  })

  it('reads MIME and size from a data URL with an uppercase scheme', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
      size: { maxBytes: 3 },
    })

    await expect(runOn(run, {
      type: 'image',
      source: 'DATA:image/png;base64,AQIDBA==',
    })).resolves.toEqual({
      action: 'block',
      reason: 'Media attachment violates policy: media size 4 bytes exceeds the 3 byte limit.',
    })
  })

  it('reads local facts from a whitespace-wrapped data URL', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
      size: { maxBytes: 3, allowUnknown: true },
    })

    await expect(runOn(run, {
      type: 'image',
      source: ' \tDATA:image/png;base64,AQIDBA==\n',
    })).resolves.toEqual({
      action: 'block',
      reason: 'Media attachment violates policy: media size 4 bytes exceeds the 3 byte limit.',
    })
  })

  it('fails closed for unknown remote/provider sizes unless opted in', async () => {
    const failClosed = guardrail.media({ size: { maxBytes: 3 } })
    const allowUnknown = guardrail.media({
      size: { maxBytes: 3, allowUnknown: true },
    })
    const rawUrl = { type: 'file', source: 'https://example.com/report.pdf' } as const
    const providerFile = {
      type: 'file' as const,
      source: {
        type: 'provider-file' as const,
        provider: 'example',
        fileId: 'file-1',
      },
    }

    await expect(runOn(failClosed, rawUrl)).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('media size is unknown'),
    })
    await expect(runOn(failClosed, providerFile)).resolves.toMatchObject({
      action: 'block',
    })
    await expect(runOn(allowUnknown, rawUrl)).resolves.toEqual({ action: 'allow' })
    await expect(runOn(allowUnknown, providerFile)).resolves.toEqual({ action: 'allow' })
  })

  it('prefers actual inline payload size over conflicting Asset metadata', async () => {
    const run = guardrail.media({ size: { maxBytes: 3 } })
    const source = {
      type: 'data' as const,
      data: new Uint8Array(4),
      mediaType: 'application/pdf',
      size: 1,
    }

    await expect(runOn(run, { type: 'file', source })).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('media size 4 bytes'),
    })
  })

  it('rejects invalid byte ceilings at construction', () => {
    for (const maxBytes of [0, -1, 1.5, Infinity, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        guardrail.media({ size: { maxBytes } }),
      ).toThrow(SafetyConfigError)
    }
  })

  it('reads only a bounded Blob prefix for fallback MIME sniffing', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
      size: { maxBytes: 100 },
    })
    const source = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      new Uint8Array(96),
    ])
    const slice = vi.spyOn(source, 'slice')
    const arrayBuffer = vi.spyOn(source, 'arrayBuffer')

    await expect(runOn(run, { type: 'image', source })).resolves.toEqual({ action: 'allow' })
    expect(slice).toHaveBeenCalledWith(0, 12)
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
})
