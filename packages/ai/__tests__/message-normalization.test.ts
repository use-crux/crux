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
            type: 'image-data',
            data: 'AQID',
            mediaType: 'image/png',
            providerOptions: { openai: { detail: 'low' } },
          },
          {
            type: 'file-url',
            url: 'https://example.com/report.pdf',
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

  it('normalizes legacy AI SDK v6 media parts to file-data', () => {
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
        content: [{ type: 'file-data', data: 'SGVsbG8=', mediaType: 'audio/mpeg' }],
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
})
