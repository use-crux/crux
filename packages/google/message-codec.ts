import type { Content, FunctionResponsePart, GenerateContentResponse } from '@google/genai'
import type { Message, ToolContentPart, ToolModelOutput } from '@crux/core'
import type { NativeAssistantTurn, NativeTranscriptCodec } from '@crux/core/adapter/profile'
import { renderToolContentPartAsText, toolModelOutputFromMetadata } from '@crux/core/adapter'

/** Google assistant turn data owned by the transcript codec. */
export type GoogleAssistantTurn = NativeAssistantTurn

/** Google provider transcript codec used by request builders and response normalization. */
export const googleTranscript = {
  fromMessages: messagesToGoogleContents,
  toMessages,
  readAssistant: readGoogleAssistant,
} satisfies NativeTranscriptCodec<Content, GenerateContentResponse>

/**
 * Convert Google GenAI `Content[]` into canonical Crux messages.
 *
 * Google uses `model`/`user` roles and `parts` arrays. Text parts become
 * canonical message content. `functionCall` parts become assistant
 * `metadata.toolCalls`, and `functionResponse` parts become canonical tool
 * messages so callers can round-trip provider-owned tool conversations through
 * the public converter.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return sdkMessages.map((value) => {
    const msg = isGoogleContentLike(value) ? value : { role: 'user', parts: [{ text: String(value ?? '') }] }
    const parts = msg.parts ?? []
    const toolResponse = googleToolMessageFromParts(parts)
    if (toolResponse) return toolResponse

    const content = googleTextFromParts(parts)
    const role = msg.role === 'model' ? ('assistant' as const) : normalizeRole(msg.role ?? 'user')
    const toolCalls = role === 'assistant' ? googleToolCallsFromParts(parts) : []

    return {
      role,
      content,
      ...(toolCalls.length > 0 ? { metadata: { toolCalls } } : {}),
    }
  })
}

/**
 * Convert canonical Crux messages into Google GenAI `Content[]`.
 *
 * Assistant tool-call metadata becomes `functionCall` parts. Canonical `tool`
 * messages become user-role `functionResponse` parts, preserving rich media
 * as Google inline data when the provider accepts it.
 */
export function fromMessages(messages: readonly Message[]): Content[] {
  return googleTranscript.fromMessages(messages)
}

/** Convert canonical Crux messages to provider-native Google contents. */
export function messagesToGoogleContents(messages: readonly Message[]): Content[] {
  return messages
    .filter((msg) => msg.role !== 'system')
    .map((msg): Content => {
      if (msg.role === 'tool') return googleToolContent(msg)
      if (msg.role === 'assistant') return googleAssistantContent(msg)
      return {
        role: msg.role,
        parts: [{ text: msg.content }],
      }
    })
}

/** Read assistant transcript text and function-call intent from a Google response. */
export function readGoogleAssistant(response: GenerateContentResponse): GoogleAssistantTurn {
  const parts = (response.candidates?.[0]?.content?.parts ?? []) as readonly GoogleInboundPart[]
  const toolCalls = googleToolCallsFromParts(parts)

  return {
    text: response.text ?? googleTextFromParts(parts),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

type GoogleInboundPart = {
  readonly text?: string
  readonly functionCall?: unknown
  readonly functionResponse?: unknown
}

interface GoogleContentLike {
  readonly role?: string
  readonly parts?: readonly GoogleInboundPart[]
}

interface GoogleFunctionCall {
  readonly id?: string
  readonly name?: string
  readonly args?: unknown
}

interface GoogleFunctionResponse {
  readonly id?: string
  readonly name?: string
  readonly response?: unknown
}

interface GoogleToolCallMetadata {
  readonly id: string
  readonly name: string
  readonly args: unknown
}

function normalizeRole(role: string): Message['role'] {
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role
  }
  return 'user'
}

function googleTextFromParts(parts: readonly GoogleInboundPart[]): string {
  return parts.flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join('')
}

function googleToolCallsFromParts(parts: readonly GoogleInboundPart[]): GoogleToolCallMetadata[] {
  return parts.flatMap((part, index): GoogleToolCallMetadata[] => {
    if (!isGoogleFunctionCall(part.functionCall)) return []
    return [
      {
        id: part.functionCall.id ?? `tc_${index}`,
        name: part.functionCall.name ?? '',
        args: part.functionCall.args,
      },
    ]
  })
}

function googleToolMessageFromParts(parts: readonly GoogleInboundPart[]): Message | undefined {
  const response = parts.find((part) => isGoogleFunctionResponse(part.functionResponse))?.functionResponse
  if (!isGoogleFunctionResponse(response)) return undefined

  return {
    role: 'tool',
    content: googleFunctionResponseContent(response.response),
    metadata: {
      toolCallId: response.id ?? '',
      toolName: response.name ?? 'tool',
    },
  }
}

function googleAssistantContent(msg: Message): Content {
  const toolCalls = toolCallsFromMetadata(msg.metadata?.toolCalls)
  if (toolCalls.length === 0) {
    return { role: 'model', parts: [{ text: msg.content }] }
  }

  return {
    role: 'model',
    parts: [
      ...(msg.content ? [{ text: msg.content }] : []),
      ...toolCalls.map((toolCall) => ({
        functionCall: {
          id: toolCall.id,
          name: toolCall.name,
          args: googleFunctionArgs(toolCall.args),
        },
      })),
    ],
  }
}

function toolCallsFromMetadata(value: unknown): GoogleToolCallMetadata[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): GoogleToolCallMetadata[] => {
    if (!isToolCallMetadata(item)) return []
    return [{ id: item.id, name: item.name, args: item.args }]
  })
}

function isToolCallMetadata(value: unknown): value is GoogleToolCallMetadata {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string'
}

function googleFunctionArgs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  return { value }
}

function googleToolContent(msg: Message): Content {
  const toolCallId = typeof msg.metadata?.toolCallId === 'string' ? msg.metadata.toolCallId : ''
  const toolName = typeof msg.metadata?.toolName === 'string' ? msg.metadata.toolName : 'tool'
  const modelOutput = toolModelOutputFromMetadata(msg.metadata)
  const response = googleToolResponse(modelOutput, msg.content)
  const parts = modelOutput?.type === 'content' ? googleFunctionResponseParts(modelOutput.value) : []

  return {
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: toolCallId,
          name: toolName,
          response,
          ...(parts.length > 0 ? { parts } : {}),
        },
      },
    ],
  }
}

function googleToolResponse(modelOutput: ToolModelOutput | undefined, fallback: string): Record<string, unknown> {
  if (!modelOutput) return { output: fallback }

  switch (modelOutput.type) {
    case 'text':
      return { output: modelOutput.value }
    case 'json':
      return { output: modelOutput.value }
    case 'execution-denied':
      return { denied: true, reason: modelOutput.reason ?? 'Tool execution denied.' }
    case 'error-text':
      return { error: modelOutput.value }
    case 'error-json':
      return { error: modelOutput.value }
    case 'content':
      return { output: modelOutput.value.map(renderToolContentPartAsText).join('\n') }
  }
}

function googleFunctionResponseParts(parts: readonly ToolContentPart[]): FunctionResponsePart[] {
  return parts.flatMap((part): FunctionResponsePart[] => {
    switch (part.type) {
      case 'media':
      case 'image-data':
        return [{ inlineData: { data: part.data, mimeType: part.mediaType } }]
      case 'file-data':
        return [
          {
            inlineData: {
              data: part.data,
              mimeType: part.mediaType,
              ...(part.filename ? { displayName: part.filename } : {}),
            },
          },
        ]
      default:
        return []
    }
  })
}

function isGoogleFunctionCall(value: unknown): value is GoogleFunctionCall {
  if (!isRecord(value)) return false
  return optionalString(value.id) && optionalString(value.name)
}

function isGoogleFunctionResponse(value: unknown): value is GoogleFunctionResponse {
  if (!isRecord(value)) return false
  return optionalString(value.id) && optionalString(value.name)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGoogleContentLike(value: unknown): value is GoogleContentLike {
  return isRecord(value) && (value.parts === undefined || Array.isArray(value.parts))
}

function googleFunctionResponseContent(value: unknown): string {
  const json = JSON.stringify(value ?? {})
  return json ?? String(value)
}
