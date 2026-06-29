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

import type { Message } from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// Canonical → ModelMessage
// ─────────────────────────────────────────────────────────────────

interface CanonicalToolCall {
  id: string
  name: string
  args: unknown
}

/**
 * Convert canonical Crux messages to AI SDK `ModelMessage`-shaped objects.
 *
 * Pass-through rules keep existing callers working: messages whose content
 * is already an array of SDK parts are forwarded untouched, so histories
 * captured from prior AI SDK calls survive a round-trip. Approval
 * bookkeeping messages (`tool-approval-response`, approval-request
 * metadata) are consumed by core's resume logic and are NOT sent to the
 * model — by the time conversion runs, the decided tool round is already
 * in the history as ordinary tool-call/tool-result messages.
 */
export function toModelMessages(messages: readonly Message[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []

  for (const message of messages) {
    // SDK-shaped content (array of parts) passes through untouched.
    if (Array.isArray(message.content)) {
      result.push({ role: message.role, content: message.content })
      continue
    }

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
            output: { type: 'text', value: typeof message.content === 'string' ? message.content : '' },
          },
        ],
      })
      continue
    }

    if (message.role === 'assistant') {
      const toolCalls = message.metadata?.toolCalls as CanonicalToolCall[] | undefined
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        const parts: Array<Record<string, unknown>> = []
        if (typeof message.content === 'string' && message.content.length > 0) {
          parts.push({ type: 'text', text: message.content })
        }
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
      result.push({ role: 'assistant', content: message.content })
      continue
    }

    // user / system: plain text content.
    result.push({ role: message.role, content: message.content })
  }

  return result
}

// ─────────────────────────────────────────────────────────────────
// ResponseMessage → canonical
// ─────────────────────────────────────────────────────────────────

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
      const textParts = message.content.filter((p) => p.type === 'text')
      const toolCallParts = message.content.filter((p) => p.type === 'tool-call')
      const text = textParts.map((p) => p.text ?? '').join('')
      result.push({
        role: 'assistant',
        content: text,
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
        const value = part.output?.value
        result.push({
          role: 'tool',
          content: typeof value === 'string' ? value : JSON.stringify(value ?? null),
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

// ─────────────────────────────────────────────────────────────────
// Legacy public converters (kept for compatibility)
// ─────────────────────────────────────────────────────────────────

/**
 * Convert AI SDK `CoreMessage[]` to canonical `Message[]`.
 *
 * Handles AI SDK's content format (string or array of parts) by
 * extracting the text content. Tool call/result metadata is preserved
 * in the `metadata` field.
 */
export function toMessages(
  sdkMessages: Array<{
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
          ? (msg.content as Array<{ type?: string; text?: string }>)
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('')
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
      type ToolCallPart = { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
      const toolCalls = (msg.content as Array<{ type?: string }>).filter(
        (p): p is ToolCallPart => p.type === 'tool-call',
      )
      if (toolCalls.length > 0) {
        metadata.toolCalls = toolCalls.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          args: tc.args,
        }))
      }
    }

    return {
      role,
      content,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }
  })
}

/**
 * Convert canonical `Message[]` to AI SDK `CoreMessage[]` format.
 */
export function fromMessages(messages: Message[]): Array<{ role: string; content: string; [key: string]: unknown }> {
  return messages.map((msg) => {
    const result: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    }

    if (msg.metadata?.toolCallId) result.toolCallId = msg.metadata.toolCallId
    if (msg.metadata?.toolName) result.toolName = msg.metadata.toolName

    return result as { role: string; content: string; [key: string]: unknown }
  })
}

function normalizeRole(role: string): Message['role'] {
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role
  }
  return 'user'
}
