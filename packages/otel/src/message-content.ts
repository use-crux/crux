/**
 * Opt-in GenAI message-content projection for generation artifacts.
 *
 * The record mapper calls this only for artifact records, keeping content policy
 * separate from lifecycle mapping and preserving the default no-content export.
 *
 * @module
 */

import type { CruxGraphRecord } from '@use-crux/core/observability'
import { contentText, type ContentPart, type MessageContent } from '@use-crux/core'
import type { OtelAttributes } from './attribute-mapper'
import {
  GEN_AI_INPUT_MESSAGES,
  GEN_AI_OUTPUT_MESSAGES,
  GEN_AI_SYSTEM_INSTRUCTIONS,
} from './semconv'
import type { TelemetryOptions } from './plugin'

const MAX_CONTENT_ATTRIBUTE_LENGTH = 32 * 1024

type ArtifactRecord = Extract<CruxGraphRecord, { type: 'artifact' }>

interface SemconvTextPart {
  readonly type: 'text'
  readonly content: string
}

interface SemconvMessage {
  readonly role: string
  readonly parts: readonly SemconvTextPart[]
}

interface CappedAttribute {
  readonly value: string
  readonly truncated?: boolean
}

/** Build opt-in GenAI message-content attributes for a generation artifact. */
export function messageContentAttributesForArtifact(
  record: ArtifactRecord,
  options: TelemetryOptions,
): OtelAttributes {
  if (!shouldCaptureMessageContent(options)) return {}
  if (record.kind !== 'messages' && record.kind !== 'output') return {}

  const preview = record.preview
  if (!preview || typeof preview !== 'object') return {}
  const attributes: OtelAttributes = {}

  if (record.kind === 'messages') {
    const messages = messagesFromPreview(preview, 'user')
    if (messages.length > 0) {
      const capped = capMessagesAttribute(messages)
      attributes[GEN_AI_INPUT_MESSAGES] = capped.value
      if (capped.truncated) attributes['crux.truncated'] = true
    }
    const systemInstructions = systemInstructionsFromPreview(preview)
    if (systemInstructions) {
      attributes[GEN_AI_SYSTEM_INSTRUCTIONS] = capAttribute(systemInstructions)
    }
  }

  if (record.kind === 'output') {
    const messages = messagesFromPreview(preview, 'assistant')
    if (messages.length > 0) {
      const capped = capMessagesAttribute(messages)
      attributes[GEN_AI_OUTPUT_MESSAGES] = capped.value
      if (capped.truncated) attributes['crux.truncated'] = true
    }
  }

  return attributes
}

function shouldCaptureMessageContent(options: TelemetryOptions): boolean {
  if (typeof options.captureMessageContent === 'boolean')
    return options.captureMessageContent
  return (
    runtimeEnv().OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true'
  )
}

function messagesFromPreview(
  preview: object,
  fallbackRole: string,
): readonly SemconvMessage[] {
  const record = preview as Record<string, unknown>
  const rawMessages = Array.isArray(record.messages)
    ? record.messages
    : undefined
  if (rawMessages) {
    return rawMessages.flatMap((item) => messageFromUnknown(item, fallbackRole))
  }

  const text = textFromRecord(record)
  return text ? [textMessage(fallbackRole, text)] : []
}

function messageFromUnknown(
  value: unknown,
  fallbackRole: string,
): readonly SemconvMessage[] {
  if (typeof value === 'string') return [textMessage(fallbackRole, value)]
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const content = textFromRecord(record)
  if (!content) return []
  const role =
    typeof record.role === 'string' && record.role.length > 0
      ? record.role
      : fallbackRole
  return [textMessage(role, content)]
}

function textFromRecord(record: Record<string, unknown>): string | undefined {
  for (const key of ['content', 'text', 'answer', 'value', 'output']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (isMessageContent(value)) {
      const text = contentText(value)
      if (text.length > 0) return text
    }
  }
  return undefined
}

function isMessageContent(value: unknown): value is MessageContent {
  return typeof value === 'string' || (Array.isArray(value) && value.every(isContentPart))
}

function isContentPart(value: unknown): value is ContentPart {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'text':
      return typeof value.text === 'string'
    case 'image':
      return isMediaSource(value.source) && optionalString(value.mediaType)
    case 'file':
      return isMediaSource(value.source) && optionalString(value.mediaType) && optionalString(value.filename)
    default:
      return false
  }
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isMediaSource(value: unknown): boolean {
  if (typeof value === 'string') return true
  if (value instanceof URL || value instanceof Uint8Array || value instanceof ArrayBuffer) return true
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'data':
      return (value.data instanceof Uint8Array || (typeof Blob !== 'undefined' && value.data instanceof Blob))
        && typeof value.mediaType === 'string'
    case 'url':
      return value.url instanceof URL && optionalString(value.mediaType)
    case 'provider-file':
      return typeof value.provider === 'string'
        && typeof value.fileId === 'string'
        && optionalString(value.mediaType)
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function systemInstructionsFromPreview(preview: object): string | undefined {
  const record = preview as Record<string, unknown>
  if (typeof record.system === 'string' && record.system.length > 0)
    return record.system
  if (Array.isArray(record.systemBlocks)) {
    const text = record.systemBlocks.flatMap((block) => {
      if (typeof block === 'string') return [block]
      if (!block || typeof block !== 'object') return []
      const maybeText = (block as Record<string, unknown>).text
      return typeof maybeText === 'string' && maybeText.length > 0
        ? [maybeText]
        : []
    })
    return text.length > 0 ? text.join('\n') : undefined
  }
  return undefined
}

function textMessage(role: string, content: string): SemconvMessage {
  return {
    role,
    parts: [{ type: 'text', content: capAttribute(content) }],
  }
}

function capAttribute(value: string): string {
  return value.length > MAX_CONTENT_ATTRIBUTE_LENGTH
    ? value.slice(0, MAX_CONTENT_ATTRIBUTE_LENGTH)
    : value
}

function capMessagesAttribute(
  messages: readonly SemconvMessage[],
): CappedAttribute {
  const serialized = JSON.stringify(messages)
  if (serialized.length <= MAX_CONTENT_ATTRIBUTE_LENGTH)
    return { value: serialized }

  let capped = messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => ({ ...part })),
  }))

  for (;;) {
    const next = JSON.stringify(capped)
    if (next.length <= MAX_CONTENT_ATTRIBUTE_LENGTH)
      return { value: next, truncated: true }
    const lastMessage = capped[capped.length - 1]
    const lastPart = lastMessage?.parts[lastMessage.parts.length - 1]
    if (!lastMessage || !lastPart || lastPart.content.length === 0)
      return { value: '[]', truncated: true }
    const overflow = next.length - MAX_CONTENT_ATTRIBUTE_LENGTH
    const keepLength = Math.max(0, lastPart.content.length - overflow - 1)
    capped = [
      ...capped.slice(0, -1),
      {
        ...lastMessage,
        parts: [
          ...lastMessage.parts.slice(0, -1),
          {
            ...lastPart,
            content: lastPart.content.slice(0, keepLength),
          },
        ],
      },
    ]
  }
}

function runtimeEnv(): Record<string, string | undefined> {
  const candidate = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process
  return candidate?.env ?? {}
}
