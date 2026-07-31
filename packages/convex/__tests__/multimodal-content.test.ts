import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenizer } from '@use-crux/core'
import { mediaConformanceFixture } from '@use-crux/core/adapter/testing'
import { afterPreparedAgentCall } from '../src/agent/lifecycle-persistence'
import { contentText, messageText, textPart } from '../src'

afterEach(() => {
  setTokenizer((text) => Math.ceil(text.length / 4))
  vi.restoreAllMocks()
})

describe('@use-crux/convex multimodal content helpers', () => {
  it('re-exports the core content builders and projection helpers', () => {
    const content = mediaConformanceFixture('convex-agent').supported[0]!.content

    expect(contentText(content)).toContain('[image image/png 3B sha256:')
    expect(messageText({ content })).toBe(contentText(content))
  })

  it('captures Convex Agent multimodal user messages with media placeholders', async () => {
    const capturedTurns: Array<{ readonly messages: readonly { readonly role: string; readonly content: string }[] }> = []
    const captureTurn = vi.fn(async (turn: { readonly messages: readonly { readonly role: string; readonly content: string }[] }) => {
      capturedTurns.push(turn)
    })
    const flush = vi.fn(async () => undefined)

    await afterPreparedAgentCall({
      resolved: {
        settings: {},
        memoryBindings: [{ memory: { captureTurn, flush } }],
      } as never,
      input: {},
      result: { text: 'assistant reply' },
      captureMessages: [
        {
          role: 'user',
          content: [textPart('remember this chart'), { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }],
        },
      ],
    })

    const captured = capturedTurns[0]

    expect(captured?.messages[0]).toEqual({
      role: 'user',
      content: expect.stringContaining('remember this chart'),
    })
    expect(captured?.messages[0]?.content).toContain('[image image/png 3B sha256:')
    expect(captured?.messages[0]?.content).not.toContain('AQID')
  })
})
