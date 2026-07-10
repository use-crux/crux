import { describe, expect, it, vi } from 'vitest'
import { normalizeAiSdkMessages } from '../src/messages'

describe('AI SDK message normalization', () => {
  it('normalizes SDK text, image, and file parts into canonical content parts', () => {
    const messages = normalizeAiSdkMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Compare these.' },
          {
            type: 'image',
            image: 'AQID',
            mediaType: 'image/png',
            providerOptions: { openai: { detail: 'low' } },
          },
          {
            type: 'file',
            data: new URL('https://example.com/report.pdf'),
            mediaType: 'application/pdf',
            filename: 'report.pdf',
          },
        ],
      },
    ])

    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Compare these.' },
          {
            type: 'image',
            source: { type: 'data', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
            mediaType: 'image/png',
            providerOptions: { openai: { detail: 'low' } },
          },
          {
            type: 'file',
            source: new URL('https://example.com/report.pdf'),
            mediaType: 'application/pdf',
            filename: 'report.pdf',
          },
        ],
      },
    ])
  })

  it('moves SDK control parts into message metadata', () => {
    const messages = normalizeAiSdkMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Need approval.' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'sendEmail', input: { to: 'ada@example.com' } },
          { type: 'tool-approval-request', approvalId: 'approval_1', toolCallId: 'call_1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'approval_1', approved: false, reason: 'Too risky' }],
      },
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'Need approval.',
        metadata: {
          toolCalls: [{ id: 'call_1', name: 'sendEmail', args: { to: 'ada@example.com' } }],
          toolApprovalRequests: [{ approvalId: 'approval_1', toolCallId: 'call_1' }],
        },
      },
      {
        role: 'tool',
        content: '',
        metadata: {
          toolApprovalResponse: { approvalId: 'approval_1', approved: false, reason: 'Too risky' },
        },
      },
    ])
  })

  it('normalizes AI SDK media parts to file content', () => {
    expect(
      normalizeAiSdkMessages([
        {
          role: 'user',
          content: [{ type: 'media', data: 'SGVsbG8=', mediaType: 'audio/mpeg' }],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            source: { type: 'data', data: new Uint8Array(Buffer.from('SGVsbG8=', 'base64')), mediaType: 'audio/mpeg' },
            mediaType: 'audio/mpeg',
          },
        ],
      },
    ])
  })

  it('passes through unrecognized SDK parts with a diagnostics warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const unknownPart = { type: 'provider-widget', widgetId: 'w1', providerOptions: { test: { keep: true } } }

      expect(
        normalizeAiSdkMessages([{ role: 'user', content: [{ type: 'text', text: 'Keep this.' }, unknownPart] }]),
      ).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Keep this.' }, unknownPart],
        },
      ])
      expect(warn).toHaveBeenCalledWith(
        '[@use-crux/ai] Passing through unrecognized AI SDK content part.',
        { partType: 'provider-widget' },
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('warns before dropping malformed known SDK media parts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(
        normalizeAiSdkMessages([
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Keep this.' },
              { type: 'media', data: 'SGVsbG8=' },
              { type: 'image', image: 'AQID' },
              { type: 'file', data: 'JVBERi0x' },
            ],
          },
        ]),
      ).toEqual([{ role: 'user', content: 'Keep this.' }])
      expect(warn).toHaveBeenCalledTimes(3)
      expect(warn).toHaveBeenCalledWith(
        '[@use-crux/ai] Dropping malformed AI SDK content part.',
        { partType: 'media', reason: 'AI SDK media parts require data and mediaType.' },
      )
      expect(warn).toHaveBeenCalledWith(
        '[@use-crux/ai] Dropping malformed AI SDK content part.',
        { partType: 'image', reason: 'AI SDK image parts require image and mediaType.' },
      )
      expect(warn).toHaveBeenCalledWith(
        '[@use-crux/ai] Dropping malformed AI SDK content part.',
        { partType: 'file', reason: 'AI SDK file parts require data and mediaType.' },
      )
    } finally {
      warn.mockRestore()
    }
  })
})
