import { describe, expect, it, vi } from 'vitest'
import { applyToolMiddleware, approvalMiddleware, notifyToolApprovalResponses, toolMiddleware } from '../tools/middleware'
import { toolApprovalResponse } from '../tools/approvals'

describe('toolMiddleware()', () => {
  it('wraps matching tool execution with before/after hooks', async () => {
    const before = vi.fn()
    const after = vi.fn()
    const tools = applyToolMiddleware(
      {
        sendEmail: {
          description: 'Send email',
          execute: async (input: { subject: string }) => `sent ${input.subject}`,
        },
      },
      toolMiddleware({
        id: 'audit',
        match: ['sendEmail'],
        beforeExecute: before,
        afterExecute: after,
      }),
    )

    const result = await tools.sendEmail.execute?.({ subject: 'Hello' }, { toolCallId: 'call-1' })

    expect(result).toBe('sent Hello')
    expect(before).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sendEmail',
        toolCallId: 'call-1',
        input: { subject: 'Hello' },
        messages: undefined,
      }),
    )
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sendEmail',
        toolCallId: 'call-1',
        output: 'sent Hello',
      }),
    )
  })

  it('supports predicate matchers', async () => {
    const before = vi.fn()
    const tools = applyToolMiddleware(
      {
        chargeCard: {
          description: 'Charge card',
          execute: async (input: { amount: number }) => ({ ok: true, amount: input.amount }),
        },
      },
      toolMiddleware({
        id: 'large-payments',
        match: [
          ({ input }) => typeof input === 'object' && input !== null && (input as { amount?: number }).amount! > 1000,
        ],
        beforeExecute: before,
      }),
    )

    await tools.chargeCard.execute?.({ amount: 250 }, { toolCallId: 'small' })
    await tools.chargeCard.execute?.({ amount: 1250 }, { toolCallId: 'large' })

    expect(before).toHaveBeenCalledOnce()
    expect(before).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'chargeCard',
        toolCallId: 'large',
      }),
    )
  })

  it('can modify input by calling next with replacement arguments', async () => {
    const execute = vi.fn().mockImplementation(async (input: { subject: string }) => `sent ${input.subject}`)
    const tools = applyToolMiddleware(
      {
        sendEmail: {
          description: 'Send email',
          execute,
        },
      },
      toolMiddleware({
        id: 'normalize-subject',
        match: ['sendEmail'],
        aroundExecute: ({ input, options }, next) => {
          const subject =
            typeof input === 'object' && input !== null && 'subject' in input ? String(input.subject).trim() : ''
          return next({ subject }, options)
        },
      }),
    )

    const result = await tools.sendEmail.execute?.({ subject: '  Hello  ' }, { toolCallId: 'call-1' })

    expect(result).toBe('sent Hello')
    expect(execute).toHaveBeenCalledWith({ subject: 'Hello' }, { toolCallId: 'call-1' })
  })

  it('can return early without executing the wrapped tool', async () => {
    const execute = vi.fn().mockResolvedValue('sent')
    const tools = applyToolMiddleware(
      {
        sendEmail: {
          description: 'Send email',
          execute,
        },
      },
      toolMiddleware({
        id: 'cached-result',
        match: ['sendEmail'],
        aroundExecute: () => ({ cached: true }),
      }),
    )

    const result = await tools.sendEmail.execute?.({ subject: 'Hello' }, { toolCallId: 'call-1' })

    expect(result).toEqual({ cached: true })
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('approvalMiddleware()', () => {
  it('marks matching tool calls as requiring approval without executing the tool', async () => {
    const onRequest = vi.fn()
    const execute = vi.fn().mockResolvedValue('sent')
    const tools = applyToolMiddleware(
      {
        sendEmail: {
          description: 'Send email',
          execute,
        },
      },
      approvalMiddleware({
        id: 'approval',
        match: ['sendEmail'],
        onRequest,
      }),
    )

    await expect(tools.sendEmail.needsApproval?.({ subject: 'Hello' }, { toolCallId: 'call-1' })).resolves.toBe(true)
    expect(execute).not.toHaveBeenCalled()
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sendEmail',
        toolCallId: 'call-1',
        input: { subject: 'Hello' },
      }),
    )
  })

  it('notifies approved callbacks when approval response is present on resume', async () => {
    const onApproved = vi.fn()
    const execute = vi.fn().mockResolvedValue('sent')
    const tools = applyToolMiddleware(
      {
        sendEmail: {
          description: 'Send email',
          execute,
        },
      },
      approvalMiddleware({
        id: 'approval',
        match: ['sendEmail'],
        onApproved,
      }),
    )

    const messages = approvalMessages({ approved: true })
    await notifyToolApprovalResponses(tools, messages)
    const result = await tools.sendEmail.execute?.({ subject: 'Hello' }, { toolCallId: 'call-1', messages })

    expect(result).toBe('sent')
    expect(execute).toHaveBeenCalledOnce()
    expect(onApproved).toHaveBeenCalledOnce()
    expect(onApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'approval-1',
        status: 'approved',
        toolName: 'sendEmail',
        toolCallId: 'call-1',
      }),
    )
  })

  it('does not notify approval callbacks for unmatched tools', async () => {
    const onRequest = vi.fn()
    const onDenied = vi.fn()
    const tools = applyToolMiddleware(
      {
        sendEmail: {
          description: 'Send email',
          execute: vi.fn().mockResolvedValue('sent'),
        },
        readOnlyLookup: {
          description: 'Lookup',
          needsApproval: true,
          execute: vi.fn().mockResolvedValue('lookup'),
        },
      },
      approvalMiddleware({
        id: 'approval',
        match: ['sendEmail'],
        onRequest,
        onDenied,
      }),
    )

    await expect(tools.readOnlyLookup.needsApproval?.({ query: 'status' }, { toolCallId: 'call-1' })).resolves.toBe(
      true,
    )
    await notifyToolApprovalResponses(tools, approvalMessages({ toolName: 'readOnlyLookup', approved: false }))

    expect(onRequest).not.toHaveBeenCalled()
    expect(onDenied).not.toHaveBeenCalled()
  })

  it('notifies denied callbacks without executing the tool', async () => {
    const onDenied = vi.fn()
    const execute = vi.fn().mockResolvedValue('sent')
    const tools = applyToolMiddleware(
      {
        sendEmail: {
          description: 'Send email',
          execute,
        },
      },
      approvalMiddleware({
        id: 'approval',
        match: ['sendEmail'],
        onDenied,
      }),
    )

    await notifyToolApprovalResponses(tools, approvalMessages({ approved: false, reason: 'Too risky' }))

    expect(execute).not.toHaveBeenCalled()
    expect(onDenied).toHaveBeenCalledOnce()
    expect(onDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'approval-1',
        status: 'denied',
        reason: 'Too risky',
      }),
    )
  })

  it('creates typed approval response parts', () => {
    expect(toolApprovalResponse({ approvalId: 'approval-1', approved: false, reason: 'No' })).toEqual({
      type: 'tool-approval-response',
      approvalId: 'approval-1',
      approved: false,
      reason: 'No',
    })
  })
})

function approvalMessages(options: { approved: boolean; reason?: string; toolName?: string }) {
  const toolName = options.toolName ?? 'sendEmail'
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName,
          input: { subject: 'Hello' },
        },
        {
          type: 'tool-approval-request',
          approvalId: 'approval-1',
          toolCallId: 'call-1',
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: 'approval-1',
          approved: options.approved,
          ...(options.reason ? { reason: options.reason } : {}),
        },
      ],
    },
  ]
}
