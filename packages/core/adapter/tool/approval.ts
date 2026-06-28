/**
 * Shared tool-approval policy for adapter factories.
 *
 * Owns the approval protocol used by both `adapter()` (core-driven loop)
 * and `executorAdapter()` (SDK-driven loop): approval id/token creation,
 * the approval-request message shape, decision validation (including
 * token verification), resume detection, and approval observability.
 *
 * @module
 */

import { observe } from '../../observability'
import { findToolApprovalDecision, findToolApprovalRequests } from '../../tools/approvals'
import type { Message } from '../../generation/messages'
import type { JsonValue, ToolModelOutput } from '../../types/tool'
import type { AdapterResponse } from '../types'
import { emitToolArgsArtifact, emitToolResultArtifact, measureModelOutput } from './emission'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * A pending tool-approval request, surfaced to the caller when generation
 * suspends on a tool that requires human sign-off.
 *
 * Callers persist this (typically alongside the message history), show
 * `toolName`/`input` to a human, and resume by appending a
 * `tool-approval-response` message that echoes `approvalId` and
 * `approvalToken`. The token is the anti-forgery half of the protocol:
 * a response without the matching token is rejected at resume time.
 */
export interface ApprovalRequestInfo {
  /** Canonical id, derived from the tool call id (`approval_<toolCallId>`). */
  readonly approvalId: string
  /** The suspended tool call this request gates. */
  readonly toolCallId: string
  /** Name of the tool awaiting approval — what you show the human. */
  readonly toolName: string
  /** The tool's input args, JSON-safe for persistence and display. */
  readonly input: JsonValue
  /** Random token that must round-trip through the approval response. */
  readonly approvalToken: string
}

// ─────────────────────────────────────────────────────────────────
// Ids and tokens
// ─────────────────────────────────────────────────────────────────

/**
 * Derive the canonical approval id for a tool call.
 *
 * The mapping is deterministic (`approval_<toolCallId>`) so a resumed
 * conversation can re-associate a decision with its tool call without any
 * stored state beyond the message history itself.
 */
export function createApprovalId(toolCallId: string): string {
  return `approval_${toolCallId}`
}

/**
 * Create a cryptographically random approval token.
 * The token must round-trip through the approval response so a decision
 * cannot be forged for a request the caller never saw.
 */
export function createApprovalToken(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Tool approval requests require a cryptographically secure random token source.')
}

// ─────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────

/**
 * Build the assistant message that suspends generation pending approval.
 *
 * The message preserves the assistant's text and tool calls so the
 * conversation replays faithfully, and carries the approval request in
 * `metadata.toolApprovalRequests` where resume-time scanning
 * ({@link findApprovedOrDeniedToolCalls}) expects to find it. Append this
 * message, persist the history, and return the request to the caller.
 */
export function createApprovalRequestMessage(response: AdapterResponse, request: ApprovalRequestInfo): Message {
  return {
    role: 'assistant',
    content: response.text,
    metadata: {
      ...(response.toolCalls ? { toolCalls: response.toolCalls } : {}),
      toolApprovalRequests: [request],
    },
  }
}

/**
 * Build a synthetic `tool_calls` response for resume flows.
 *
 * When a conversation resumes after an approval decision, the original
 * provider response is gone — only the message history survived. This
 * reconstructs a minimal response (zero usage, no text) carrying the
 * approved tool calls so the tool executor can replay them through the
 * exact same code path as live tool calls.
 */
export function createSyntheticToolCallResponse(toolCalls: NonNullable<AdapterResponse['toolCalls']>): AdapterResponse {
  return {
    text: '',
    toolCalls,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: 'tool_calls',
    responseId: undefined,
    actualModelId: undefined,
  }
}

// ─────────────────────────────────────────────────────────────────
// Decision validation
// ─────────────────────────────────────────────────────────────────

/**
 * Find the decision for an approval request, verifying the approval token.
 *
 * @throws {Error} When a decision exists but its token does not match the
 *   request's token — a forged or replayed approval response.
 */
export function findValidApprovalDecision(
  messages: readonly Message[],
  request: { approvalId: string; approvalToken?: string } | undefined,
): ReturnType<typeof findToolApprovalDecision> {
  if (!request) return undefined
  const decision = findToolApprovalDecision(messages, request.approvalId)
  if (!decision) return undefined
  if (request.approvalToken && decision.approvalToken !== request.approvalToken) {
    throw new Error(`Approval response token mismatch for approval "${request.approvalId}".`)
  }
  return decision
}

/**
 * Scan a message history for tool calls whose approval has been decided
 * (approved or denied) but which have not yet produced a tool result —
 * the calls a resume flow must replay through the tool executor.
 *
 * A call counts as "completed" once a `tool`-role message with its
 * `toolCallId` exists, so replays are idempotent: running this twice over
 * the same history never re-executes a tool.
 *
 * @throws {Error} When a decision's approval token does not match its
 *   request — the mismatch is also emitted as a `token-mismatch`
 *   observability event before throwing.
 */
export function findApprovedOrDeniedToolCalls(messages: readonly Message[]): NonNullable<AdapterResponse['toolCalls']> {
  const completedToolCallIds = new Set(
    messages.flatMap((message) => {
      if (message.role !== 'tool') return []
      if (typeof message.metadata?.toolCallId !== 'string') return []
      return [message.metadata.toolCallId]
    }),
  )

  return findToolApprovalRequests(messages).flatMap((request) => {
    if (completedToolCallIds.has(request.toolCallId)) return []
    let decision: ReturnType<typeof findToolApprovalDecision>
    try {
      decision = findValidApprovalDecision(messages, request)
    } catch (error) {
      emitToolApprovalObservation('token-mismatch', {
        approvalId: request.approvalId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        input: request.input,
        error,
      })
      throw error
    }
    if (!decision) return []
    return [
      {
        id: request.toolCallId,
        name: request.toolName,
        args: request.input,
      },
    ]
  })
}

// ─────────────────────────────────────────────────────────────────
// Observability
// ─────────────────────────────────────────────────────────────────

/** Emit a `tool.approval` span + event for an approval lifecycle phase. */
export function emitToolApprovalObservation(
  phase: 'request' | 'approved' | 'denied' | 'token-mismatch',
  args: {
    approvalId: string
    toolCallId: string
    toolName: string
    input: unknown
    reason?: string
    modelOutput?: ToolModelOutput
    modelOutputSize?: number
    error?: unknown
  },
): void {
  const span = observe.openSpan({
    name: `${args.toolName}.approval.${phase}`,
    family: 'tool',
    primitive: 'tool.approval',
    attributes: {
      approvalId: args.approvalId,
      toolCallId: args.toolCallId,
      toolName: args.toolName,
      phase,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.modelOutput ? { modelOutputType: args.modelOutput.type } : {}),
      ...(args.modelOutputSize !== undefined ? { modelOutputSize: args.modelOutputSize } : {}),
    },
  })
  try {
    span.withContext(() => {
      emitToolArgsArtifact(span.spanId, args.toolName, args.toolCallId, args.input)
      if (args.modelOutput) {
        emitToolResultArtifact(span.spanId, args.toolName, args.toolCallId, args.modelOutput, {
          resultKind: 'model',
          modelOutputType: args.modelOutput.type,
          modelOutputSize: args.modelOutputSize ?? measureModelOutput(args.modelOutput),
          isError: phase !== 'approved',
          approvalId: args.approvalId,
          approvalPhase: phase,
        })
      }
      observe.event({
        name: `tool.approval.${phase}`,
        attributes: {
          approvalId: args.approvalId,
          toolCallId: args.toolCallId,
          toolName: args.toolName,
          ...(args.reason ? { reason: args.reason } : {}),
          ...(args.error ? { error: args.error instanceof Error ? args.error.message : String(args.error) } : {}),
        },
      })
    })
    if (args.error) {
      span.error(args.error, { phase, isError: true })
      return
    }
    span.end({ phase, approved: phase === 'approved' })
  } catch (error) {
    span.error(error)
  }
}
