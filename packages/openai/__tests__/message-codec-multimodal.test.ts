import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { Message } from '@use-crux/core'
import { transcriptRoundTripConformance } from '@use-crux/core/adapter/testing'
import { fromMessages, openAITranscript } from '../message-codec'

describe('openai multimodal transcript encoding', () => {
  it('serializes canonical user image content to OpenAI chat content parts', () => {
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
          { type: 'image_url', image_url: { url: 'data:image/png;base64,base64-chart' } },
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
              { type: 'image_url', image_url: { url: 'data:image/png;base64,base64-chart' } },
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
              { type: 'image_url', image_url: { url: 'https://example.com/chart.png' } },
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
            content: [{ type: 'file', file: { file_data: 'base64-pdf', filename: 'q2.pdf' } }],
          },
        ],
        decodedMessages: [
          {
            role: 'user',
            content: [{ type: 'file-data', data: 'base64-pdf', mediaType: 'application/octet-stream', filename: 'q2.pdf' }],
          },
        ],
      },
      {
        name: 'pdf-file-url-degrades',
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
            content: [{ type: 'text', text: '[file application/pdf "q2.pdf" https://example.com/q2.pdf]' }],
          },
        ],
        decodedMessages: [{ role: 'user', content: '[file application/pdf "q2.pdf" https://example.com/q2.pdf]' }],
      },
      {
        name: 'audio-file-data',
        canonicalMessages: [
          { role: 'user', content: [{ type: 'file-data', data: 'base64-audio', mediaType: 'audio/mpeg' }] },
        ],
        providerMessages: [
          {
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: 'base64-audio', format: 'mp3' } }],
          },
        ],
        decodedMessages: [{ role: 'user', content: [{ type: 'file-data', data: 'base64-audio', mediaType: 'audio/mpeg' }] }],
      },
      {
        name: 'unsupported-audio-file-data-degrades',
        canonicalMessages: [
          { role: 'user', content: [{ type: 'file-data', data: 'base64-audio', mediaType: 'audio/ogg' }] },
        ],
        providerMessages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '[file audio/ogg 9B sha256:7dc2623c5c71]' }],
          },
        ],
        decodedMessages: [{ role: 'user', content: '[file audio/ogg 9B sha256:7dc2623c5c71]' }],
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
        providerMessages: [
          { role: 'system', content: 'System text.\n[image image/png 9B sha256:f488d587b7cd]' },
        ],
        decodedMessages: [{ role: 'system', content: 'System text.\n[image image/png 9B sha256:f488d587b7cd]' }],
      },
    ] satisfies Array<{
      name: string
      canonicalMessages: Message[]
      providerMessages: OpenAI.ChatCompletionMessageParam[]
      decodedMessages: Message[]
    }>

    expect(
      transcriptRoundTripConformance({
        name: 'openai multimodal transcript',
        transcript: openAITranscript,
        fixtures,
      }),
    ).toEqual([])
  })

  it('throws before encoding when strict mode sees unsupported content', () => {
    expect(() =>
      openAITranscript.fromMessages(
        [{ role: 'user', content: [{ type: 'file-url', url: 'https://example.com/q2.pdf', mediaType: 'application/pdf' }] }],
        { unsupportedContent: 'error' },
      ),
    ).toThrow('openai does not support file-url (application/pdf) for user messages')
  })

  it('reads assistant content parts into canonical assistant content', () => {
    const turn = openAITranscript.readAssistant({
      choices: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Here is the chart.' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,base64-chart' } },
            ],
          },
        },
      ],
    } as unknown as ChatCompletion)

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
