/**
 * Core owns canonical transcript semantics: extracting neutral units from
 * `Message[]`, reconstructing `Message[]` from units, appending a tool round
 * exactly once, and rendering tool-result helpers. These laws are provider
 * independent, so they are proved here once rather than in every codec.
 */

import { describe, expect, it } from 'vitest'
import type { Message } from '../../messages'
import {
  appendCanonicalToolRound,
  createToolResultEncodingHelpers,
  messagesToTranscriptUnits,
  transcriptUnitsToMessages,
} from '../../adapter/native-chat/transcript'
import type { ProviderToolResult } from '../../adapter/native-chat/transcript'
import type { ToolResultEntry } from '../../adapter/types'

describe('messagesToTranscriptUnits', () => {
  it('maps system and user messages to text units', () => {
    const units = messagesToTranscriptUnits([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Hi' },
    ])

    expect(units).toEqual([
      { kind: 'text', role: 'system', text: 'Be terse.' },
      { kind: 'text', role: 'user', text: 'Hi' },
    ])
  })

  it('reads assistant tool calls from metadata into an assistant unit', () => {
    const units = messagesToTranscriptUnits([
      {
        role: 'assistant',
        content: 'I will check.',
        metadata: {
          toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
        },
      },
    ])

    expect(units).toEqual([
      {
        kind: 'assistant',
        text: 'I will check.',
        toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
      },
    ])
  })

  it('omits the toolCalls key for assistant messages without tool calls', () => {
    const units = messagesToTranscriptUnits([{ role: 'assistant', content: 'Done.' }])

    expect(units).toEqual([{ kind: 'assistant', text: 'Done.' }])
  })

  it('groups adjacent tool messages into a single tool-results unit', () => {
    const units = messagesToTranscriptUnits([
      toolMessage('tc_1', 'weather', '18C', {
        type: 'json',
        value: { temp: 18 },
      }),
      toolMessage('tc_2', 'search', 'no hits', { type: 'error-text', value: 'no hits' }, { isError: true }),
      { role: 'user', content: 'thanks' },
    ])

    expect(units).toEqual([
      {
        kind: 'tool-results',
        results: [
          {
            toolCallId: 'tc_1',
            toolName: 'weather',
            text: '18C',
            modelOutput: { type: 'json', value: { temp: 18 } },
          },
          {
            toolCallId: 'tc_2',
            toolName: 'search',
            text: 'no hits',
            modelOutput: { type: 'error-text', value: 'no hits' },
            isError: true,
          },
        ],
      },
      { kind: 'text', role: 'user', text: 'thanks' },
    ])
  })
})

describe('transcriptUnitsToMessages', () => {
  it('reconstructs canonical messages from neutral units', () => {
    const messages = transcriptUnitsToMessages([
      { kind: 'text', role: 'user', text: 'Hi' },
      {
        kind: 'assistant',
        text: 'On it',
        toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
      },
      {
        kind: 'tool-results',
        results: [
          {
            toolCallId: 'tc_1',
            toolName: 'weather',
            text: '18C',
            isError: true,
          },
        ],
      },
    ])

    expect(messages).toEqual([
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: 'On it',
        metadata: {
          toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
        },
      },
      {
        role: 'tool',
        content: '18C',
        metadata: { toolCallId: 'tc_1', toolName: 'weather', isError: true },
      },
    ])
  })

  it('round-trips canonical messages through units', () => {
    const messages: Message[] = [
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Weather?' },
      {
        role: 'assistant',
        content: 'Checking',
        metadata: {
          toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
        },
      },
      {
        role: 'tool',
        content: '{"temp":18}',
        metadata: {
          toolCallId: 'tc_1',
          toolName: 'weather',
          modelOutput: { type: 'json', value: { temp: 18 } },
        },
      },
    ]

    expect(transcriptUnitsToMessages(messagesToTranscriptUnits(messages))).toEqual(messages)
  })
})

describe('appendCanonicalToolRound', () => {
  it('appends the assistant turn and one tool message per result exactly once', () => {
    const result: ToolResultEntry = {
      toolCallId: 'tc_1',
      name: 'weather',
      output: { temp: 18 },
      modelOutput: { type: 'json', value: { temp: 18 } },
      content: '{"temp":18}',
      outputSize: 11,
      modelOutputSize: 11,
    }

    const appended = appendCanonicalToolRound(
      [{ role: 'user', content: 'Weather?' }],
      {
        text: 'Checking',
        toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
      },
      [result],
    )

    expect(appended).toEqual([
      { role: 'user', content: 'Weather?' },
      {
        role: 'assistant',
        content: 'Checking',
        metadata: {
          toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
        },
      },
      {
        role: 'tool',
        content: '{"temp":18}',
        metadata: {
          toolCallId: 'tc_1',
          toolName: 'weather',
          modelOutput: { type: 'json', value: { temp: 18 } },
        },
      },
    ])
  })

  it('preserves error metadata on appended tool messages', () => {
    const result: ToolResultEntry = {
      toolCallId: 'tc_1',
      name: 'publish',
      modelOutput: { type: 'error-text', value: 'boom' },
      content: 'boom',
      outputSize: 4,
      modelOutputSize: 4,
      isError: true,
      modelOutputError: 'boom',
    }

    const appended = appendCanonicalToolRound([], { text: '', toolCalls: undefined }, [result])

    expect(appended).toEqual([
      { role: 'assistant', content: '' },
      {
        role: 'tool',
        content: 'boom',
        metadata: {
          toolCallId: 'tc_1',
          toolName: 'publish',
          modelOutput: { type: 'error-text', value: 'boom' },
          isError: true,
          modelOutputError: 'boom',
        },
      },
    ])
  })
})

describe('createToolResultEncodingHelpers', () => {
  const helpers = createToolResultEncodingHelpers()

  it('renders plain text from the result text', () => {
    expect(helpers.plainText(result({ text: 'hello' }))).toBe('hello')
  })

  it('exposes content parts only for content model output', () => {
    expect(
      helpers.contentParts(
        result({
          modelOutput: {
            type: 'content',
            value: [{ type: 'text', text: 'x' }],
          },
        }),
      ),
    ).toEqual([{ type: 'text', text: 'x' }])
    expect(helpers.contentParts(result({ modelOutput: { type: 'json', value: { a: 1 } } }))).toBeUndefined()
    expect(helpers.contentParts(result({}))).toBeUndefined()
  })

  it('flags errors from error model outputs or the explicit error flag', () => {
    expect(helpers.errorFlag(result({ modelOutput: { type: 'error-text', value: 'x' } }))).toBe(true)
    expect(helpers.errorFlag(result({ modelOutput: { type: 'error-json', value: { e: 1 } } }))).toBe(true)
    expect(helpers.errorFlag(result({ isError: true }))).toBe(true)
    expect(helpers.errorFlag(result({ modelOutput: { type: 'execution-denied', reason: 'no' } }))).toBe(false)
    expect(helpers.errorFlag(result({ modelOutput: { type: 'json', value: {} } }))).toBe(false)
  })
})

function toolMessage(
  toolCallId: string,
  toolName: string,
  content: string,
  modelOutput: NonNullable<ProviderToolResult['modelOutput']>,
  extra?: { isError?: boolean; modelOutputError?: string },
): Message {
  return {
    role: 'tool',
    content,
    metadata: {
      toolCallId,
      toolName,
      modelOutput,
      ...(extra?.isError !== undefined ? { isError: extra.isError } : {}),
      ...(extra?.modelOutputError !== undefined ? { modelOutputError: extra.modelOutputError } : {}),
    },
  }
}

function result(overrides: Partial<ProviderToolResult>): ProviderToolResult {
  return { toolCallId: 'tc_1', text: '', ...overrides }
}
