/**
 * Canonical transcript semantics owned by core.
 *
 * Everything in this module reads or writes Crux `Message` metadata so provider
 * dialects never have to: extracting neutral {@link ProviderTranscriptUnit}s
 * from a transcript, reconstructing canonical messages from units, appending a
 * tool round exactly once, and rendering the {@link ToolResultEncodingHelpers}
 * every dialect shares.
 *
 * @module
 */

import type { Message } from '../../../generation/messages'
import type { ToolContentPart, ToolModelOutput } from '../../../types/tool'
import { toolModelOutputFromMetadata } from '../../tool/emission'
import type { ToolResultEntry } from '../../types'
import type { NativeAssistantTurn } from '../types'
import type { ProviderToolCall, ProviderToolResult, ProviderTranscriptUnit, ToolResultEncodingHelpers } from './units'

/**
 * Extract neutral transcript units from a canonical Crux transcript.
 *
 * System and user messages become `text` units, assistant messages become
 * `assistant` units carrying any tool calls read from metadata, and runs of
 * adjacent `tool` messages collapse into one `tool-results` unit so a single
 * model turn's results stay together.
 *
 * @param messages - Canonical transcript to read.
 * @returns Neutral units in transcript order.
 */
export function messagesToTranscriptUnits(messages: readonly Message[]): ProviderTranscriptUnit[] {
  const units: ProviderTranscriptUnit[] = []
  let pendingResults: ProviderToolResult[] | undefined

  const flushResults = (): void => {
    if (pendingResults) {
      units.push({ kind: 'tool-results', results: pendingResults })
      pendingResults = undefined
    }
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      const result = toolResultFromMessage(message)
      if (result) (pendingResults ??= []).push(result)
      continue
    }

    flushResults()

    if (message.role === 'assistant') {
      const toolCalls = toolCallsFromMetadata(message.metadata?.toolCalls)
      units.push({
        kind: 'assistant',
        text: message.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      })
    } else {
      units.push({ kind: 'text', role: message.role, text: message.content })
    }
  }

  flushResults()
  return units
}

/**
 * Reconstruct a canonical Crux transcript from neutral units.
 *
 * This is the inverse of {@link messagesToTranscriptUnits}: a `tool-results`
 * unit fans back out to one canonical `tool` message per result, preserving the
 * tool name, model output, and error metadata each result carried.
 *
 * @param units - Neutral units to materialize.
 * @returns Canonical messages in unit order.
 */
export function transcriptUnitsToMessages(units: readonly ProviderTranscriptUnit[]): Message[] {
  return units.flatMap((unit): Message[] => {
    switch (unit.kind) {
      case 'text':
        return [{ role: unit.role, content: unit.text }]
      case 'assistant':
        return [
          {
            role: 'assistant',
            content: unit.text,
            ...(unit.toolCalls && unit.toolCalls.length > 0 ? { metadata: { toolCalls: [...unit.toolCalls] } } : {}),
          },
        ]
      case 'tool-results':
        return unit.results.map((result) => ({
          role: 'tool',
          content: result.text,
          metadata: toolResultMetadata(result),
        }))
    }
  })
}

/**
 * Append one assistant/tool-result round to a canonical transcript.
 *
 * This is the single canonical append law: it records the assistant turn (with
 * its tool calls) followed by one `tool` message per result, preserving model
 * output and error metadata so the next encode pass can render rich content.
 * Providers no longer need a bespoke append merely because their wire format
 * represents tool results differently.
 *
 * @param history - Existing canonical transcript.
 * @param assistant - Assistant turn that requested the tools.
 * @param results - Settled tool results to feed into the next call.
 * @returns A new canonical transcript including the round.
 */
export function appendCanonicalToolRound(
  history: readonly Message[],
  assistant: NativeAssistantTurn,
  results: readonly ToolResultEntry[],
): Message[] {
  const toolCalls = assistant.toolCalls
  return [
    ...history,
    {
      role: 'assistant',
      content: assistant.text,
      ...(toolCalls && toolCalls.length > 0 ? { metadata: { toolCalls } } : {}),
    },
    ...results.map(
      (result): Message => ({
        role: 'tool',
        content: result.content,
        metadata: {
          toolCallId: result.toolCallId,
          toolName: result.name,
          modelOutput: result.modelOutput,
          ...(result.isError !== undefined ? { isError: result.isError } : {}),
          ...(result.modelOutputError !== undefined ? { modelOutputError: result.modelOutputError } : {}),
        },
      }),
    ),
  ]
}

/**
 * Build the canonical tool-result renderers handed to dialect encoders.
 *
 * Centralizing fallback-text rendering, rich-content extraction, and the error
 * flag means every provider reads a {@link ProviderToolResult} identically.
 *
 * @returns Shared, stateless encoding helpers.
 */
export function createToolResultEncodingHelpers(): ToolResultEncodingHelpers {
  return {
    plainText: (result) => result.text,
    contentParts: (result) => contentPartsOf(result.modelOutput),
    errorFlag: (result) => result.isError === true || isErrorModelOutput(result.modelOutput),
  }
}

/**
 * Read a `ProviderToolResult` from a canonical `tool` message, or `undefined`
 * when the message lacks a usable `toolCallId`. A tool result with no call id
 * cannot be correlated on the wire, so it is dropped rather than emitted with a
 * fabricated empty id that would produce invalid provider output.
 */
function toolResultFromMessage(message: Message): ProviderToolResult | undefined {
  const metadata = message.metadata
  const toolCallId = metadata?.toolCallId
  if (typeof toolCallId !== 'string' || toolCallId === '') return undefined

  const modelOutput = toolModelOutputFromMetadata(metadata)
  return {
    toolCallId,
    ...(typeof metadata?.toolName === 'string' ? { toolName: metadata.toolName } : {}),
    text: message.content,
    ...(modelOutput ? { modelOutput } : {}),
    ...(typeof metadata?.isError === 'boolean' ? { isError: metadata.isError } : {}),
    ...(typeof metadata?.modelOutputError === 'string' ? { modelOutputError: metadata.modelOutputError } : {}),
  }
}

function toolResultMetadata(result: ProviderToolResult): Record<string, unknown> {
  return {
    toolCallId: result.toolCallId,
    ...(result.toolName !== undefined ? { toolName: result.toolName } : {}),
    ...(result.modelOutput !== undefined ? { modelOutput: result.modelOutput } : {}),
    ...(result.isError !== undefined ? { isError: result.isError } : {}),
    ...(result.modelOutputError !== undefined ? { modelOutputError: result.modelOutputError } : {}),
  }
}

function toolCallsFromMetadata(value: unknown): ProviderToolCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ProviderToolCall[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return []
    return [{ id: item.id, name: item.name, args: item.args }]
  })
}

function contentPartsOf(modelOutput: ToolModelOutput | undefined): readonly ToolContentPart[] | undefined {
  return modelOutput?.type === 'content' ? modelOutput.value : undefined
}

function isErrorModelOutput(modelOutput: ToolModelOutput | undefined): boolean {
  return modelOutput?.type === 'error-text' || modelOutput?.type === 'error-json'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
