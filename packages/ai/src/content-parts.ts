import type { DiagnosticsPort, MessageContent, ProviderOptions } from '@use-crux/core'
import type { Message } from '@use-crux/core'
import { degradeContentPart, degradeContentToText } from '@use-crux/core/adapter'
import type { ContentPart } from '@use-crux/core'
import { isRecord, readString } from './object-utils'

/** Options that affect AI SDK content-part conversion. */
export interface AiSdkContentPartOptions {
  /** Provider-facing name used in diagnostics and strict-mode errors. */
  readonly provider?: string
  /** Strict mode rejects unsupported parts before the SDK call. */
  readonly unsupportedContent?: 'degrade' | 'error'
  /** Optional diagnostics sink for unsupported part degradation. */
  readonly diagnostics?: DiagnosticsPort
}

/**
 * Convert canonical Crux message content into AI SDK `ModelMessage` content.
 *
 * The AI SDK accepts text/image/file parts but has role-specific limits. This
 * helper is the single adapter-owned place where canonical media becomes SDK
 * parts or deliberate placeholder text.
 */
export function encodeContentForAiSdk(
  role: Message['role'],
  content: MessageContent,
  options: AiSdkContentPartOptions = {},
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content

  if (role === 'system') {
    return degradeContentToText(content, {
      provider: options.provider ?? 'ai-sdk',
      role,
      reason: 'AI SDK system messages are text-only',
      unsupportedContent: options.unsupportedContent,
      diagnostics: options.diagnostics,
    })
  }

  return content.map((part) => encodePartForAiSdk(role, part as ContentPart | Record<string, unknown>, options))
}

/**
 * Decode AI SDK assistant text/image/file parts into canonical Crux content.
 *
 * Text-only arrays collapse back to a string to preserve the pre-multimodal
 * transcript shape. Media-bearing arrays stay structured so assistant-returned
 * files and images survive in `result.messages`.
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
    if (type === 'media') {
      const data = readString(part, 'data')
      const mediaType = readString(part, 'mediaType')
      if (data && mediaType) {
        content.push({ type: 'file-data', data, mediaType, ...providerOptionsFrom(part) })
      } else {
        warnMalformedPart(part, 'AI SDK media parts require data and mediaType.')
      }
      continue
    }
    if (type === 'tool-call' || type === 'tool-approval-request' || type === 'tool-approval-response') {
      continue
    }
    if (type === 'image') {
      const image = part.image
      const mediaType = readString(part, 'mediaType')
      if (image instanceof URL) {
        content.push({
          type: 'image-url',
          url: image.toString(),
          ...(mediaType ? { mediaType } : {}),
          ...providerOptionsFrom(part),
        })
      } else if (typeof image === 'string' && mediaType) {
        content.push({ type: 'image-data', data: image, mediaType, ...providerOptionsFrom(part) })
      } else {
        warnMalformedPart(part, 'AI SDK image parts require image and mediaType.')
      }
      continue
    }
    if (type === 'file') {
      const data = part.data
      const mediaType = readString(part, 'mediaType')
      const filename = readString(part, 'filename')
      if (data instanceof URL) {
        content.push({
          type: 'file-url',
          url: data.toString(),
          ...(mediaType ? { mediaType } : {}),
          ...(filename ? { filename } : {}),
          ...providerOptionsFrom(part),
        })
      } else if (typeof data === 'string' && mediaType) {
        content.push({
          type: 'file-data',
          data,
          mediaType,
          ...(filename ? { filename } : {}),
          ...providerOptionsFrom(part),
        })
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
  role: Message['role'],
  part: ContentPart | Record<string, unknown>,
  options: AiSdkContentPartOptions,
): Record<string, unknown> {
  const providerOptions = isRecord(part.providerOptions) ? (part.providerOptions as ProviderOptions) : undefined
  switch (readString(part, 'type')) {
    case 'text':
      return { type: 'text', text: readString(part, 'text') ?? '', ...(providerOptions ? { providerOptions } : {}) }
    case 'image-data': {
      const contentPart = part as Extract<ContentPart, { type: 'image-data' }>
      return {
        type: 'image',
        image: contentPart.data,
        mediaType: contentPart.mediaType,
        ...(providerOptions ? { providerOptions } : {}),
      }
    }
    case 'image-url': {
      const contentPart = part as Extract<ContentPart, { type: 'image-url' }>
      return {
        type: 'image',
        image: new URL(contentPart.url),
        ...(contentPart.mediaType ? { mediaType: contentPart.mediaType } : {}),
        ...(providerOptions ? { providerOptions } : {}),
      }
    }
    case 'file-data': {
      const contentPart = part as Extract<ContentPart, { type: 'file-data' }>
      return {
        type: 'file',
        data: contentPart.data,
        mediaType: contentPart.mediaType,
        ...(contentPart.filename ? { filename: contentPart.filename } : {}),
        ...(providerOptions ? { providerOptions } : {}),
      }
    }
    case 'file-url': {
      const contentPart = part as Extract<ContentPart, { type: 'file-url' }>
      if (contentPart.mediaType) {
        return {
          type: 'file',
          data: new URL(contentPart.url),
          mediaType: contentPart.mediaType,
          ...(contentPart.filename ? { filename: contentPart.filename } : {}),
          ...(providerOptions ? { providerOptions } : {}),
        }
      }
      return degradedTextPart(role, contentPart, 'AI SDK file URL parts require mediaType', options)
    }
    case 'image-file-id':
    case 'file-id':
    case 'custom': {
      const contentPart = part as ContentPart
      return degradedTextPart(role, contentPart, `AI SDK does not support canonical ${contentPart.type} parts`, options)
    }
    default:
      warnUnknownPart(part, options.diagnostics)
      return part
  }
}

function degradedTextPart(
  role: Message['role'],
  part: ContentPart,
  reason: string,
  options: AiSdkContentPartOptions,
): Record<string, unknown> {
  const degraded = degradeContentPart(part, {
    provider: options.provider ?? 'ai-sdk',
    role,
    reason,
    unsupportedContent: options.unsupportedContent,
    diagnostics: options.diagnostics,
  })
  return { type: 'text', text: degraded.text }
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
    case 'image-data': {
      const data = readString(part, 'data')
      const mediaType = readString(part, 'mediaType')
      return data && mediaType ? { type, data, mediaType, ...providerOptionsFrom(part) } : undefined
    }
    case 'image-url': {
      const url = readString(part, 'url')
      const mediaType = readString(part, 'mediaType')
      return url ? { type, url, ...(mediaType ? { mediaType } : {}), ...providerOptionsFrom(part) } : undefined
    }
    case 'image-file-id': {
      const fileId = fileIdFrom(part.fileId)
      return fileId ? { type, fileId, ...providerOptionsFrom(part) } : undefined
    }
    case 'file-data': {
      const data = readString(part, 'data')
      const mediaType = readString(part, 'mediaType')
      const filename = readString(part, 'filename')
      return data && mediaType
        ? { type, data, mediaType, ...(filename ? { filename } : {}), ...providerOptionsFrom(part) }
        : undefined
    }
    case 'file-url': {
      const url = readString(part, 'url')
      const mediaType = readString(part, 'mediaType')
      const filename = readString(part, 'filename')
      return url
        ? {
            type,
            url,
            ...(mediaType ? { mediaType } : {}),
            ...(filename ? { filename } : {}),
            ...providerOptionsFrom(part),
          }
        : undefined
    }
    case 'file-id': {
      const fileId = fileIdFrom(part.fileId)
      return fileId ? { type, fileId, ...providerOptionsFrom(part) } : undefined
    }
    case 'custom':
      return { type, ...providerOptionsFrom(part) }
    default:
      return undefined
  }
}

function fileIdFrom(value: unknown): string | Record<string, string> | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    return Object.fromEntries(entries)
  }
  return undefined
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
