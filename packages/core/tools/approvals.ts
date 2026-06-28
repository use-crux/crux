/**
 * Resumable tool-approval protocol helpers.
 *
 * These build and read the canonical approval message parts that flow through
 * a provider-agnostic conversation, letting a host suspend a tool call for
 * human approval and resume it later by appending a response message.
 *
 * @module
 */

import type { ToolModelOutput } from '../types/tool'
import type { ToolApprovalDecision, ToolApprovalRequest, ToolApprovalResponsePart } from './types'
import { collectToolApprovalDecisions, collectToolApprovalRequests } from './internal/message-parsing'

/** Build a canonical `tool-approval-response` message part. */
export function toolApprovalResponse(options: {
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}): ToolApprovalResponsePart {
  return {
    type: 'tool-approval-response',
    approvalId: options.approvalId,
    approved: options.approved,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.approvalToken ? { approvalToken: options.approvalToken } : {}),
  }
}

/** Wrap a {@link toolApprovalResponse} in a `tool` role message. */
export function toolApprovalResponseMessage(options: {
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}): {
  readonly role: 'tool'
  readonly content: string
  readonly metadata: { readonly toolApprovalResponse: ToolApprovalResponsePart }
} {
  return {
    role: 'tool',
    content: '',
    metadata: {
      toolApprovalResponse: toolApprovalResponse(options),
    },
  }
}

/** Append a tool-approval response message to an existing message list. */
export function appendToolApprovalResponse<TMessage>(
  messages: readonly TMessage[],
  response: {
    readonly approvalId: string
    readonly approved: boolean
    readonly reason?: string
    readonly approvalToken?: string
  },
): Array<TMessage | ReturnType<typeof toolApprovalResponseMessage>> {
  return [...messages, toolApprovalResponseMessage(response)]
}

/** Find every pending approval request in a message list. */
export function findToolApprovalRequests(messages: readonly unknown[] | undefined): ToolApprovalRequest[] {
  if (!messages) return []
  return collectToolApprovalRequests(messages)
}

/** Find the decision for a specific `approvalId`, if one is present. */
export function findToolApprovalDecision(
  messages: readonly unknown[] | undefined,
  approvalId: string,
): ToolApprovalDecision | undefined {
  if (!messages) return undefined
  return collectToolApprovalDecisions(messages).find((decision) => decision.approvalId === approvalId)
}

/** Build the `tool` model output used when a tool execution is denied. */
export function deniedToolModelOutput(reason?: string): ToolModelOutput {
  return { type: 'execution-denied', ...(reason ? { reason } : {}) }
}
