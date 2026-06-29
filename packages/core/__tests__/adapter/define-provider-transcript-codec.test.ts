/**
 * `defineProviderTranscriptCodec()` should drive `fromMessages`, `toMessages`,
 * `readAssistant`, and tool-round append through a single dialect, applying the
 * canonical unit extraction and `OneOrMany` fan-out for the dialect.
 */

import { describe, expect, it } from 'vitest'
import { defineProviderTranscriptCodec } from '../../adapter/native-chat/transcript'
import type { ProviderTranscriptDialect, ProviderTranscriptUnit } from '../../adapter/native-chat/transcript'
import type { ToolResultEntry } from '../../adapter/types'

interface WireMessage {
  readonly role: string
  readonly text: string
}

/** A minimal dialect: drops system turns, fans tool results out one message each. */
const dialect: ProviderTranscriptDialect<WireMessage, { readonly text: string }> = {
  encodeText: ({ role, text }) => (role === 'system' ? undefined : { role, text }),
  encodeAssistant: ({ text, toolCalls }) => ({
    role: 'assistant',
    text: toolCalls?.length ? `${text}[${toolCalls.map((c) => c.name).join(',')}]` : text,
  }),
  encodeToolResults: ({ results }, helpers) =>
    results.map((result) => ({
      role: 'tool',
      text: helpers.errorFlag(result) ? `ERR:${helpers.plainText(result)}` : helpers.plainText(result),
    })),
  decodeMessage: (value): ProviderTranscriptUnit | undefined => {
    if (typeof value !== 'object' || value === null) return undefined
    const message = value as WireMessage
    if (message.role === 'tool') {
      return {
        kind: 'tool-results',
        results: [{ toolCallId: 'tc_1', text: message.text }],
      }
    }
    if (message.role === 'assistant') return { kind: 'assistant', text: message.text }
    return { kind: 'text', role: 'user', text: message.text }
  },
  readAssistant: (raw) => ({ text: raw.text, toolCalls: undefined }),
}

const codec = defineProviderTranscriptCodec(dialect)

describe('defineProviderTranscriptCodec', () => {
  it('drops dropped units and fans tool results out through the dialect', () => {
    const wire = codec.fromMessages([
      { role: 'system', content: 'ignored' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'using tools',
        metadata: { toolCalls: [{ id: 'tc_1', name: 'search', args: {} }] },
      },
      {
        role: 'tool',
        content: 'ok',
        metadata: { toolCallId: 'tc_1', toolName: 'search' },
      },
      {
        role: 'tool',
        content: 'boom',
        metadata: {
          toolCallId: 'tc_2',
          toolName: 'fail',
          modelOutput: { type: 'error-text', value: 'boom' },
        },
      },
    ])

    expect(wire).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'using tools[search]' },
      { role: 'tool', text: 'ok' },
      { role: 'tool', text: 'ERR:boom' },
    ])
  })

    it('decodes provider messages back into canonical messages', () => {
    const messages = codec.toMessages([
      { role: 'user', text: 'hi' },
      { role: 'tool', text: 'result' },
    ])

    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'tool', content: 'result', metadata: { toolCallId: 'tc_1' } },
    ])
  })

    it('reads an assistant turn from the raw response', () => {
    expect(codec.readAssistant({ text: 'answer' })).toEqual({
      text: 'answer',
      toolCalls: undefined,
    })
  })

    it('exposes the canonical tool-round append', () => {
    const result: ToolResultEntry = {
      toolCallId: 'tc_1',
      name: 'search',
      modelOutput: { type: 'text', value: 'done' },
      content: 'done',
      outputSize: 4,
      modelOutputSize: 4,
    }

    expect(
      codec.appendToolRound?.([], { text: '', toolCalls: [{ id: 'tc_1', name: 'search', args: {} }] }, [result]),
    ).toEqual([
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: [{ id: 'tc_1', name: 'search', args: {} }] },
      },
      {
        role: 'tool',
        content: 'done',
        metadata: {
          toolCallId: 'tc_1',
          toolName: 'search',
          modelOutput: { type: 'text', value: 'done' },
        },
      },
    ])
  })
})
