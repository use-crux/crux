/**
 * Internal helpers that read tool-call and approval state out of provider-agnostic
 * message history.
 *
 * These are pure functions over `readonly unknown[]` message arrays — they never
 * mutate state and have no runtime dependencies. They back both the approval
 * protocol helpers (`../approvals`) and the approval-aware tool middleware
 * (`../middleware`). Not part of the public package surface.
 *
 * @module
 */

import type { ToolApprovalDecision, ToolApprovalRequest, ToolApprovalRequestPayload } from '../types'

/** A resolved approval pairing a request with its decision, used by the middleware. */
export interface ResolvedToolApproval {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
  approved: boolean
  reason?: string
}

/**
 * Pair every approval decision in `messages` with its originating request and
 * tool call, producing fully-resolved approvals.
 */
export function collectToolApprovals(messages: readonly unknown[]): ResolvedToolApproval[] {
  const toolCalls = collectToolCalls(messages)
  const requests = new Map(
    collectToolApprovalRequests(messages).map((request) => [
      request.approvalId,
      {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        input: request.input,
      },
    ]),
  )
  const responses = collectToolApprovalDecisions(messages)

  return responses.flatMap((response) => {
    const request = requests.get(response.approvalId)
    if (!request) return []
    const call = toolCalls.get(request.toolCallId)
    const toolName = request.toolName ?? call?.toolName
    if (!toolName) return []
    return [
      {
        approvalId: response.approvalId,
        toolCallId: request.toolCallId,
        toolName,
        input: request.input ?? call?.input,
        approved: response.approved,
        ...(response.reason ? { reason: response.reason } : {}),
      },
    ]
  })
}

function collectToolCalls(messages: readonly unknown[]): Map<string, { toolName: string; input: unknown }> {
  const toolCalls = new Map<string, { toolName: string; input: unknown }>()

  for (const message of messages) {
    const role = readStringProperty(message, 'role')
    const content = readProperty(message, 'content')
    const metadata = readProperty(message, 'metadata')

    const metadataToolCalls = readProperty(metadata, 'toolCalls')
    if (role === 'assistant' && Array.isArray(metadataToolCalls)) {
      for (const call of metadataToolCalls) {
        const toolCallId = readStringProperty(call, 'id') ?? readStringProperty(call, 'toolCallId')
        const toolName = readStringProperty(call, 'name') ?? readStringProperty(call, 'toolName')
        if (toolCallId && toolName) {
          toolCalls.set(toolCallId, {
            toolName,
            input: readProperty(call, 'args') ?? readProperty(call, 'input'),
          })
        }
      }
    }

    if (!Array.isArray(content)) continue

    for (const part of content) {
      const type = readStringProperty(part, 'type')
      if (role === 'assistant' && type === 'tool-call') {
        const toolCallId = readStringProperty(part, 'toolCallId')
        const toolName = readStringProperty(part, 'toolName')
        if (toolCallId && toolName) {
          toolCalls.set(toolCallId, {
            toolName,
            input: readProperty(part, 'input') ?? readProperty(part, 'args'),
          })
        }
      }
    }
  }

  return toolCalls
}

/** Extract all normalized approval requests present in `messages`. */
export function collectToolApprovalRequests(messages: readonly unknown[]): ToolApprovalRequest[] {
  const requests: ToolApprovalRequest[] = []
  const toolCalls = collectToolCalls(messages)

  for (const message of messages) {
    const role = readStringProperty(message, 'role')
    const content = readProperty(message, 'content')
    const metadata = readProperty(message, 'metadata')

    const metadataRequests = readProperty(metadata, 'toolApprovalRequests')
    if (role === 'assistant' && Array.isArray(metadataRequests)) {
      for (const request of metadataRequests) {
        const normalized = normalizeApprovalRequest(request)
        const completed = completeApprovalRequest(normalized, toolCalls)
        if (completed) requests.push(completed)
      }
    }

    if (!Array.isArray(content)) continue

    for (const part of content) {
      const type = readStringProperty(part, 'type')

      if (role === 'assistant' && type === 'tool-approval-request') {
        const normalized = normalizeApprovalRequest(part)
        const completed = completeApprovalRequest(normalized, toolCalls)
        if (completed) requests.push(completed)
      }
    }
  }

  return requests
}

/** Extract all normalized approval decisions present in `messages`. */
export function collectToolApprovalDecisions(messages: readonly unknown[]): ToolApprovalDecision[] {
  const responses: ToolApprovalDecision[] = []

  for (const message of messages) {
    const role = readStringProperty(message, 'role')
    const content = readProperty(message, 'content')
    const metadata = readProperty(message, 'metadata')

    const metadataResponse = readProperty(metadata, 'toolApprovalResponse')
    const normalizedMetadataResponse = normalizeApprovalDecision(metadataResponse)
    if (role === 'tool' && normalizedMetadataResponse) {
      responses.push(normalizedMetadataResponse)
    }

    if (!Array.isArray(content)) continue

    for (const part of content) {
      const type = readStringProperty(part, 'type')
      if (role === 'tool' && type === 'tool-approval-response') {
        const normalized = normalizeApprovalDecision(part)
        if (normalized) responses.push(normalized)
      }
    }
  }

  return responses
}

function normalizeApprovalRequest(value: unknown): ToolApprovalRequest | undefined {
  const approvalId = readStringProperty(value, 'approvalId')
  const toolCall = readProperty(value, 'toolCall')
  const toolCallId = readStringProperty(value, 'toolCallId') ?? readStringProperty(toolCall, 'toolCallId')
  const toolName = readStringProperty(value, 'toolName') ?? readStringProperty(toolCall, 'toolName')
  if (!approvalId || !toolCallId) return undefined

  return {
    approvalId,
    toolCallId,
    toolName: toolName ?? '',
    input: readProperty(value, 'input') ?? readProperty(toolCall, 'input') ?? readProperty(toolCall, 'args'),
    ...(isApprovalRequestPayload(readProperty(value, 'request')) ? { request: readProperty(value, 'request') as ToolApprovalRequestPayload } : {}),
    ...(readStringProperty(value, 'approvalToken') ? { approvalToken: readStringProperty(value, 'approvalToken') } : {}),
  }
}

function completeApprovalRequest(
  request: ToolApprovalRequest | undefined,
  toolCalls: Map<string, { toolName: string; input: unknown }>,
): ToolApprovalRequest | undefined {
  if (!request) return undefined
  const call = toolCalls.get(request.toolCallId)
  const toolName = request.toolName || call?.toolName
  if (!toolName) return undefined
  return {
    ...request,
    toolName,
    input: request.input ?? call?.input,
  }
}

function normalizeApprovalDecision(value: unknown): ToolApprovalDecision | undefined {
  const approvalId = readStringProperty(value, 'approvalId')
  const approved = readBooleanProperty(value, 'approved')
  if (approvalId && approved !== undefined) {
    return {
      approvalId,
      approved,
      ...(readStringProperty(value, 'reason') ? { reason: readStringProperty(value, 'reason') } : {}),
      ...(readStringProperty(value, 'approvalToken') ? { approvalToken: readStringProperty(value, 'approvalToken') } : {}),
    }
  }
  return undefined
}

function isApprovalRequestPayload(value: unknown): value is ToolApprovalRequestPayload {
  return value !== null && typeof value === 'object'
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readProperty(value, key)
  return typeof property === 'string' ? property : undefined
}

function readBooleanProperty(value: unknown, key: string): boolean | undefined {
  const property = readProperty(value, key)
  return typeof property === 'boolean' ? property : undefined
}
