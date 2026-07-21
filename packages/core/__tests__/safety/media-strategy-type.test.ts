/** Composite media type policy behavior through the public Safety session. */

import { describe, expect, it } from 'vitest'
import {
  boundary,
  createSafety,
  guardrail,
  GuardrailBlockedError,
  type MediaGuardrailOptions,
  type MediaPart,
  type MediaTypePattern,
  SafetyConfigError,
} from '../../src/safety'

type MediaRun = ReturnType<typeof guardrail.media>

function runOn(run: MediaRun, part: MediaPart) {
  return run({ part, origin: { kind: 'message', messageIndex: 0, partIndex: 0 } }, {} as never)
}

describe('guardrail.media — media types', () => {
  it('allows a declared PNG and blocks a declared PDF outside the allowlist', async () => {
    const policy = guardrail({
      id: 'png-only',
      on: boundary.input.media(),
      run: guardrail.media({
        mediaTypes: { allow: ['image/png'] },
      }),
    })

    const allowed = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(
      allowed.guardInput({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: new Uint8Array([1, 2, 3]),
                mediaType: 'image/png',
              },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({ messages: expect.any(Array) })

    const blocked = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(
      blocked.guardInput({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                source: new Uint8Array([1, 2, 3]),
                mediaType: 'application/pdf',
              },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      name: GuardrailBlockedError.name,
      decisions: [
        expect.objectContaining({
          action: 'block',
          boundary: 'model.input.media',
          policyId: 'png-only',
          reason: expect.stringContaining('application/pdf'),
        }),
      ],
    })
  })

  it('normalizes authored and observed MIME essences before matching', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: [' Image/PNG; charset=binary '] },
    })
    const policy = guardrail({
      id: 'normalized-png',
      on: boundary.input.media(),
      run,
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(
      safety.guardInput({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: new Uint8Array([1, 2, 3]),
                mediaType: 'IMAGE/PNG; charset=binary',
              },
            ],
          },
        ],
      }),
    ).resolves.toBeDefined()
    expect(run.strategy.config).toMatchObject({
      mediaTypes: { allow: ['image/png'] },
    })
  })

  it('matches a top-level MIME wildcard without matching another type', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/*'] },
    })

    await expect(
      runOn(run, {
        type: 'image',
        source: new Uint8Array([1, 2, 3]),
        mediaType: 'image/webp',
      }),
    ).resolves.toEqual({ action: 'allow' })
    await expect(
      runOn(run, {
        type: 'file',
        source: new Uint8Array([1, 2, 3]),
        mediaType: 'application/pdf',
      }),
    ).resolves.toMatchObject({ action: 'block' })
  })

  it('blocks unknown MIME by default and allows it only when opted in', async () => {
    const part = {
      type: 'file',
      source: 'https://example.com/report',
    } as const
    const failClosed = guardrail.media({
      mediaTypes: { allow: ['application/pdf'] },
    })
    const allowUnknown = guardrail.media({
      mediaTypes: {
        allow: ['application/pdf'],
        allowUnknown: true,
      },
    })

    await expect(runOn(failClosed, part)).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('unknown'),
    })
    await expect(runOn(allowUnknown, part)).resolves.toEqual({
      action: 'allow',
    })
  })

  it('prefers the part MIME type and otherwise uses source-owned metadata', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
    })
    const source = {
      type: 'url' as const,
      url: new URL('https://example.com/image'),
      mediaType: 'image/png',
    }

    await expect(
      runOn(run, {
        type: 'image',
        source,
        mediaType: 'image/jpeg',
      }),
    ).resolves.toMatchObject({
      action: 'block',
      reason: expect.stringContaining('image/jpeg'),
    })
    await expect(runOn(run, { type: 'image', source })).resolves.toEqual({
      action: 'allow',
    })
  })

  it('uses Blob and data URL MIME metadata when the part type is absent', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
    })
    await expect(
      runOn(run, {
        type: 'image',
        source: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      }),
    ).resolves.toEqual({ action: 'allow' })
    await expect(runOn(run, { type: 'image', source: 'data:image/png;base64,iVBORw==' })).resolves.toEqual({
      action: 'allow',
    })
  })

  it('sniffs an undeclared image from locally available signature bytes', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
    })

    await expect(
      runOn(run, {
        type: 'image',
        source: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]),
      }),
    ).resolves.toEqual({ action: 'allow' })
  })

  it('treats a malformed declared MIME type as unknown without sniffing bytes', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
    })

    await expect(
      runOn(run, {
        type: 'image',
        source: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mediaType: 'not-a-mime-type',
      }),
    ).resolves.toEqual({
      action: 'block',
      reason: 'Media attachment violates policy: media type is unknown.',
    })
  })

  it('rejects missing and malformed MIME rules with SafetyConfigError', () => {
    expect(() => guardrail.media({} as never)).toThrow(SafetyConfigError)
    expect(() =>
      guardrail.media({
        mediaTypes: { allow: [] },
      } as never),
    ).toThrow(SafetyConfigError)
    expect(() =>
      guardrail.media({
        mediaTypes: { allow: ['*/*'] },
      }),
    ).toThrow(SafetyConfigError)
    expect(() =>
      guardrail.media({
        mediaTypes: { allow: ['*/json'] },
      }),
    ).toThrow(SafetyConfigError)
  })

  it('copies and freezes normalized strategy metadata', async () => {
    const allow: [MediaTypePattern] = ['IMAGE/PNG']
    const options: MediaGuardrailOptions = {
      mediaTypes: { allow, allowUnknown: false },
    }
    const run = guardrail.media(options)
    const policy = guardrail({
      id: 'immutable-media-policy',
      on: boundary.input.media(),
      run,
    })

    allow[0] = 'application/pdf'

    expect(run.strategy).toEqual({
      kind: 'guardrail.media',
      config: {
        mediaTypes: { allow: ['image/png'], allowUnknown: false },
        action: 'block',
      },
    })
    expect(policy.strategy?.config).toBe(run.strategy.config)
    expect(Object.isFrozen(run.strategy.config)).toBe(true)
    expect(Object.isFrozen(run.strategy.config.mediaTypes)).toBe(true)
    expect(Object.isFrozen(run.strategy.config.mediaTypes.allow)).toBe(true)
    await expect(
      runOn(run, {
        type: 'image',
        source: new Uint8Array([1]),
        mediaType: 'image/png',
      }),
    ).resolves.toEqual({ action: 'allow' })
  })
})
