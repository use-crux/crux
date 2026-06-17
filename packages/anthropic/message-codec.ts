import type Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@crux/core'
import type { ToolResultEntry } from '@crux/core/adapter'
import type { NativeAssistantTurn, NativeTranscriptCodec } from '@crux/core/adapter/profile'
import { toolModelOutputFromMetadata } from '@crux/core/adapter'
import { anthropicToolResultContent, isErrorToolModelOutput } from './tool-result-content'

/**
 * Canonical assistant turn data owned by the Anthropic message codec.
 *
 * This deliberately mirrors the subset of `AdapterResponse` that participates
 * in tool loops: assistant text and ordered tool calls. Usage, finish reasons,
 * response ids, and model ids stay in the adapter response normalizer.
 */
export type AnthropicAssistantTurn = NativeAssistantTurn

/** Parameters for appending an Anthropic assistant/tool-result round. */
export interface AppendAnthropicToolRoundParams {
  /** Existing canonical Crux transcript. */
  readonly history: readonly Message[]
  /** Assistant text and tool calls extracted from Anthropic content blocks. */
  readonly assistant: AnthropicAssistantTurn
  /** Tool execution results to feed back to Claude as `tool_result` blocks. */
  readonly toolResults: readonly ToolResultEntry[]
}

/**
 * Anthropic-owned translation boundary for messages and tool rounds.
 *
 * Anthropic's protocol differs from Crux's canonical transcript in important
 * ways: it has no `tool` role, assistant tool calls are `tool_use` content
 * blocks, and tool results are user messages with `tool_result` blocks. Keeping
 * those rules behind one object prevents the public converters, adapter calls,
 * and tool-loop appends from drifting apart.
 */
export interface AnthropicMessageToolRoundCodec {
  /** Convert canonical Crux messages into Anthropic request messages. */
  toAnthropicMessages(messages: readonly Message[]): Anthropic.MessageParam[]
  /** Convert Anthropic request messages into canonical Crux messages. */
  toCruxMessages(messages: readonly unknown[]): Message[]
  /** Read assistant text and tool calls from an Anthropic response message. */
  readAssistantTurn(message: Pick<Anthropic.Message, 'content'>): AnthropicAssistantTurn
  /** Append an assistant/tool-result round to canonical Crux history. */
  appendToolRound(params: AppendAnthropicToolRoundParams): Message[]
}

/** Anthropic provider transcript codec used by request builders and response normalization. */
export const anthropicTranscript = {
  fromMessages: toAnthropicMessages,
  toMessages: toCruxMessages,
  readAssistant: readAssistantTurn,
  appendToolRound: (history, assistant, results) => appendToolRound({ history, assistant, toolResults: results }),
} satisfies NativeTranscriptCodec<Anthropic.MessageParam, Pick<Anthropic.Message, 'content'>>

/** Anthropic provider-history codec used by both public converters and the adapter. */
export const anthropicMessageToolRoundCodec: AnthropicMessageToolRoundCodec = {
  toAnthropicMessages,
  toCruxMessages,
  readAssistantTurn,
  appendToolRound,
}

/**
 * Convert Anthropic message params into canonical Crux messages.
 *
 * Anthropic has no provider `tool` role. Incoming `tool_use` blocks are exposed
 * as assistant `metadata.toolCalls`, while `tool_result` blocks remain on user
 * messages as `metadata.toolResults` so callers can inspect provider-native
 * transcripts without losing the original role structure.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return anthropicMessageToolRoundCodec.toCruxMessages(sdkMessages)
}

/**
 * Convert canonical Crux messages into Anthropic request messages.
 *
 * This is a provider-history converter, not a generic cross-provider transcript
 * API. Anthropic-specific tool-round semantics remain owned by
 * {@link anthropicMessageToolRoundCodec}.
 */
export function fromMessages(messages: readonly Message[]): Anthropic.MessageParam[] {
  return anthropicMessageToolRoundCodec.toAnthropicMessages(messages)
}

function toCruxMessages(sdkMessages: readonly unknown[]): Message[] {
  return sdkMessages.map((value) => {
    const msg = isAnthropicMessageParam(value) ? value : { role: 'user' as const, content: String(value ?? '') }
    let content: string
    const metadata: Record<string, unknown> = {}

    if (typeof msg.content === 'string') {
      content = msg.content
    } else {
      const textParts: string[] = []
      const toolCalls: Array<{ id: string; name: string; args: unknown }> = []
      const toolResults: Array<{ toolCallId: string; content: string; isError?: boolean }> = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, args: block.input })
        } else if (block.type === 'tool_result') {
          toolResults.push({
            toolCallId: block.tool_use_id,
            content: anthropicToolResultText(block.content),
            ...(block.is_error ? { isError: true } : {}),
          })
        }
      }

      content = textParts.join('')
      if (toolCalls.length > 0) metadata.toolCalls = toolCalls
      if (toolResults.length > 0) metadata.toolResults = toolResults
    }

    return {
      role: msg.role as Message['role'],
      content,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }
  })
}

function toAnthropicMessages(messages: readonly Message[]): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      const modelOutput = toolModelOutputFromMetadata(msg.metadata)
      return {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: typeof msg.metadata?.toolCallId === 'string' ? msg.metadata.toolCallId : '',
            content: anthropicToolResultContent(modelOutput, msg.content),
            ...(isErrorToolModelOutput(modelOutput) ? { is_error: true } : {}),
          },
        ],
      }
    }

    const toolCalls = anthropicToolCallsFromMetadata(msg.metadata?.toolCalls)
    if (msg.role === 'assistant' && toolCalls.length > 0) {
      const blocks: Anthropic.ContentBlockParam[] = []
      if (msg.content) {
        blocks.push({
          type: 'text' as const,
          text: typeof msg.content === 'string' ? msg.content : String(msg.content),
        })
      }
      for (const toolCall of toolCalls) {
        blocks.push({ type: 'tool_use' as const, id: toolCall.id, name: toolCall.name, input: toolCall.input })
      }
      return { role: 'assistant' as const, content: blocks }
    }

    const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : 'user'
    return {
      role: role as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
    }
  })
}

function readAssistantTurn(message: Pick<Anthropic.Message, 'content'>): AnthropicAssistantTurn {
  const content = (message as { readonly content?: unknown }).content
  if (typeof content === 'string') return { text: content, toolCalls: undefined }
  if (!Array.isArray(content)) return { text: '', toolCalls: undefined }

  const textParts: string[] = []
  const toolCalls: Array<{ id: string; name: string; args: unknown }> = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input })
    }
  }

  return {
    text: textParts.join(''),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

function appendToolRound(params: AppendAnthropicToolRoundParams): Message[] {
  const assistantMetadata =
    params.assistant.toolCalls && params.assistant.toolCalls.length > 0
      ? { toolCalls: params.assistant.toolCalls }
      : undefined

  return [
    ...params.history,
    {
      role: 'assistant' as const,
      content: params.assistant.text,
      ...(assistantMetadata ? { metadata: assistantMetadata } : {}),
    },
    ...params.toolResults.map(
      (toolResult): Message => ({
        role: 'tool',
        content: toolResult.content,
        metadata: {
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.name,
          modelOutput: toolResult.modelOutput,
        },
      }),
    ),
  ]
}

interface AnthropicToolCall {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

function anthropicToolCallsFromMetadata(value: unknown): AnthropicToolCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): AnthropicToolCall[] => {
    if (!isRecord(item)) return []
    if (typeof item.id !== 'string' || typeof item.name !== 'string') return []
    return [{ id: item.id, name: item.name, input: anthropicToolInput(item.args) }]
  })
}

function anthropicToolInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  return { value }
}

function anthropicToolResultText(content: Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAnthropicMessageParam(value: unknown): value is Anthropic.MessageParam {
  return isRecord(value) && (value.role === 'user' || value.role === 'assistant') && 'content' in value
}
