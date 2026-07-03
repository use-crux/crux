/**
 * Opt-in GenAI message-content projection for generation artifacts.
 *
 * The record mapper calls this only for artifact records, keeping content policy
 * separate from lifecycle mapping and preserving the default no-content export.
 *
 * @module
 */

import type { CruxGraphRecord } from '@use-crux/core/observability'
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
      attributes[GEN_AI_INPUT_MESSAGES] = capAttribute(JSON.stringify(messages))
    }
    const systemInstructions = systemInstructionsFromPreview(preview)
    if (systemInstructions) {
      attributes[GEN_AI_SYSTEM_INSTRUCTIONS] = capAttribute(systemInstructions)
    }
  }

  if (record.kind === 'output') {
    const messages = messagesFromPreview(preview, 'assistant')
    if (messages.length > 0) {
      attributes[GEN_AI_OUTPUT_MESSAGES] = capAttribute(JSON.stringify(messages))
    }
  }

  return attributes
}

function shouldCaptureMessageContent(options: TelemetryOptions): boolean {
  if (typeof options.captureMessageContent === 'boolean') return options.captureMessageContent
  return process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true'
}

function messagesFromPreview(preview: object, fallbackRole: string): readonly SemconvMessage[] {
  const record = preview as Record<string, unknown>
  const rawMessages = Array.isArray(record.messages) ? record.messages : undefined
  if (rawMessages) {
    return rawMessages.flatMap((item) => messageFromUnknown(item, fallbackRole))
  }

  const text = textFromRecord(record)
  return text ? [textMessage(fallbackRole, text)] : []
}

function messageFromUnknown(value: unknown, fallbackRole: string): readonly SemconvMessage[] {
  if (typeof value === 'string') return [textMessage(fallbackRole, value)]
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const content = textFromRecord(record)
  if (!content) return []
  const role = typeof record.role === 'string' && record.role.length > 0 ? record.role : fallbackRole
  return [textMessage(role, content)]
}

function textFromRecord(record: Record<string, unknown>): string | undefined {
  for (const key of ['content', 'text', 'answer', 'value', 'output']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function systemInstructionsFromPreview(preview: object): string | undefined {
  const record = preview as Record<string, unknown>
  if (typeof record.system === 'string' && record.system.length > 0) return record.system
  if (Array.isArray(record.systemBlocks)) {
    const text = record.systemBlocks.flatMap((block) => {
      if (typeof block === 'string') return [block]
      if (!block || typeof block !== 'object') return []
      const maybeText = (block as Record<string, unknown>).text
      return typeof maybeText === 'string' && maybeText.length > 0 ? [maybeText] : []
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
  return value.length > MAX_CONTENT_ATTRIBUTE_LENGTH ? value.slice(0, MAX_CONTENT_ATTRIBUTE_LENGTH) : value
}
