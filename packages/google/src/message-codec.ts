import type { Content, GenerateContentResponse } from '@google/genai'
import type { Message } from '@use-crux/core'
import { defineProviderTranscriptCodec } from '@use-crux/core/adapter'
import type {
  NativeAssistantTurn,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
} from '@use-crux/core/adapter'
import { googleContentParts, googleContentText, googlePartsText, messageContentFromGoogleParts } from './content-parts'
import type { GoogleInboundPart } from './content-parts'
import { googleFunctionResponseContent, googleFunctionResponseParts, googleToolResponse } from './function-response'

/** Google assistant turn data read from a generate-content response. */
export type GoogleAssistantTurn = NativeAssistantTurn

/**
 * Google GenAI wire dialect for the canonical transcript IR.
 *
 * Google uses `model`/`user` roles and `parts` arrays. Assistant tool calls are
 * `functionCall` parts; tool results are user-role `functionResponse` parts with
 * rich media carried as inline data. Core extracts the neutral units; this
 * dialect only translates them to and from Google `Content` values.
 */
const googleDialect: ProviderTranscriptDialect<Content, GenerateContentResponse> = {
  encodeContent: ({ role, content }, options) =>
    role === 'system'
      ? (googleContentText(role, content, options), undefined)
      : { role: 'user', parts: googleContentParts(role, content, options) },
  encodeAssistant: ({ content, toolCalls }, options) =>
    encodeAssistant(googleContentText('assistant', content, options), toolCalls ?? []),
  encodeToolResults: ({ results }, _helpers, options) => results.map((result) => encodeToolResult(result, options)),
  decodeMessage: decodeMessage,
  readAssistant: readGoogleAssistant,
}

/** Google provider transcript codec used by request builders and response normalization. */
export const googleTranscript = defineProviderTranscriptCodec(googleDialect)

/**
 * Convert canonical Crux messages into Google GenAI `Content[]`.
 *
 * Compatibility wrapper around the compiled {@link googleTranscript} codec.
 */
export function fromMessages(messages: readonly Message[]): Content[] {
  return [...googleTranscript.fromMessages(messages)]
}

/**
 * Convert Google GenAI `Content[]` back into canonical Crux messages.
 *
 * Compatibility wrapper around {@link googleTranscript}.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return googleTranscript.toMessages(sdkMessages)
}

/** Read assistant transcript text and function-call intent from a Google response. */
export function readGoogleAssistant(response: GenerateContentResponse): GoogleAssistantTurn {
  const parts = (response.candidates?.[0]?.content?.parts ?? []) as readonly GoogleInboundPart[]
  const toolCalls = toolCallsFromParts(parts)
  const content = messageContentFromGoogleParts(parts)
  const projectedText = googlePartsText(parts)
  return {
    text: Array.isArray(content) ? projectedText : (response.text ?? projectedText),
    ...(Array.isArray(content) ? { content } : {}),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

function encodeAssistant(text: string, toolCalls: readonly ProviderToolCall[]): Content {
  if (toolCalls.length === 0) return { role: 'model', parts: [{ text }] }
  return {
    role: 'model',
    parts: [
      ...(text ? [{ text }] : []),
      ...toolCalls.map((toolCall) => ({
        functionCall: {
          id: toolCall.id,
          name: toolCall.name,
          args: functionArgs(toolCall.args),
        },
      })),
    ],
  }
}

function encodeToolResult(result: ProviderToolResult, options: { readonly unsupportedContent?: 'degrade' | 'error' }): Content {
  const parts =
    result.modelOutput?.type === 'content'
      ? googleFunctionResponseParts(result.modelOutput.value, {
          provider: 'google',
          role: 'tool',
          unsupportedContent: options.unsupportedContent,
          reason: 'unsupported Google function-response content part',
        })
      : []
  return {
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: result.toolCallId,
          name: result.toolName ?? 'tool',
          response: googleToolResponse(result.modelOutput, result.text),
          ...(parts.length > 0 ? { parts } : {}),
        },
      },
    ],
  }
}

function decodeMessage(value: unknown): ProviderTranscriptUnit {
  const content = isGoogleContentLike(value) ? value : { role: 'user', parts: [{ text: String(value ?? '') }] }
  const parts = content.parts ?? []

  const functionResponses = parts.flatMap((part) =>
    isFunctionResponse(part.functionResponse) ? [part.functionResponse] : [],
  )
  if (functionResponses.length > 0) {
    return {
      kind: 'tool-results',
      results: functionResponses.map((functionResponse) => ({
        toolCallId: functionResponse.id ?? '',
        toolName: functionResponse.name ?? 'tool',
        text: googleFunctionResponseContent(functionResponse.response),
      })),
    }
  }

  if (content.role === 'model') {
    const toolCalls = toolCallsFromParts(parts)
    return {
      kind: 'assistant',
      content: messageContentFromGoogleParts(parts),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  }
  return { kind: 'content', role: 'user', content: messageContentFromGoogleParts(parts) }
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

function toolCallsFromParts(parts: readonly GoogleInboundPart[]): ProviderToolCall[] {
  return parts.flatMap((part, index): ProviderToolCall[] => {
    if (!isFunctionCall(part.functionCall)) return []
    return [
      {
        id: part.functionCall.id ?? `tc_${index}`,
        name: part.functionCall.name ?? '',
        args: part.functionCall.args,
      },
    ]
  })
}

function functionArgs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value }
}

function isFunctionCall(value: unknown): value is GoogleFunctionCall {
  return isRecord(value) && optionalString(value.id) && optionalString(value.name)
}

function isFunctionResponse(value: unknown): value is GoogleFunctionResponse {
  return isRecord(value) && optionalString(value.id) && optionalString(value.name)
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
