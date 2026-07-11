import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropicTranscript, fromMessages } from '../src/message-codec'

describe('anthropic multimodal transcript encoding', () => {
  it('serializes final image and PDF content parts to Anthropic blocks', () => {
    expect(
      fromMessages([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this chart.' },
            { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
            { type: 'file', source: new Uint8Array([4, 5]), mediaType: 'application/pdf', filename: 'q2.pdf' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this chart.' },
          { type: 'image', source: { type: 'base64', data: 'AQID', media_type: 'image/png' } },
          {
            type: 'document',
            source: { type: 'base64', data: 'BAU=', media_type: 'application/pdf' },
            title: 'q2.pdf',
          },
        ],
      },
    ])
  })

  it('fails before provider I/O for unsupported audio files', () => {
    expect(() =>
      anthropicTranscript.fromMessages([
        {
          role: 'user',
          content: [{ type: 'file', source: new Uint8Array([1]), mediaType: 'audio/mpeg' }],
        },
      ]),
    ).toThrow('No provider request was made.')
  })

  it('fails before provider I/O for dedicated audio and video parts', () => {
    expect(() =>
      anthropicTranscript.fromMessages([
        {
          role: 'user',
          content: [{ type: 'audio', source: new Uint8Array([1]), mediaType: 'audio/mpeg' }],
        },
      ]),
    ).toThrow('No provider request was made.')

    expect(() =>
      anthropicTranscript.fromMessages([
        {
          role: 'user',
          content: [{ type: 'video', source: new Uint8Array([1]), mediaType: 'video/mp4' }],
        },
      ]),
    ).toThrow('No provider request was made.')
  })

  it('reads assistant image blocks into final content parts', () => {
    const turn = anthropicTranscript.readAssistant({
      content: [
        textBlock('Here is the chart.'),
        { type: 'image', source: { type: 'base64', data: 'AQID', media_type: 'image/png' } },
      ],
    } as unknown as Pick<Anthropic.Message, 'content'>)

    expect(turn).toEqual({
      text: 'Here is the chart.\n[image image/png 3B sha256:039058c6f2c0]',
      content: [
        { type: 'text', text: 'Here is the chart.' },
        { type: 'image', source: { type: 'data', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }, mediaType: 'image/png' },
      ],
      toolCalls: undefined,
    })
  })
})

function textBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text, citations: null }
}
