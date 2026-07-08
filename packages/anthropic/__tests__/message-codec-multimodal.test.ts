import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@use-crux/core'
import { transcriptRoundTripConformance } from '@use-crux/core/adapter/testing'
import { anthropicTranscript, fromMessages } from '../message-codec'

describe('anthropic multimodal transcript encoding', () => {
  it('serializes canonical user image content to Anthropic content blocks', () => {
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
        content: [
          { type: 'text', text: 'Inspect this chart.' },
          {
            type: 'image',
            source: {
              type: 'base64',
              data: 'base64-chart',
              media_type: 'image/png',
            },
          },
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
            content: [
              { type: 'text', text: 'Inspect this chart.' },
              {
                type: 'image',
                source: { type: 'base64', data: 'base64-chart', media_type: 'image/png' },
              },
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
              { type: 'image-url', url: 'https://example.com/chart.png' },
            ],
          },
        ],
        providerMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this chart.' },
              { type: 'image', source: { type: 'url', url: 'https://example.com/chart.png' } },
            ],
          },
        ],
        decodedMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this chart.' },
              { type: 'image-url', url: 'https://example.com/chart.png' },
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
            content: [
              {
                type: 'document',
                source: { type: 'base64', data: 'base64-pdf', media_type: 'application/pdf' },
                title: 'q2.pdf',
              },
            ],
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
            content: [
              {
                type: 'document',
                source: { type: 'url', url: 'https://example.com/q2.pdf' },
                title: 'q2.pdf',
              },
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
        name: 'audio-file-data-degrades',
        canonicalMessages: [
          { role: 'user', content: [{ type: 'file-data', data: 'base64-audio', mediaType: 'audio/mpeg' }] },
        ],
        providerMessages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '[file audio/mpeg 9B sha256:7dc2623c5c71]' }],
          },
        ],
        decodedMessages: [{ role: 'user', content: '[file audio/mpeg 9B sha256:7dc2623c5c71]' }],
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
      providerMessages: Anthropic.MessageParam[]
      decodedMessages: Message[]
    }>

    expect(
      transcriptRoundTripConformance({
        name: 'anthropic multimodal transcript',
        transcript: anthropicTranscript,
        fixtures,
      }),
    ).toEqual([])
  })

  it('throws before encoding when strict mode sees unsupported content', () => {
    expect(() =>
      anthropicTranscript.fromMessages(
        [{ role: 'user', content: [{ type: 'file-data', data: 'base64-audio', mediaType: 'audio/mpeg' }] }],
        { unsupportedContent: 'error' },
      ),
    ).toThrow('anthropic does not support file-data (audio/mpeg) for user messages')
  })

  it('throws before encoding unsupported rich tool-result content in strict mode', () => {
    expect(() =>
      anthropicTranscript.fromMessages(
        [
          {
            role: 'tool',
            content: 'fallback',
            metadata: {
              toolCallId: 'toolu_1',
              toolName: 'recordAudio',
              modelOutput: {
                type: 'content',
                value: [{ type: 'file-data', data: 'base64-audio', mediaType: 'audio/mpeg' }],
              },
            },
          },
        ],
        { unsupportedContent: 'error' },
      ),
    ).toThrow('anthropic does not support file-data (audio/mpeg) for tool messages')
  })

  it('reads assistant media blocks into canonical assistant content', () => {
    const turn = anthropicTranscript.readAssistant({
      content: [
        textBlock('Here is the chart.'),
        {
          type: 'image',
          source: { type: 'base64', data: 'base64-chart', media_type: 'image/png' },
        },
      ],
    } as unknown as Pick<Anthropic.Message, 'content'>)

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

function textBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text, citations: null }
}
