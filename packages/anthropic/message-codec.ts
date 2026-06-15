import type Anthropic from '@anthropic-ai/sdk'
import type { Message, ToolContentPart, ToolModelOutput } from '@crux/core'
import { renderToolContentPartAsText, toolModelOutputFromMetadata } from '@crux/core/adapter'

/**
 * Convert Anthropic message params into canonical Crux messages.
 *
 * Anthropic has no provider `tool` role. Incoming `tool_use` blocks are exposed
 * as assistant `metadata.toolCalls`, while `tool_result` blocks remain on user
 * messages as `metadata.toolResults` so callers can inspect provider-native
 * transcripts without losing the original role structure.
 */
export function toMessages(sdkMessages: Anthropic.MessageParam[]): Message[] {
  return sdkMessages.map((msg) => {
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

/**
 * Convert canonical Crux messages into Anthropic message params.
 *
 * Canonical tool messages are encoded as Anthropic `user` messages containing a
 * `tool_result` block. Assistant tool-call metadata is encoded as `tool_use`
 * blocks in the same content array as optional assistant text.
 */
export function fromMessages(messages: Message[]): Anthropic.MessageParam[] {
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

interface AnthropicToolCall {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

type AnthropicToolResultContent =
  | string
  | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>

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

function anthropicToolResultContent(
  modelOutput: ToolModelOutput | undefined,
  fallback: string,
): AnthropicToolResultContent {
  if (!modelOutput) return fallback

  switch (modelOutput.type) {
    case 'text':
    case 'error-text':
      return modelOutput.value
    case 'json':
    case 'error-json':
      return JSON.stringify(modelOutput.value)
    case 'execution-denied':
      return modelOutput.reason ? `Tool execution denied: ${modelOutput.reason}` : 'Tool execution denied.'
    case 'content':
      return anthropicContentBlocks(modelOutput.value)
  }
}

function anthropicContentBlocks(
  parts: readonly ToolContentPart[],
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam> {
  return parts.flatMap(
    (part): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam> => {
      switch (part.type) {
        case 'text':
          return [{ type: 'text', text: part.text }]
        case 'image-data':
          return isAnthropicImageMediaType(part.mediaType)
            ? [{ type: 'image', source: { type: 'base64', data: part.data, media_type: part.mediaType } }]
            : [{ type: 'text', text: renderToolContentPartAsText(part) }]
        case 'image-url':
          return [{ type: 'image', source: { type: 'url', url: part.url } }]
        case 'media':
          if (isAnthropicImageMediaType(part.mediaType)) {
            return [{ type: 'image', source: { type: 'base64', data: part.data, media_type: part.mediaType } }]
          }
          if (part.mediaType === 'application/pdf') {
            return [{ type: 'document', source: { type: 'base64', data: part.data, media_type: 'application/pdf' } }]
          }
          return [{ type: 'text', text: renderToolContentPartAsText(part) }]
        case 'file-data':
          if (part.mediaType === 'application/pdf') {
            return [
              {
                type: 'document',
                source: { type: 'base64', data: part.data, media_type: 'application/pdf' },
                ...(part.filename ? { title: part.filename } : {}),
              },
            ]
          }
          return [{ type: 'text', text: renderToolContentPartAsText(part) }]
        default:
          return [{ type: 'text', text: renderToolContentPartAsText(part) }]
      }
    },
  )
}

function isAnthropicImageMediaType(
  mediaType: string,
): mediaType is 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  return (
    mediaType === 'image/jpeg' || mediaType === 'image/png' || mediaType === 'image/gif' || mediaType === 'image/webp'
  )
}

function isErrorToolModelOutput(output: ToolModelOutput | undefined): boolean {
  return output?.type === 'error-text' || output?.type === 'error-json'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
