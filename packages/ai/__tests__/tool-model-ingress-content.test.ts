/** AI SDK native content projection and patch fidelity. */

import { describe, expect, it, vi } from 'vitest'
import type {
  ModelIngressGuard,
  ModelIngressPatch,
} from '@use-crux/core/adapter'
import {
  withAiSdkToolModelIngress,
  type AiSdkToolResultOutput,
} from '../src/sdk-codec/tool-model-ingress'

describe('AI SDK tool content ingress codec', () => {
  it('projects every native data and URL variant without replacing native parts', async () => {
    const parts = [
      { type: 'media' as const, data: 'b2xk', mediaType: 'image/png' },
      { type: 'image-data' as const, data: 'aW1hZ2U=', mediaType: 'image/png' },
      { type: 'image-url' as const, url: 'https://example.com/image.png' },
      {
        type: 'file-data' as const,
        data: 'ZmlsZQ==',
        mediaType: 'application/pdf',
        filename: 'report.pdf',
      },
      { type: 'file-url' as const, url: 'https://example.com/report.pdf' },
    ]
    const output = { type: 'content' as const, value: parts }
    const guard: ModelIngressGuard = vi.fn(async (input: Parameters<ModelIngressGuard>[0]) => {
      expect(input.kind).toBe('document')
      if (input.kind !== 'document') throw new Error('expected document')
      const slots = input.slots.filter((slot) => slot.kind === 'media')
      expect(slots.map((slot) => slot.subjects[0].part.type)).toEqual([
        'image',
        'image',
        'image',
        'file',
        'file',
      ])
      expect(slots[0]?.subjects[0].part.source).toBe(
        'data:image/png;base64,b2xk',
      )
      expect(slots[3]?.subjects[0].part).toMatchObject({
        type: 'file',
        filename: 'report.pdf',
        mediaType: 'application/pdf',
      })
      return emptyPatch()
    })

    const guarded = await convert(output, guard)

    expect(guarded).toBe(output)
    expect(guard).toHaveBeenCalledOnce()
    guarded.value.forEach((part, index) => expect(part).toBe(parts[index]))
  })

  it('applies keyed text and media edits to the original native array', async () => {
    const firstText = Object.freeze({
      type: 'text' as const,
      text: 'private',
      providerOptions: { test: { cache: true } },
    })
    const image = Object.freeze({
      type: 'image-data' as const,
      data: 'AQID',
      mediaType: 'image/png',
    })
    const trailingText = Object.freeze({ type: 'text' as const, text: 'tail' })
    const output = {
      type: 'content' as const,
      value: [firstText, image, trailingText],
    }
    const guard: ModelIngressGuard = async (input) => {
      expect(input.kind).toBe('document')
      return {
        kind: 'patch',
        text: new Map([['part:0', 'safe']]),
        removed: new Set(['part:1']),
      }
    }

    const guarded = await convert(output, guard)

    expect(guarded).not.toBe(output)
    expect(guarded.value).toEqual([
      {
        type: 'text',
        text: 'safe',
        providerOptions: firstText.providerOptions,
      },
      trailingText,
    ])
    expect(guarded.value[1]).toBe(trailingText)
    expect((guarded.value[0] as { providerOptions?: unknown })?.providerOptions).toBe(
      firstText.providerOptions,
    )
  })

  it('keeps custom parts opaque and reference-identical beside rewritten text', async () => {
    const providerOptions = { test: { secretSetting: 'native-only' } }
    const custom = Object.freeze({
      type: 'custom' as const,
      providerOptions,
    })
    const output = {
      type: 'content' as const,
      value: [
        { type: 'text' as const, text: 'private' },
        custom,
        { type: 'text' as const, text: 'tail' },
      ],
    }
    const guard: ModelIngressGuard = async (input) => {
      expect(input.kind).toBe('document')
      if (input.kind !== 'document') throw new Error('expected document')
      expect(input.slots[1]).toEqual({
        kind: 'opaque',
        key: 'part:1',
        descriptor: '[opaque custom]',
      })
      expect(JSON.stringify(input.slots)).not.toContain('secretSetting')
      return {
        kind: 'patch',
        text: new Map([['part:0', 'safe']]),
        removed: new Set(),
      }
    }

    const guarded = await convert(output, guard)

    expect(guarded.value[1]).toBe(custom)
    expect((guarded.value[1] as { providerOptions?: unknown })?.providerOptions).toBe(
      providerOptions,
    )
  })

  it('projects provider file records as sorted redacted callback subjects', async () => {
    const fileId = {
      ' zeta ': 'raw-zeta-id',
      alpha: 'raw-alpha-id',
      ' alpha ': 'raw-duplicate-id',
      '': 'raw-empty-id',
    }
    const native = Object.freeze({
      type: 'file-id' as const,
      fileId,
      providerOptions: { test: { native: true } },
    })
    const output = { type: 'content' as const, value: [native] }
    const guard: ModelIngressGuard = async (input) => {
      expect(input.kind).toBe('document')
      if (input.kind !== 'document') throw new Error('expected document')
      const slot = input.slots[0]
      expect(slot?.kind).toBe('media')
      if (!slot || slot.kind !== 'media') throw new Error('expected media')
      expect(slot.descriptor).toBe('[file provider-file]')
      expect(
        slot.subjects.map((subject) => {
          const source = subject.part.source
          return typeof source === 'object' &&
            source !== null &&
            'type' in source &&
            source.type === 'provider-file'
            ? source
            : undefined
        }),
      ).toEqual([
        { type: 'provider-file', provider: '<unknown>', fileId: '<redacted>' },
        { type: 'provider-file', provider: 'alpha', fileId: '<redacted>' },
        { type: 'provider-file', provider: 'zeta', fileId: '<redacted>' },
      ])
      expect(JSON.stringify(input.slots)).not.toMatch(/raw-(?:zeta|alpha|duplicate|empty)-id/)
      return emptyPatch()
    }

    const guarded = await convert(output, guard)

    expect(guarded).toBe(output)
    expect(guarded.value[0]).toBe(native)
    expect(native.fileId).toBe(fileId)
  })

  it('projects scalar file IDs with the normalized active provider', async () => {
    const parts = [
      { type: 'image-file-id' as const, fileId: 'raw-image-id' },
      { type: 'file-id' as const, fileId: 'raw-file-id' },
    ]
    const output = { type: 'content' as const, value: parts }
    const guard: ModelIngressGuard = async (input) => {
      expect(input.kind).toBe('document')
      if (input.kind !== 'document') throw new Error('expected document')
      expect(
        input.slots.map((slot) => {
          if (slot.kind !== 'media') throw new Error('expected media')
          const source = slot.subjects[0].part.source
          return {
            descriptor: slot.descriptor,
            source,
          }
        }),
      ).toEqual([
        {
          descriptor: '[image provider-file]',
          source: {
            type: 'provider-file',
            provider: 'openai',
            fileId: '<redacted>',
          },
        },
        {
          descriptor: '[file provider-file]',
          source: {
            type: 'provider-file',
            provider: 'openai',
            fileId: '<redacted>',
          },
        },
      ])
      expect(JSON.stringify(input.slots)).not.toMatch(/raw-(?:image|file)-id/)
      return emptyPatch()
    }

    const guarded = await convert(output, guard, ' openai ')

    expect(guarded).toBe(output)
    guarded.value.forEach((part, index) => expect(part).toBe(parts[index]))
  })
})

async function convert<T extends AiSdkToolResultOutput>(
  output: T,
  guard: ModelIngressGuard,
  provider = 'openai',
): Promise<T> {
  const tools = withAiSdkToolModelIngress(
    {
      lookup: {
        execute: async () => 'raw',
        toModelOutput: () => output,
      },
    },
    guard,
    { provider },
  )
  const converter = (tools.lookup as {
    toModelOutput: (args: {
      toolCallId: string
      input: unknown
      output: unknown
    }) => Promise<AiSdkToolResultOutput>
  }).toModelOutput
  return converter({ toolCallId: 'call-1', input: {}, output: 'raw' }) as Promise<T>
}

function emptyPatch(): ModelIngressPatch {
  return { kind: 'patch', text: new Map(), removed: new Set() }
}
