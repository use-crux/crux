import {
  createUnsupportedCapabilityError,
  type AssistantContentPart,
  type ContentPart,
  type DiagnosticsPort,
  type Message,
  type MessageContent,
  type MediaSource,
  type ProviderOptions,
} from '@use-crux/core'
import { isRecord, readString } from './object-utils'

/** Options that affect AI SDK content-part conversion. */
export interface AiSdkContentPartOptions {
  /** Provider-facing name used in diagnostics. */
  readonly provider?: string
  /** Optional diagnostics sink for unknown native parts. */
  readonly diagnostics?: DiagnosticsPort
}

/**
 * Convert canonical Crux message content into AI SDK `ModelMessage` content.
 *
 * Media must already be usable at this boundary. Core-managed calls normalize
 * public URL/Blob/byte sources before invoking the AI SDK loop, while public
 * codecs accept native AI SDK message parts without adding Crux persistence.
 */
export function encodeContentForAiSdk(
  role: Message['role'],
  content: MessageContent | readonly AssistantContentPart[],
  options: AiSdkContentPartOptions = {},
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content
  if (role === 'system' && content.some((part) => part.type !== 'text')) {
    throw createUnsupportedCapabilityError({
      adapter: options.provider ?? 'ai-sdk',
      model: '<custom>',
      issues: [
        {
          capability: 'input.media.system',
          remediation: 'Move media to a user message before calling the AI SDK.',
        },
      ],
    })
  }
  return content.map((part) => encodePartForAiSdk(part, options))
}

/**
 * Decode AI SDK assistant text/image/file parts into canonical Crux content.
 *
 * Text-only arrays collapse back to a string to preserve text transcript shape.
 * Media-bearing arrays stay structured so assistant-returned files and images
 * survive in `result.messages`.
 */
export function decodeContentFromAiSdkParts(parts: readonly Record<string, unknown>[]): MessageContent {
  const content: Array<ContentPart | Record<string, unknown>> = []
  for (const part of parts) {
    const type = readString(part, 'type')
    const canonical = canonicalPartFrom(part)
    if (canonical) {
      content.push(canonical)
      continue
    }
    if (type === 'text') {
      content.push({ type: 'text', text: readString(part, 'text') ?? '', ...providerOptionsFrom(part) })
      continue
    }
    if (type === 'tool-call' || type === 'tool-approval-request' || type === 'tool-approval-response') {
      continue
    }
    if (type === 'image') {
      const image = part.image
      const mediaType = readString(part, 'mediaType')
      const source = nativeMediaSource(image, mediaType)
      if (source !== undefined) {
        content.push({
          type: 'image',
          source,
          ...(mediaType ? { mediaType } : {}),
          ...providerOptionsFrom(part),
        })
      } else {
        warnMalformedPart(part, 'AI SDK image parts require image and mediaType.')
      }
      continue
    }
    if (type === 'file') {
      const data = part.data
      const mediaType = readString(part, 'mediaType')
      const filename = readString(part, 'filename')
      const source = nativeMediaSource(data, mediaType)
      if (source !== undefined) {
        content.push(decodedFilePart(source, mediaType, filename, part))
      } else {
        warnMalformedPart(part, 'AI SDK file parts require data and mediaType.')
      }
      continue
    }
    warnUnknownPart(part)
    content.push(part)
  }

  if (content.every((part) => readString(part, 'type') === 'text')) {
    return content.map((part) => readString(part, 'text') ?? '').join('')
  }
  return content as MessageContent
}

function encodePartForAiSdk(
  part: AssistantContentPart | Record<string, unknown>,
  options: AiSdkContentPartOptions,
): Record<string, unknown> {
  const record = part as Record<string, unknown>
  const providerOptions = isRecord(record.providerOptions) ? (record.providerOptions as ProviderOptions) : undefined
  switch (readString(record, 'type')) {
    case 'text':
      return { type: 'text', text: readString(record, 'text') ?? '', ...(providerOptions ? { providerOptions } : {}) }
    case 'image': {
      const contentPart = part as Extract<ContentPart, { type: 'image' }>
      const image = sourceForAiSdk(contentPart.source, 'image', options)
      return {
        type: 'image',
        image,
        ...(contentPart.mediaType ? { mediaType: contentPart.mediaType } : {}),
        ...(providerOptions ? { providerOptions } : {}),
      }
    }
    // AI SDK ModelMessage content has no dedicated audio/video part; both lower
    // through the native `file` part, keyed only by mediaType.
    case 'audio':
    case 'video':
    case 'file': {
      const contentPart = part as Extract<ContentPart, { type: 'audio' | 'video' | 'file' }>
      const data = sourceForAiSdk(contentPart.source, contentPart.type, options)
      return {
        type: 'file',
        data,
        ...(contentPart.mediaType ? { mediaType: contentPart.mediaType } : {}),
        ...('filename' in contentPart && contentPart.filename ? { filename: contentPart.filename } : {}),
        ...(providerOptions ? { providerOptions } : {}),
      }
    }
    case 'tool-call': {
      const toolCallPart = part as Extract<AssistantContentPart, { type: 'tool-call' }>
      return {
        type: 'tool-call',
        toolCallId: toolCallPart.toolCallId,
        toolName: toolCallPart.toolName,
        input: toolCallPart.input,
        ...(providerOptions ? { providerOptions } : {}),
      }
    }
    case 'reasoning': {
      const reasoningPart = part as Extract<AssistantContentPart, { type: 'reasoning' }>
      return {
        type: 'reasoning',
        text: reasoningPart.text,
        ...(providerOptions ? { providerOptions } : {}),
      }
    }
    default:
      warnUnknownPart(record, options.diagnostics)
      return record
  }
}

function sourceForAiSdk(
  source: Extract<ContentPart, { type: 'image' | 'audio' | 'video' | 'file' }>['source'],
  kind: 'image' | 'audio' | 'video' | 'file',
  options: AiSdkContentPartOptions,
): unknown {
  if (typeof source === 'string' || source instanceof URL || source instanceof Uint8Array || source instanceof Blob) return source
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  switch (source.type) {
    case 'data':
      return source.data
    case 'url':
      return source.url
    case 'provider-file':
      throw createUnsupportedCapabilityError({
        adapter: options.provider ?? 'ai-sdk',
        model: '<custom>',
        issues: [
          {
            capability: `input.${kind}.provider-file`,
            mediaType: source.mediaType,
            remediation: 'Use an AI SDK-native file part or hydrate the file into data/URL first.',
          },
        ],
      })
  }
}

function providerOptionsFrom(part: Record<string, unknown>): { readonly providerOptions?: ProviderOptions } {
  const providerOptions = part.providerOptions
  return isRecord(providerOptions) ? { providerOptions: providerOptions as ProviderOptions } : {}
}

function canonicalPartFrom(part: Record<string, unknown>): ContentPart | undefined {
  const type = readString(part, 'type')
  switch (type) {
    case 'text': {
      const text = readString(part, 'text')
      return text === undefined ? undefined : { type, text, ...providerOptionsFrom(part) }
    }
    case 'image':
    case 'audio':
    case 'video': {
      const source = part.source
      return isMediaSource(source)
        ? {
            type,
            source,
            ...(readString(part, 'mediaType') ? { mediaType: readString(part, 'mediaType') } : {}),
            ...providerOptionsFrom(part),
          }
        : undefined
    }
    case 'file': {
      const source = part.source
      const mediaType = readString(part, 'mediaType')
      const filename = readString(part, 'filename')
      return isMediaSource(source) ? decodedFilePart(source, mediaType, filename, part) : undefined
    }
    default:
      return undefined
  }
}

function isMediaSource(value: unknown): value is Extract<ContentPart, { type: 'image' | 'file' }>['source'] {
  if (typeof value === 'string' || value instanceof URL || value instanceof Uint8Array || value instanceof ArrayBuffer) return true
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'data') {
    return (value.data instanceof Uint8Array || (typeof Blob !== 'undefined' && value.data instanceof Blob))
      && typeof value.mediaType === 'string'
  }
  if (value.type === 'url') return value.url instanceof URL
  if (value.type === 'provider-file') return typeof value.provider === 'string' && typeof value.fileId === 'string'
  return false
}

function dataAsset(data: string, mediaType: string): Extract<ContentPart, { type: 'image' | 'file' }>['source'] {
  return {
    type: 'data',
    data: new Uint8Array(Buffer.from(data, 'base64')),
    mediaType,
  }
}

function nativeMediaSource(value: unknown, mediaType: string | undefined): MediaSource | undefined {
  if (value instanceof URL || value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value
  return typeof value === 'string' && mediaType ? dataAsset(value, mediaType) : undefined
}

function decodedFilePart(
  source: MediaSource,
  mediaType: string | undefined,
  filename: string | undefined,
  native: Record<string, unknown>,
): ContentPart {
  const shared = {
    source,
    ...(mediaType ? { mediaType } : {}),
    ...providerOptionsFrom(native),
  }
  if (mediaType?.startsWith('image/')) return { type: 'image', ...shared }
  if (mediaType?.startsWith('audio/')) return { type: 'audio', ...shared }
  if (mediaType?.startsWith('video/')) return { type: 'video', ...shared }
  return {
    type: 'file',
    ...shared,
    ...(filename ? { filename } : {}),
  }
}

function warnUnknownPart(part: Record<string, unknown>, diagnostics?: DiagnosticsPort): void {
  warnAiSdkContentPart(diagnostics, '[@use-crux/ai] Passing through unrecognized AI SDK content part.', {
    partType: readString(part, 'type') ?? 'unknown',
  })
}

function warnMalformedPart(part: Record<string, unknown>, reason: string): void {
  warnAiSdkContentPart(undefined, '[@use-crux/ai] Dropping malformed AI SDK content part.', {
    partType: readString(part, 'type') ?? 'unknown',
    reason,
  })
}

function warnAiSdkContentPart(diagnostics: DiagnosticsPort | undefined, message: string, detail: unknown): void {
  if (diagnostics) diagnostics.warn(message, detail)
  else console.warn(message, detail)
}
