import { describe, expect, it } from 'vitest'
import type { AssistantContentPart } from '../../src'
import { replaceTextSlots } from '../../src/adapter/execution/stream-content'

describe('stream completion content reconstruction', () => {
  it('replaces text slots in place without changing provider metadata or non-text parts', () => {
    const content = [
      {
        type: 'text',
        text: 'unsafe',
        providerOptions: { google: { continuation: { thoughtSignature: 'signed' } } },
      },
      { type: 'image', source: 'data:image/png;base64,AQID' },
      { type: 'text', text: 'WORLD' },
    ] as const satisfies readonly AssistantContentPart[]

    expect(replaceTextSlots(content, ['[REDACTED]', 'WORLD'])).toEqual([
      {
        type: 'text',
        text: '[REDACTED]',
        providerOptions: content[0].providerOptions,
      },
      content[1],
      { type: 'text', text: 'WORLD' },
    ])
  })

  it('uses safe streamed text when a provider completion has no text slot', () => {
    const image = {
      type: 'image',
      source: 'data:image/png;base64,AQID',
    } as const satisfies AssistantContentPart

    expect(replaceTextSlots([image], [], '[REDACTED]')).toEqual([
      { type: 'text', text: '[REDACTED]' },
      image,
    ])
  })

  it('fails closed instead of restoring a provider slot when a replacement is missing', () => {
    expect(() => replaceTextSlots([{ type: 'text', text: 'unsafe' }], [])).toThrow(
      'Stream completion text-slot mismatch: expected 1, received 0.',
    )
  })
})
