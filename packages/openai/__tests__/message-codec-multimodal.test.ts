import { describe, expect, it } from 'vitest'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { fromMessages, openAITranscript } from '../src/message-codec'

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
