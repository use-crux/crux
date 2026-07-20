/** Composite media policy aggregation and enforcement behavior. */

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

describe('guardrail.media — composition', () => {
  it('aggregates type, size, and source failures in stable order', async () => {
    const run = guardrail.media({
      mediaTypes: { allow: ['image/png'] },
      size: { maxBytes: 3 },
      sources: { allowHosts: ['cdn.example.com'] },
    })
    const source = {
      type: 'url' as const,
      url: new URL('https://private.example.net/report.pdf'),
      size: 4,
    }

    await expect(runOn(run, {
      type: 'file', source, mediaType: 'application/pdf',
    })).resolves.toEqual({
      action: 'block',
      reason: 'Media attachment violates policy: media type "application/pdf" is not allowed; media size 4 bytes exceeds the 3 byte limit; media source host is not allowed.',
    })
  })

  it('uses explicit strip while preserving allowed siblings', async () => {
    const blocked = { type: 'image', source: new Uint8Array([1]) } as const
    const allowed = { type: 'file', source: 'https://example.com/report.pdf' } as const
    const policy = guardrail({
      id: 'strip-inline',
      on: boundary.input.media(),
      run: guardrail.media({
        sources: { allowInline: false },
        action: 'strip',
      }),
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const result = await safety.guardInput({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Keep.' }, blocked, allowed] }],
    })

    expect(result.messages[0]?.content).toEqual([{ type: 'text', text: 'Keep.' }, allowed])
  })

  it('escalates an enforced final-part strip through the existing boundary', async () => {
    const policy = guardrail({
      id: 'strip-only-inline',
      on: boundary.input.media(),
      run: guardrail.media({ sources: { allowInline: false }, action: 'strip' }),
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(safety.guardInput({
      messages: [{ role: 'user', content: [{ type: 'image', source: new Uint8Array([1]) }] }],
    })).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(safety.audit.guardrails?.applied[0]).toMatchObject({
      action: 'strip',
      escalatedToBlock: true,
      location: {
        origin: { kind: 'message', messageIndex: 0, partIndex: 0 },
        partType: 'image',
      },
    })
  })

  it.each(['block', 'strip'] as const)('reports %s intent without enforcement', async (action) => {
    const part = { type: 'image', source: new Uint8Array([1]) } as const
    const policy = guardrail({
      id: `report-${action}`,
      on: boundary.input.media(),
      mode: 'report',
      run: guardrail.media({ sources: { allowInline: false }, action }),
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })
    const messages = [{ role: 'user' as const, content: [part] }]

    const result = await safety.guardInput({ messages })

    expect(result.messages).toBe(messages)
    expect(safety.audit.guardrails?.applied[0]).toMatchObject({ mode: 'report', action })
  })

  it('rejects malformed unsafe-cast configuration before callback execution', () => {
    const invalid = [
      {},
      { action: 'warn', sources: {} },
      { mediaTypes: { allow: ['image/png'], allowUnknown: 'yes' } },
      { size: { maxBytes: 1, allowUnknown: 1 } },
      { sources: { allowInline: 'yes' } },
      { sources: { allowHosts: 'example.com' } },
      { sources: [] },
      { sources: new Date() },
      { sources: new Map() },
    ]
    for (const options of invalid) {
      expect(() => guardrail.media(options as never)).toThrow(SafetyConfigError)
    }
  })

  it.each([
    { options: { sources: {}, actoin: 'strip' }, field: 'actoin' },
    {
      options: { mediaTypes: { allow: ['image/png'], allowUnkown: true } },
      field: 'mediaTypes.allowUnkown',
    },
    { options: { size: { maxBytes: 1, maxByte: 2 } }, field: 'size.maxByte' },
    {
      options: { sources: { allowInline: true, allowInlne: false } },
      field: 'sources.allowInlne',
    },
  ])('rejects the unknown configuration field $field', ({ options, field }) => {
    expect(() => guardrail.media(options as never)).toThrow(
      `guardrail.media() configuration is invalid: ${field} is not supported.`,
    )
  })

  it('isolates behavior and metadata from caller mutation', async () => {
    const allowHosts = ['cdn.example.com']
    const options = {
      sources: { allowHosts, allowInline: false },
      action: 'block' as const,
    }
    const run = guardrail.media(options)

    allowHosts[0] = 'private.example.net'
    options.sources.allowInline = true

    await expect(runOn(run, {
      type: 'image', source: new Uint8Array([1]),
    })).resolves.toMatchObject({ action: 'block' })
    expect(run.strategy.config).toEqual({
      sources: {
        allowHosts: ['cdn.example.com'],
        allowInline: false,
        allowProviderFiles: true,
        allowUrlUserInfo: false,
        allowUrlQuery: true,
      },
      action: 'block',
    })
    expect(Object.isFrozen(run.strategy.config.sources)).toBe(true)
    expect(Object.isFrozen(run.strategy.config.sources.allowHosts)).toBe(true)
  })
})
