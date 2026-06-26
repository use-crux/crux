import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { Message } from '@use-crux/core'
import type { NativeAssistantTurn, NativeTranscriptCodec } from '@use-crux/core/adapter'
import { renderToolContentPartAsText, toolModelOutputFromMetadata } from '@use-crux/core/adapter'

/** OpenAI assistant turn data owned by the transcript codec. */
export type OpenAIAssistantTurn = NativeAssistantTurn

/** OpenAI provider transcript codec used by request builders and response normalization. */
export const openAITranscript = {
  fromMessages: fromCruxMessages,
  toMessages: toCruxMessages,
  readAssistant: readOpenAIAssistant,
} satisfies NativeTranscriptCodec<OpenAI.ChatCompletionMessageParam, ChatCompletion>

/**
 * Convert OpenAI chat messages into canonical Crux messages.
 *
 * This converter covers the provider transcript shapes used by the native
 * adapter boundary: text content, tool result messages, and function tool
 * calls. It intentionally stays OpenAI-owned because argument encoding and
 * tool-call metadata are provider wire-format concerns.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return openAITranscript.toMessages(sdkMessages)
}

function toCruxMessages(sdkMessages: readonly unknown[]): Message[] {
  return sdkMessages.map((value) => {
    const msg = isOpenAIMessageLike(value) ? value : { role: 'user', content: value }
    const metadata: Record<string, unknown> = {}
    const toolCalls = openAIToolCallsFromProvider(msg.tool_calls)

    if (typeof msg.tool_call_id === 'string') metadata.toolCallId = msg.tool_call_id
    if (typeof msg.name === 'string') metadata.toolName = msg.name
    if (toolCalls.length > 0) metadata.toolCalls = toolCalls

    return {
      role: normalizeRole(msg.role),
      content: openAITextContent(msg.content),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }
  })
}

interface OpenAIMessageLike {
  readonly role: string
  readonly content: unknown
  readonly tool_call_id?: unknown
  readonly name?: unknown
  readonly tool_calls?: unknown
  readonly [key: string]: unknown
}

/**
 * Convert canonical Crux messages into OpenAI chat-completion messages.
 *
 * Tool-call metadata is encoded as OpenAI `tool_calls`, while canonical `tool`
 * messages become OpenAI tool-result messages with `tool_call_id`.
 */
export function fromMessages(messages: readonly Message[]): OpenAI.ChatCompletionMessageParam[] {
  return openAITranscript.fromMessages(messages)
}

function fromCruxMessages(messages: readonly Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg): OpenAI.ChatCompletionMessageParam => {
    const toolCalls = openAIToolCallsFromMetadata(msg.metadata?.toolCalls)
    if (msg.role === 'assistant' && toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: openAIArguments(toolCall.args),
          },
        })),
      }
    }

    const result: Record<string, unknown> = {
      role: msg.role,
      content: msg.role === 'tool' ? openAIToolContent(msg) : msg.content,
    }
    if (typeof msg.metadata?.toolCallId === 'string') result.tool_call_id = msg.metadata.toolCallId
    if (msg.role !== 'tool' && typeof msg.metadata?.toolName === 'string') result.name = msg.metadata.toolName

    return result as unknown as OpenAI.ChatCompletionMessageParam
  })
}

/** Read assistant transcript text and tool-call intent from an OpenAI response. */
export function readOpenAIAssistant(result: ChatCompletion): OpenAIAssistantTurn {
  const choiceMessage = result.choices?.[0]?.message as OpenAI.ChatCompletionMessage | undefined
  const toolCalls = openAIToolCallsFromProvider(choiceMessage?.tool_calls)

  return {
    text: openAITextContent(choiceMessage?.content),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

interface OpenAIToolCall {
  readonly id: string
  readonly name: string
  readonly args: unknown
}

function openAITextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.flatMap((part) => (isOpenAITextPart(part) ? [part.text] : [])).join('')
  }
  return String(content ?? '')
}

function isOpenAITextPart(value: unknown): value is { readonly type: 'text'; readonly text: string } {
  if (!isRecord(value)) return false
  return value.type === 'text' && typeof value.text === 'string'
}

function openAIToolCallsFromProvider(value: unknown): OpenAIToolCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): OpenAIToolCall[] => {
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

function openAIToolCallsFromMetadata(value: unknown): OpenAIToolCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): OpenAIToolCall[] => {
    if (!isRecord(item)) return []
    if (typeof item.id !== 'string' || typeof item.name !== 'string') return []
    return [{ id: item.id, name: item.name, args: item.args }]
  })
}

function openAIArguments(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? {})
}

function openAIToolContent(msg: Message): string | Array<OpenAI.ChatCompletionContentPartText> {
  const modelOutput = toolModelOutputFromMetadata(msg.metadata)
  if (modelOutput?.type !== 'content') return msg.content
  return modelOutput.value.map(
    (part): OpenAI.ChatCompletionContentPartText => ({
      type: 'text',
      text: renderToolContentPartAsText(part),
    }),
  )
}

function normalizeRole(role: string): Message['role'] {
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role
  }
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
