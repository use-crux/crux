import { describe, expect, it } from 'vitest'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { ContentPart } from '@use-crux/core'
import { fromMessages, openAITranscript, toMessages } from '../src/message-codec'

describe('openai multimodal transcript encoding', () => {
  it('serializes final image content parts to OpenAI chat content', () => {
    expect(
      fromMessages([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this chart.' },
            { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this chart.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        ],
      },
    ])
  })

  it('fails before provider I/O for unsupported file URLs', () => {
    expect(() =>
      openAITranscript.fromMessages([
        {
          role: 'user',
          content: [{ type: 'file', source: 'https://example.com/q2.pdf', mediaType: 'application/pdf' }],
        },
      ]),
    ).toThrow('No provider request was made.')
  })

  it('lowers audio content natively and fails video before provider I/O', () => {
    expect(
      fromMessages([
        {
          role: 'user',
          content: [{ type: 'audio', source: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' }],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: 'AQID', format: 'mp3' } }],
      },
    ])

    expect(() =>
      openAITranscript.fromMessages([
        {
          role: 'user',
          content: [{ type: 'video', source: new Uint8Array([1, 2, 3]), mediaType: 'video/mp4' }],
        },
      ]),
    ).toThrow('No provider request was made.')
  })

  it('decodes native input audio as canonical audio', () => {
    expect(
      toMessages([
        {
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: 'AQID', format: 'mp3' } }],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'audio',
            source: expect.objectContaining({ type: 'data', mediaType: 'audio/mpeg' }),
            mediaType: 'audio/mpeg',
          },
        ],
      },
    ])
  })

  it.each([
    ['wav', 'audio/wav'],
    ['aac', 'audio/aac'],
    ['mp3', 'audio/mpeg'],
    ['flac', 'audio/flac'],
    ['opus', 'audio/opus'],
    ['pcm16', 'audio/pcm'],
  ] as const)('recovers honest generated-audio MIME for %s', (format, mediaType) => {
    const turn = generatedAudioTurn(format)

    expect(turn.content).toContainEqual(expect.objectContaining({
      type: 'audio',
      mediaType,
      providerOptions: { openai: { audioFormat: format, audioId: 'audio_1' } },
    }))
  })

  it('makes generated mp3 audio immediately reusable as input', () => {
    const turn = generatedAudioTurn('mp3')

    expect(
      fromMessages([
        {
          role: 'user',
          content: (turn.content ?? []) as readonly ContentPart[],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Listen' },
          { type: 'input_audio', input_audio: { data: 'AQID', format: 'mp3' } },
        ],
      },
    ])
  })

  it('encodes generated assistant audio by its native id during tool continuation', () => {
    const turn = generatedAudioTurn('pcm16')
    const next = openAITranscript.appendToolRound?.([], {
      ...turn,
      toolCalls: [{ id: 'tc_1', name: 'inspect', args: { page: 1 } }],
    }, [{
      toolCallId: 'tc_1',
      name: 'inspect',
      content: 'done',
      modelOutput: { type: 'text', value: 'done' },
      outputSize: 4,
      modelOutputSize: 4,
    }]) ?? []

    expect(fromMessages(next)).toEqual([
      {
        role: 'assistant',
        content: 'Listen',
        audio: { id: 'audio_1' },
        tool_calls: [{
          id: 'tc_1',
          type: 'function',
          function: { name: 'inspect', arguments: '{"page":1}' },
        }],
      },
      { role: 'tool', content: 'done', tool_call_id: 'tc_1' },
    ])
  })

  it('reads assistant image content into final content parts', () => {
    const turn = openAITranscript.readAssistant({
      choices: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Here is the chart.' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
            ],
          },
        },
      ],
    } as unknown as ChatCompletion)

    expect(turn).toEqual({
      text: 'Here is the chart.\n[image data:image/png]',
      content: [
        { type: 'text', text: 'Here is the chart.' },
        { type: 'image', source: 'data:image/png;base64,AQID' },
      ],
      toolCalls: undefined,
    })
  })
})

function generatedAudioTurn(format: 'wav' | 'aac' | 'mp3' | 'flac' | 'opus' | 'pcm16') {
  return openAITranscript.readAssistant(
    {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Listen',
          audio: { id: 'audio_1', data: 'AQID' },
        },
      }],
    } as unknown as ChatCompletion,
    { request: { audio: { format, voice: 'alloy' } } },
  )
}
