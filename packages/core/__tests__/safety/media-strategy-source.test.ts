/** Composite media source policy behavior through the public Safety session. */

import { describe, expect, it } from 'vitest'
import {
  boundary,
  createSafety,
  guardrail,
  GuardrailBlockedError,
  type MediaPart,
  SafetyConfigError,
} from '../../src/safety'

type MediaRun = ReturnType<typeof guardrail.media>

function runOn(run: MediaRun, part: MediaPart) {
  return run({ part, origin: { kind: 'message', messageIndex: 0, partIndex: 0 } }, {} as never)
}

function safetyFor(source: string) {
  const policy = guardrail({
    id: 'trusted-media-hosts',
    on: boundary.input.media(),
    run: guardrail.media({
      sources: { allowHosts: ['CDN.Example.com'] },
    }),
  })
  const safety = createSafety({
    call: { guardrails: [policy] },
    promptId: 'prompt-1',
    model: 'model-1',
  })
  return {
    safety,
    result: safety.guardInput({
      messages: [{ role: 'user', content: [{ type: 'image', source }] }],
    }),
  }
}

describe('guardrail.media — sources', () => {
  it('allows an exact host and blocks another without exposing its locator', async () => {
    await expect(safetyFor('https://cdn.example.com/image.png').result).resolves.toBeDefined()

    const rejectedUrl = 'https://private.example.net/secret/image.png'
    const { safety, result } = safetyFor(rejectedUrl)
    const error = await result.then(() => undefined).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(error).toMatchObject({
      decisions: [
        expect.objectContaining({
          reason: 'Media attachment violates policy: media source host is not allowed.',
        }),
      ],
    })
    expect(String(error)).not.toContain(rejectedUrl)
    expect(String(error)).not.toContain('private.example.net')
    expect(JSON.stringify(safety.audit)).not.toContain(rejectedUrl)
    expect(JSON.stringify(safety.audit)).not.toContain('private.example.net')
  })

  it('classifies raw, Blob, data Asset, and data URL sources as inline', async () => {
    const allow = guardrail.media({ sources: {} })
    const block = guardrail.media({ sources: { allowInline: false } })
    const sources = [
      new Uint8Array([1]),
      new Blob([new Uint8Array([1])]),
      { type: 'data' as const, data: new Uint8Array([1]), mediaType: 'image/png' },
      'data:image/png;base64,AQ==',
    ]

    for (const source of sources) {
      await expect(runOn(allow, { type: 'image', source })).resolves.toEqual({ action: 'allow' })
      await expect(runOn(block, { type: 'image', source })).resolves.toMatchObject({
        action: 'block',
        reason: expect.stringContaining('inline media sources are not allowed'),
      })
    }
  })

  it('classifies provider files separately and exempts them from URL rules', async () => {
    const source = {
      type: 'provider-file' as const,
      provider: 'example',
      fileId: 'private-file-id',
    }
    const block = guardrail.media({
      sources: { allowProviderFiles: false },
    })
    const urlRules = guardrail.media({
      sources: {
        allowHosts: ['cdn.example.com'],
        allowUrlQuery: false,
      },
    })

    await expect(runOn(block, { type: 'file', source })).resolves.toMatchObject({
      action: 'block',
      reason: expect.not.stringContaining('private-file-id'),
    })
    await expect(runOn(urlRules, { type: 'file', source })).resolves.toEqual({ action: 'allow' })
  })

  it('rejects URL userinfo by default and query strings only when configured', async () => {
    const defaults = guardrail.media({ sources: {} })
    const noQuery = guardrail.media({ sources: { allowUrlQuery: false } })
    const credentialUrl = 'https://user:password@example.com/file.png'
    const queryUrl = 'https://example.com/file.png?token=secret'

    await expect(runOn(defaults, { type: 'image', source: credentialUrl })).resolves.toMatchObject({
      reason: 'Media attachment violates policy: media source URL userinfo is not allowed.',
    })
    await expect(runOn(defaults, { type: 'image', source: queryUrl })).resolves.toEqual({ action: 'allow' })
    await expect(runOn(noQuery, { type: 'image', source: queryUrl })).resolves.toMatchObject({
      reason: 'Media attachment violates policy: media source URL query strings are not allowed.',
    })
  })

  it('applies source defaults only when the sources rule is authored', async () => {
    const credentialUrl = 'https://user:password@example.com/file.png'
    const mimeOnly = guardrail.media({
      mediaTypes: { allow: ['image/png'], allowUnknown: true },
    })
    const sourceDefaults = guardrail.media({ sources: {} })

    await expect(runOn(mimeOnly, { type: 'image', source: credentialUrl })).resolves.toEqual({ action: 'allow' })
    await expect(runOn(sourceDefaults, { type: 'image', source: credentialUrl })).resolves.toMatchObject({
      action: 'block',
    })
  })

  it('rejects non-exact authored host entries at construction', () => {
    for (const host of [
      '',
      'https://example.com',
      'example.com:443',
      'example.com/path',
      'user@example.com',
      'example.com?token=x',
      '*.example.com',
    ]) {
      expect(() => guardrail.media({ sources: { allowHosts: [host] } })).toThrow(SafetyConfigError)
    }
  })
})
