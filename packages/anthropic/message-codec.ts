import type Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@use-crux/core'
import { defineProviderTranscriptCodec } from '@use-crux/core/adapter'
import type {
  NativeAssistantTurn,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
  ToolResultEncodingHelpers,
} from '@use-crux/core/adapter'
import { anthropicToolResultContent } from './tool-result-content'

/**
 * Canonical assistant turn data read from Anthropic content blocks.
 *
 * This mirrors the subset of the adapter response that participates in tool
 * loops — assistant text and ordered tool calls. Usage, finish reasons, and
 * model ids stay in the adapter response normalizer.
 */
export type AnthropicAssistantTurn = NativeAssistantTurn

/**
 * Anthropic wire dialect for the canonical transcript IR.
 *
 * Anthropic's protocol has no `tool` role: assistant tool calls are `tool_use`
 * content blocks, and tool results are user messages carrying `tool_result`
 * blocks. Core supplies neutral transcript units and the tool-result encoding
 * helpers; this dialect only translates them to and from Anthropic blocks.
 */
const anthropicDialect: ProviderTranscriptDialect<Anthropic.MessageParam, Pick<Anthropic.Message, 'content'>> = {
  encodeText: ({ role, text }) => (role === 'system' ? undefined : { role, content: text }),
  encodeAssistant: ({ text, toolCalls }) => encodeAssistant(text, toolCalls ?? []),
  encodeToolResults: ({ results }, helpers) => results.map((result) => encodeToolResult(result, helpers)),
  decodeMessage: decodeMessage,
  readAssistant: readAssistantTurn,
}

/** Anthropic provider transcript codec used by request builders and response normalization. */
export const anthropicTranscript = defineProviderTranscriptCodec(anthropicDialect)

/**
 * Convert canonical Crux messages into Anthropic request messages.
 *
 * Compatibility wrapper around the compiled {@link anthropicTranscript} codec;
 * Anthropic-specific tool-round semantics are owned by the canonical IR in core.
 */
export function fromMessages(messages: readonly Message[]): Anthropic.MessageParam[] {
  return [...anthropicTranscript.fromMessages(messages)]
}

/**
 * Convert Anthropic request messages back into canonical Crux messages.
 *
 * Compatibility wrapper around {@link anthropicTranscript}: `tool_use` blocks
 * become assistant `metadata.toolCalls` and `tool_result` blocks become
 * canonical `tool` messages.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return anthropicTranscript.toMessages(sdkMessages)
}

function encodeAssistant(text: string, toolCalls: readonly ProviderToolCall[]): Anthropic.MessageParam {
  if (toolCalls.length === 0) return { role: 'assistant', content: text }

  const blocks: Anthropic.ContentBlockParam[] = []
  if (text) blocks.push({ type: 'text', text })
  for (const toolCall of toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: toolInput(toolCall.args),
    })
  }
  return { role: 'assistant', content: blocks }
}

function encodeToolResult(result: ProviderToolResult, helpers: ToolResultEncodingHelpers): Anthropic.MessageParam {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: result.toolCallId,
        content: anthropicToolResultContent(result.modelOutput, helpers.plainText(result)),
        ...(helpers.errorFlag(result) ? { is_error: true } : {}),
      },
    ],
  }
}

function decodeMessage(value: unknown): readonly ProviderTranscriptUnit[] {
  if (!isAnthropicMessageParam(value)) {
    return [{ kind: 'text', role: 'user', text: String(value ?? '') }]
  }

  if (typeof value.content === 'string') {
    return value.role === 'assistant'
      ? [{ kind: 'assistant', text: value.content }]
      : [{ kind: 'text', role: 'user', text: value.content }]
  }

  const textParts: string[] = []
  const toolCalls: ProviderToolCall[] = []
  const toolResults: ProviderToolResult[] = []

  for (const block of value.content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input })
    } else if (block.type === 'tool_result') {
      toolResults.push({
        toolCallId: block.tool_use_id,
        text: toolResultText(block.content),
        ...(block.is_error ? { isError: true } : {}),
      })
    }
  }

  const text = textParts.join('')
  if (value.role === 'assistant') {
    return [
      {
        kind: 'assistant',
        text,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    ]
  }

  const units: ProviderTranscriptUnit[] = []
  if (text) units.push({ kind: 'text', role: 'user', text })
  if (toolResults.length > 0) units.push({ kind: 'tool-results', results: toolResults })
  return units.length > 0 ? units : [{ kind: 'text', role: 'user', text: '' }]
}

function readAssistantTurn(message: Pick<Anthropic.Message, 'content'>): AnthropicAssistantTurn {
  const content = (message as { readonly content?: unknown }).content
  if (typeof content === 'string') return { text: content, toolCalls: undefined }
  if (!Array.isArray(content)) return { text: '', toolCalls: undefined }

  const textParts: string[] = []
  const toolCalls: ProviderToolCall[] = []

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

function toolInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value }
}

function toolResultText(content: Anthropic.ToolResultBlockParam['content']): string {
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
