import { describe, expect, it } from 'vitest'
import type { Content, GenerateContentResponse } from '@google/genai'
import type { Message } from '@use-crux/core'
import { transcriptRoundTripConformance } from '@use-crux/core/adapter/testing'
import { fromMessages, googleTranscript } from '../message-codec'

describe('google multimodal transcript encoding', () => {
  it('serializes canonical user image content to Google parts', () => {
    const messages = fromMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this chart.' },
          { type: 'image-data', data: 'base64-chart', mediaType: 'image/png' },
        ],
      },
    ])

    expect(messages).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Inspect this chart.' },
          { inlineData: { data: 'base64-chart', mimeType: 'image/png' } },
        ],
      },
    ])
  })

  it('passes the shared multimodal transcript round-trip fixtures', () => {
    const fixtures = [
      {
        name: 'image-data',
        canonicalMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this chart.' },
              { type: 'image-data', data: 'base64-chart', mediaType: 'image/png' },
            ],
          },
        ],
        providerMessages: [
          {
            role: 'user',
            parts: [
              { text: 'Inspect this chart.' },
              { inlineData: { data: 'base64-chart', mimeType: 'image/png' } },
            ],
          },
        ],
        decodedMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this chart.' },
              { type: 'image-data', data: 'base64-chart', mediaType: 'image/png' },
            ],
          },
        ],
      },
      {
        name: 'image-url',
        canonicalMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this chart.' },
              { type: 'image-url', url: 'https://example.com/chart.png', mediaType: 'image/png' },
            ],
          },
        ],
        providerMessages: [
          {
            role: 'user',
            parts: [
              { text: 'Inspect this chart.' },
              { fileData: { fileUri: 'https://example.com/chart.png', mimeType: 'image/png' } },
            ],
          },
        ],
        decodedMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this chart.' },
              { type: 'file-url', url: 'https://example.com/chart.png', mediaType: 'image/png' },
            ],
          },
        ],
      },
      {
        name: 'pdf-file-data',
        canonicalMessages: [
          {
            role: 'user',
            content: [{ type: 'file-data', data: 'base64-pdf', mediaType: 'application/pdf', filename: 'q2.pdf' }],
          },
        ],
        providerMessages: [
          {
            role: 'user',
            parts: [{ inlineData: { data: 'base64-pdf', mimeType: 'application/pdf', displayName: 'q2.pdf' } }],
          },
        ],
        decodedMessages: [
          {
            role: 'user',
            content: [{ type: 'file-data', data: 'base64-pdf', mediaType: 'application/pdf', filename: 'q2.pdf' }],
          },
        ],
      },
      {
        name: 'pdf-file-url',
        canonicalMessages: [
          {
            role: 'user',
            content: [
              { type: 'file-url', url: 'https://example.com/q2.pdf', mediaType: 'application/pdf', filename: 'q2.pdf' },
            ],
          },
        ],
        providerMessages: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: 'https://example.com/q2.pdf', mimeType: 'application/pdf', displayName: 'q2.pdf' } },
            ],
          },
        ],
        decodedMessages: [
          {
            role: 'user',
            content: [
              { type: 'file-url', url: 'https://example.com/q2.pdf', mediaType: 'application/pdf', filename: 'q2.pdf' },
            ],
          },
        ],
      },
      {
        name: 'url-without-media-type-degrades',
        canonicalMessages: [
          { role: 'user', content: [{ type: 'file-url', url: 'https://example.com/q2.pdf', filename: 'q2.pdf' }] },
        ],
        providerMessages: [
          {
            role: 'user',
            parts: [{ text: '[file "q2.pdf" https://example.com/q2.pdf]' }],
          },
        ],
        decodedMessages: [{ role: 'user', content: '[file "q2.pdf" https://example.com/q2.pdf]' }],
      },
      {
        name: 'system-role-media-degrades',
        canonicalMessages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'System text.' },
              { type: 'image-data', data: 'base64-chart', mediaType: 'image/png' },
            ],
          },
        ],
        providerMessages: [],
        decodedMessages: [],
      },
    ] satisfies Array<{
      name: string
      canonicalMessages: Message[]
      providerMessages: Content[]
      decodedMessages: Message[]
    }>

    expect(
      transcriptRoundTripConformance({
        name: 'google multimodal transcript',
        transcript: googleTranscript,
        fixtures,
      }),
    ).toEqual([])
  })

  it('throws before encoding when strict mode sees unsupported content', () => {
    expect(() =>
      googleTranscript.fromMessages(
        [{ role: 'user', content: [{ type: 'file-url', url: 'https://example.com/q2.pdf' }] }],
        { unsupportedContent: 'error' },
      ),
    ).toThrow('google does not support file-url for user messages')
  })

  it('reads assistant inline data into canonical assistant content', () => {
    const turn = googleTranscript.readAssistant({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Here is the chart.' },
              { inlineData: { data: 'base64-chart', mimeType: 'image/png' } },
            ],
          },
        },
      ],
    } as unknown as GenerateContentResponse)

    expect(turn).toEqual({
      text: 'Here is the chart.\n[image image/png 9B sha256:f488d587b7cd]',
      content: [
        { type: 'text', text: 'Here is the chart.' },
        { type: 'image-data', data: 'base64-chart', mediaType: 'image/png' },
      ],
      toolCalls: undefined,
    })
  })
})
