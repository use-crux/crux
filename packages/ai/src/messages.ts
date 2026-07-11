/**
 * Message conversion between canonical Crux `Message[]` and AI SDK
 * `ModelMessage[]` shapes — pure functions, no SDK calls.
 *
 * Canonical messages are the persistence/resume format (what
 * `loopRuntimeAdapter()` reads and writes); model messages are what
 * `generateText`/`streamText` consume. Tool rounds are the interesting
 * part: canonical keeps tool calls in assistant `metadata.toolCalls` and
 * results as `tool`-role messages with `metadata.toolCallId`, while the
 * SDK wants typed content parts.
 *
 * @module
 */

import type { ContentPart, Message, MessageContent } from '@use-crux/core'
import type { AiSdkContentPartOptions } from './content-parts'
import { decodeContentFromAiSdkParts, encodeContentForAiSdk } from './content-parts'
import { isRecord, readString } from './object-utils'

interface CanonicalToolCall {
  id: string
  name: string
  args: unknown
}

/**
 * Convert canonical Crux messages to AI SDK `ModelMessage`-shaped objects.
 *
 * Canonical multimodal content is converted into AI SDK text/image/file
 * parts. Approval bookkeeping messages (`tool-approval-response`, approval-request
 * metadata) are consumed by core's resume logic and are NOT sent to the
 * model — by the time conversion runs, the decided tool round is already
 * in the history as ordinary tool-call/tool-result messages.
 */
export function toModelMessages(
  messages: readonly Message[],
  options: AiSdkContentPartOptions = {},
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (message.role === 'tool') {
      // Approval responses are core-side bookkeeping, not model input.
      if (message.metadata?.toolApprovalResponse) continue
      const toolCallId = message.metadata?.toolCallId
      if (typeof toolCallId !== 'string') continue
      result.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName: typeof message.metadata?.toolName === 'string' ? message.metadata.toolName : 'unknown',
            output: toolResultOutputFromContent(message.content),
          },
        ],
      })
      continue
    }

    if (message.role === 'assistant') {
      const toolCalls = message.metadata?.toolCalls as CanonicalToolCall[] | undefined
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        const encodedContent = encodeContentForAiSdk(message.role, message.content, options)
        const parts: Array<Record<string, unknown>> =
          typeof encodedContent === 'string'
            ? encodedContent.length > 0
              ? [{ type: 'text', text: encodedContent }]
              : []
            : [...encodedContent]
        for (const toolCall of toolCalls) {
          parts.push({
            type: 'tool-call',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.args,
          })
        }
        result.push({ role: 'assistant', content: parts })
        continue
      }
      result.push({ role: 'assistant', content: encodeContentForAiSdk(message.role, message.content, options) })
      continue
    }

    // user / system: text or canonical multimodal content.
    result.push({ role: message.role, content: encodeContentForAiSdk(message.role, message.content, options) })
  }

  return result
}

type AiSdkToolResultOutput =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'content'; readonly value: readonly ContentPart[] }

function toolResultOutputFromContent(content: MessageContent): AiSdkToolResultOutput {
  return typeof content === 'string'
    ? { type: 'text', value: content }
    : { type: 'content', value: content }
}

interface ResponseMessagePart {
  type?: string
  text?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: { type?: string; value?: unknown }
}

interface ResponseMessageLike {
  role?: string
  content?: string | ResponseMessagePart[]
}

/**
 * Convert AI SDK response messages (the `result.response.messages` of a
 * `generateText` run — assistant and tool messages with typed parts) into
 * canonical Crux messages suitable for persistence and resume.
 *
 * Tool calls land in assistant `metadata.toolCalls`; each tool-result part
 * becomes its own `tool`-role message. Approval-request parts are dropped:
 * core re-emits them through its own approval protocol with minted tokens.
 */
export function fromResponseMessages(responseMessages: readonly unknown[]): Message[] {
  const result: Message[] = []

  for (const raw of responseMessages) {
    const message = raw as ResponseMessageLike
    if (!message || typeof message !== 'object') continue

    if (typeof message.content === 'string') {
      if (message.role === 'assistant') {
        result.push({ role: 'assistant', content: message.content })
      }
      continue
    }
    if (!Array.isArray(message.content)) continue

    if (message.role === 'assistant') {
      const toolCallParts = message.content.filter((p) => p.type === 'tool-call')
      const content = decodeContentFromAiSdkParts(message.content as Record<string, unknown>[])
      result.push({
        role: 'assistant',
        content,
        ...(toolCallParts.length > 0
          ? {
              metadata: {
                toolCalls: toolCallParts.map((p) => ({
                  id: p.toolCallId ?? '',
                  name: p.toolName ?? '',
                  args: p.input,
                })),
              },
            }
          : {}),
      })
      continue
    }

    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool-result' || typeof part.toolCallId !== 'string') continue
        const content = toolResultContentFromResponsePart(part)
        result.push({
          role: 'tool',
          content,
          metadata: { toolCallId: part.toolCallId, toolName: part.toolName },
        })
      }
    }
  }

  return result
}

/**
 * Drop the trailing assistant message from a canonical sequence — used
 * when a run suspended on tool approval, where the final assistant message
 * is re-emitted by core as the approval-request message instead.
 */
export function dropTrailingAssistant(messages: readonly Message[]): Message[] {
  if (messages.length > 0 && messages[messages.length - 1]!.role === 'assistant') {
    return messages.slice(0, -1)
  }
  return [...messages]
}

/**
 * Convert AI SDK `CoreMessage[]` to canonical `Message[]`.
 *
 * Handles AI SDK's content format (string or array of parts) by
 * extracting the text content. Tool call/result metadata is preserved
 * in the `metadata` field.
 */
export function normalizeAiSdkMessages(
  sdkMessages: ReadonlyArray<{
    role: string
    content: unknown
    [key: string]: unknown
  }>,
): Message[] {
  return sdkMessages.map((msg) => {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? decodeContentFromAiSdkParts(msg.content as Record<string, unknown>[])
          : String(msg.content ?? '')

    const role = normalizeRole(msg.role)
    const metadata: Record<string, unknown> = {}

    if (msg.toolCallId) metadata.toolCallId = msg.toolCallId
    if (msg.toolName) metadata.toolName = msg.toolName
    const providerMeta = (msg as { experimental_providerMetadata?: unknown }).experimental_providerMetadata
    if (providerMeta) {
      metadata.providerMetadata = providerMeta
    }

    // Preserve tool calls from assistant messages
    if (Array.isArray(msg.content)) {
      const parts = msg.content as Record<string, unknown>[]
      const toolCalls = parts.filter((p) => p.type === 'tool-call')
      if (toolCalls.length > 0) {
        metadata.toolCalls = toolCalls.map((tc) => ({
          id: readString(tc, 'toolCallId') ?? '',
          name: readString(tc, 'toolName') ?? '',
          args: tc.input ?? tc.args,
        }))
      }
      const approvalRequests = parts.filter((p) => p.type === 'tool-approval-request')
      if (role === 'assistant' && approvalRequests.length > 0) {
        metadata.toolApprovalRequests = approvalRequests.map((request) => {
          const toolCall = readRecord(request.toolCall)
          return {
            approvalId: readString(request, 'approvalId') ?? '',
            toolCallId: readString(request, 'toolCallId') ?? readString(toolCall, 'toolCallId') ?? '',
            ...(readString(request, 'toolName') ?? readString(toolCall, 'toolName')
              ? { toolName: readString(request, 'toolName') ?? readString(toolCall, 'toolName') }
              : {}),
            ...(request.input !== undefined || toolCall?.input !== undefined
              ? { input: request.input ?? toolCall?.input }
              : {}),
            ...(readString(request, 'approvalToken') ? { approvalToken: readString(request, 'approvalToken') } : {}),
          }
        })
      }
      const approvalResponse = parts.find((p) => p.type === 'tool-approval-response')
      if (role === 'tool' && approvalResponse) {
        metadata.toolApprovalResponse = {
          approvalId: readString(approvalResponse, 'approvalId') ?? '',
          approved: approvalResponse.approved === true,
          ...(readString(approvalResponse, 'reason') ? { reason: readString(approvalResponse, 'reason') } : {}),
          ...(readString(approvalResponse, 'approvalToken')
            ? { approvalToken: readString(approvalResponse, 'approvalToken') }
            : {}),
        }
      }
    }

    return {
      role,
      content,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }
  })
}

function normalizeRole(role: string): Message['role'] {
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role
  }
  return 'user'
}

function toolResultContentFromResponsePart(part: ResponseMessagePart): MessageContent {
  const value = part.output?.value
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return decodeContentFromAiSdkParts(value.filter(isRecord))
  return JSON.stringify(value ?? null)
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}
