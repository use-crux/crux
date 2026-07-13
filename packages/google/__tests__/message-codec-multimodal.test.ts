import { describe, expect, it } from 'vitest'
import type { GenerateContentResponse } from '@google/genai'
import { fromMessages, googleTranscript, toMessages } from '../src/message-codec'

describe('google multimodal transcript encoding', () => {
  it('serializes final image and PDF content parts to Google parts', () => {
    expect(
      fromMessages([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this chart.' },
            { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
            { type: 'file', source: 'https://example.com/q2.pdf', mediaType: 'application/pdf', filename: 'q2.pdf' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Inspect this chart.' },
          { inlineData: { data: 'AQID', mimeType: 'image/png' } },
          { fileData: { fileUri: 'https://example.com/q2.pdf', mimeType: 'application/pdf', displayName: 'q2.pdf' } },
        ],
      },
    ])
  })

  it('lowers dedicated audio/video parts through native inline/file data parts', () => {
    expect(
      fromMessages([
        {
          role: 'user',
          content: [
            { type: 'audio', source: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' },
            { type: 'video', source: 'https://example.com/clip.mp4', mediaType: 'video/mp4' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        parts: [
          { inlineData: { data: 'AQID', mimeType: 'audio/mpeg' } },
          { fileData: { fileUri: 'https://example.com/clip.mp4', mimeType: 'video/mp4' } },
        ],
      },
    ])
  })

  it('fails before provider I/O for media URLs without a media type', () => {
    expect(() =>
      googleTranscript.fromMessages([
        {
          role: 'user',
          content: [{ type: 'file', source: 'https://example.com/q2.pdf' }],
        },
      ]),
    ).toThrow('No provider request was made.')
  })

  it('reads assistant inline data into final content parts', () => {
    const turn = googleTranscript.readAssistant({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Here is the chart.' },
              { inlineData: { data: 'AQID', mimeType: 'image/png' } },
            ],
          },
        },
      ],
    } as unknown as GenerateContentResponse)

    expect(turn).toEqual({
      text: 'Here is the chart.\n[image image/png 3B sha256:039058c6f2c0]',
      content: [
        { type: 'text', text: 'Here is the chart.' },
        { type: 'image', source: { type: 'data', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }, mediaType: 'image/png' },
      ],
      toolCalls: undefined,
    })
  })

  it('round-trips assistant media with opaque thought continuation fields', () => {
    const wire = [
      {
        role: 'model',
        parts: [
          {
            text: 'Internal thought',
            thought: true,
            thoughtSignature: 'signed-text-thought',
          },
          {
            inlineData: { data: 'AQID', mimeType: 'image/png', displayName: 'chart.png' },
            thought: true,
            thoughtSignature: 'signed-media-thought',
          },
          {
            fileData: {
              fileUri: 'https://example.com/report.pdf',
              mimeType: 'application/pdf',
              displayName: 'report.pdf',
            },
            thoughtSignature: 'signed-file-thought',
          },
        ],
      },
    ]

    const canonical = toMessages(wire)
    expect(canonical[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reasoning', text: 'Internal thought' }),
    ]))
    expect(fromMessages(canonical)).toEqual(wire)

    const turn = googleTranscript.readAssistant({
      candidates: [{ content: wire[0] }],
    } as unknown as GenerateContentResponse)
    expect(turn.text).not.toContain('Internal thought')
  })
})
