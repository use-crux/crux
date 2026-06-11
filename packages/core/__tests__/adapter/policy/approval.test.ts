/**
 * Tests for `adapter/policy/approval` — the shared tool-approval protocol
 * (ids, tokens, request messages, decision validation, resume detection)
 * used by both `adapter()` and `executorAdapter()`.
 */

import { describe, it, expect } from 'vitest'
import {
  createApprovalId,
  createApprovalToken,
  createApprovalRequestMessage,
  createSyntheticToolCallResponse,
  findValidApprovalDecision,
  findApprovedOrDeniedToolCalls,
} from '../../../adapter/policy/approval'
import { appendToolApprovalResponse } from '../../../tool-middleware'
import type { Message } from '../../../messages'
import type { AdapterResponse } from '../../../adapter/types'

function approvalRequestMessages(token?: string): Message[] {
  const response: AdapterResponse = {
    text: 'I need to run a tool.',
    toolCalls: [{ id: 'tc_1', name: 'deleteFile', args: { path: '/tmp/x' } }],
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    finishReason: 'tool_calls',
    responseId: undefined,
    actualModelId: undefined,
  }
  return [
    { role: 'user', content: 'delete it' },
    createApprovalRequestMessage(response, {
      approvalId: createApprovalId('tc_1'),
      toolCallId: 'tc_1',
      toolName: 'deleteFile',
      input: { path: '/tmp/x' },
      approvalToken: token ?? createApprovalToken(),
    }),
  ]
}

describe('createApprovalId / createApprovalToken', () => {
  it('derives a stable approval id from the tool call id', () => {
    expect(createApprovalId('tc_42')).toBe('approval_tc_42')
  })

  it('generates unique, non-empty tokens', () => {
    const a = createApprovalToken()
    const b = createApprovalToken()
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })
})

describe('createApprovalRequestMessage', () => {
  it('builds an assistant message carrying tool calls and the approval request', () => {
    const [, message] = approvalRequestMessages()
    expect(message!.role).toBe('assistant')
    expect(message!.content).toBe('I need to run a tool.')
    const metadata = message!.metadata as {
      toolCalls: unknown[]
      toolApprovalRequests: Array<{ approvalId: string }>
    }
    expect(metadata.toolCalls).toHaveLength(1)
    expect(metadata.toolApprovalRequests[0]!.approvalId).toBe('approval_tc_1')
  })
})

describe('findValidApprovalDecision', () => {
  it('returns undefined when no decision message exists', () => {
    const messages = approvalRequestMessages()
    expect(
      findValidApprovalDecision(messages, { approvalId: 'approval_tc_1', approvalToken: 'tok' }),
    ).toBeUndefined()
  })

  it('returns the decision when the token matches', () => {
    const token = createApprovalToken()
    const messages = appendToolApprovalResponse(approvalRequestMessages(token), {
      approvalId: 'approval_tc_1',
      approved: true,
      approvalToken: token,
    }) as Message[]

    const decision = findValidApprovalDecision(messages, { approvalId: 'approval_tc_1', approvalToken: token })
    expect(decision?.approved).toBe(true)
  })

  it('throws on approval token mismatch', () => {
    const messages = appendToolApprovalResponse(approvalRequestMessages('expected-token'), {
      approvalId: 'approval_tc_1',
      approved: true,
      approvalToken: 'forged-token',
    }) as Message[]

    expect(() =>
      findValidApprovalDecision(messages, { approvalId: 'approval_tc_1', approvalToken: 'expected-token' }),
    ).toThrow(/token mismatch/i)
  })
})

describe('findApprovedOrDeniedToolCalls', () => {
  it('returns decided tool calls that have not executed yet', () => {
    const token = createApprovalToken()
    const messages = appendToolApprovalResponse(approvalRequestMessages(token), {
      approvalId: 'approval_tc_1',
      approved: true,
      approvalToken: token,
    }) as Message[]

    const calls = findApprovedOrDeniedToolCalls(messages)
    expect(calls).toEqual([{ id: 'tc_1', name: 'deleteFile', args: { path: '/tmp/x' } }])
  })

  it('skips tool calls that already produced a tool result message', () => {
    const token = createApprovalToken()
    const messages = [
      ...(appendToolApprovalResponse(approvalRequestMessages(token), {
        approvalId: 'approval_tc_1',
        approved: true,
        approvalToken: token,
      }) as Message[]),
      { role: 'tool' as const, content: 'done', metadata: { toolCallId: 'tc_1' } },
    ]

    expect(findApprovedOrDeniedToolCalls(messages)).toEqual([])
  })

  it('returns nothing while the request is still undecided', () => {
    expect(findApprovedOrDeniedToolCalls(approvalRequestMessages())).toEqual([])
  })
})

describe('createSyntheticToolCallResponse', () => {
  it('builds a zero-usage tool_calls response for resume flows', () => {
    const response = createSyntheticToolCallResponse([{ id: 'tc_9', name: 'noop', args: {} }])
    expect(response.finishReason).toBe('tool_calls')
    expect(response.usage.totalTokens).toBe(0)
    expect(response.toolCalls).toEqual([{ id: 'tc_9', name: 'noop', args: {} }])
  })
})
