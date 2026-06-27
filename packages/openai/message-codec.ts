import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { Message } from '@use-crux/core'
import { defineProviderTranscriptCodec, renderToolContentPartAsText } from '@use-crux/core/adapter'
import type {
  NativeAssistantTurn,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
  ToolResultEncodingHelpers,
} from '@use-crux/core/adapter'

/** OpenAI assistant turn data read from a chat-completion response. */
export type OpenAIAssistantTurn = NativeAssistantTurn

/**
 * OpenAI wire dialect for the canonical transcript IR.
 *
 * OpenAI keeps system and user turns as plain role messages, encodes assistant
 * tool calls as a `tool_calls` array, and represents tool results as dedicated
 * `tool` role messages keyed by `tool_call_id`. Core extracts the neutral units
 * and tool-result helpers; this dialect only handles the chat-completion wire
 * format, including JSON argument and rich-content rendering.
 */
const openAIDialect: ProviderTranscriptDialect<OpenAI.ChatCompletionMessageParam, ChatCompletion> = {
  encodeText: ({ role, text }) => ({ role, content: text }),
  encodeAssistant: ({ text, toolCalls }) => encodeAssistant(text, toolCalls ?? []),
  encodeToolResults: ({ results }, helpers) => results.map((result) => encodeToolResult(result, helpers)),
  decodeMessage: decodeMessage,
  readAssistant: readOpenAIAssistant,
}

/** OpenAI provider transcript codec used by request builders and response normalization. */
export const openAITranscript = defineProviderTranscriptCodec(openAIDialect)

/**
 * Convert canonical Crux messages into OpenAI chat-completion messages.
 *
 * Compatibility wrapper around the compiled {@link openAITranscript} codec.
 */
export function fromMessages(messages: readonly Message[]): OpenAI.ChatCompletionMessageParam[] {
  return [...openAITranscript.fromMessages(messages)]
}

/**
 * Convert OpenAI chat messages back into canonical Crux messages.
 *
 * Compatibility wrapper around {@link openAITranscript}.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return openAITranscript.toMessages(sdkMessages)
}

/** Read assistant transcript text and tool-call intent from an OpenAI response. */
export function readOpenAIAssistant(result: ChatCompletion): OpenAIAssistantTurn {
  const choiceMessage = result.choices?.[0]?.message as OpenAI.ChatCompletionMessage | undefined
  const toolCalls = toolCallsFromProvider(choiceMessage?.tool_calls)
  return {
    text: textContent(choiceMessage?.content),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

function encodeAssistant(text: string, toolCalls: readonly ProviderToolCall[]): OpenAI.ChatCompletionMessageParam {
  if (toolCalls.length === 0) return { role: 'assistant', content: text }
  return {
    role: 'assistant',
    content: text || null,
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: encodeArguments(toolCall.args),
      },
    })),
  }
}

function encodeToolResult(
  result: ProviderToolResult,
  helpers: ToolResultEncodingHelpers,
): OpenAI.ChatCompletionToolMessageParam {
  const parts = helpers.contentParts(result)
  return {
    role: 'tool',
    content: parts
      ? parts.map(
          (part): OpenAI.ChatCompletionContentPartText => ({
            type: 'text',
            text: renderToolContentPartAsText(part),
          }),
        )
      : helpers.plainText(result),
    tool_call_id: result.toolCallId,
  }
}

interface OpenAIMessageLike {
  readonly role: string
  readonly content: unknown
  readonly tool_call_id?: unknown
  readonly name?: unknown
  readonly tool_calls?: unknown
  readonly [key: string]: unknown
}

function decodeMessage(value: unknown): ProviderTranscriptUnit {
  const message = isOpenAIMessageLike(value) ? value : { role: 'user', content: value }
  const role = normalizeRole(message.role)
  const text = textContent(message.content)

  if (role === 'tool') {
    return {
      kind: 'tool-results',
      results: [
        {
          toolCallId: typeof message.tool_call_id === 'string' ? message.tool_call_id : '',
          ...(typeof message.name === 'string' ? { toolName: message.name } : {}),
          text,
        },
      ],
    }
  }

  if (role === 'assistant') {
    const toolCalls = toolCallsFromProvider(message.tool_calls)
    return {
      kind: 'assistant',
      text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  }

  return { kind: 'text', role, text }
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.flatMap((part) => (isTextPart(part) ? [part.text] : [])).join('')
  }
  return String(content ?? '')
}

function isTextPart(value: unknown): value is { readonly type: 'text'; readonly text: string } {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string'
}

function toolCallsFromProvider(value: unknown): ProviderToolCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ProviderToolCall[] => {
    if (!isRecord(item) || typeof item.id !== 'string') return []
    if (item.type !== 'function' || !isRecord(item.function)) return []
    if (typeof item.function.name !== 'string') return []
    return [
      {
        id: item.id,
        name: item.function.name,
        args: typeof item.function.arguments === 'string' ? safeParseJson(item.function.arguments) : undefined,
      },
    ]
  })
}

function encodeArguments(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {})
}

function normalizeRole(role: string): 'system' | 'user' | 'assistant' | 'tool' {
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') return role
  return 'user'
}

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOpenAIMessageLike(value: unknown): value is OpenAIMessageLike {
  return isRecord(value) && typeof value.role === 'string' && 'content' in value
}
