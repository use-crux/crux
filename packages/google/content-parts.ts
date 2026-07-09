import type { Part } from '@google/genai'
import type { ContentPart, MessageContent } from '@use-crux/core'
import { contentText } from '@use-crux/core'
import { degradeContentPart, degradeContentToText } from '@use-crux/core/adapter'
import type { ContentDegradationContext } from '@use-crux/core/adapter'

type GooglePartEncoder<K extends ContentPart['type']> = (
  part: Extract<ContentPart, { type: K }>,
  context: ContentDegradationContext,
) => Part[]

/**
 * Encode canonical Crux message content into Google `Part[]` values.
 *
 * Google uses one generic part shape for text, inline bytes, URI-backed files,
 * function calls, and function responses. This table only emits the content
 * subset and degrades unsupported shapes through the shared placeholder path.
 */
export function googleContentParts(
  role: 'system' | 'user' | 'assistant' | 'tool',
  content: MessageContent,
  options: Pick<ContentDegradationContext, 'unsupportedContent'>,
): Part[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.flatMap((part) =>
    encodeGooglePart(part, {
      provider: 'google',
      role,
      unsupportedContent: options.unsupportedContent,
      reason: 'unsupported Google content part',
    }),
  )
}

/**
 * Project Google content to text while preserving strict-mode checks.
 *
 * System instructions are not represented as regular Google transcript
 * contents in this adapter, but they still need to report or reject media
 * consistently with every other provider.
 */
export function googleContentText(
  role: 'system' | 'user' | 'assistant' | 'tool',
  content: MessageContent,
  options: Pick<ContentDegradationContext, 'unsupportedContent'>,
): string {
  return degradeContentToText(content, {
    provider: 'google',
    role,
    unsupportedContent: options.unsupportedContent,
    reason: 'Google system/tool text projection does not support native media parts',
  })
}

/** Decode Google `Part[]` values into canonical Crux content. */
export function messageContentFromGoogleParts(parts: readonly GoogleInboundPart[]): MessageContent {
  const content = parts.flatMap((part): ContentPart[] => {
    if (typeof part.text === 'string') return [{ type: 'text', text: part.text }]
    if (isGoogleBlob(part.inlineData)) return [inlineDataToPart(part.inlineData)]
    if (isGoogleFileData(part.fileData)) {
      return [
        {
          type: 'file-url',
          url: part.fileData.fileUri,
          mediaType: part.fileData.mimeType,
          ...(typeof part.fileData.displayName === 'string' ? { filename: part.fileData.displayName } : {}),
        },
      ]
    }
    return []
  })
  if (content.length === 0) return ''
  return content.every((part) => part.type === 'text') ? content.map((part) => part.text).join('') : content
}

/** Text projection for decoded Google `Part[]` values. */
export function googlePartsText(parts: readonly GoogleInboundPart[]): string {
  return contentText(messageContentFromGoogleParts(parts))
}

/** Minimal inbound Google part shape used by decoder paths. */
export interface GoogleInboundPart {
  readonly text?: string
  readonly functionCall?: unknown
  readonly functionResponse?: unknown
  readonly inlineData?: unknown
  readonly fileData?: unknown
}

const googlePartTable = {
  text: (part, _context) => [{ text: part.text }],
  'image-data': (part, _context) => [{ inlineData: { data: part.data, mimeType: part.mediaType } }],
  'image-url': (part, context) =>
    part.mediaType
      ? [{ fileData: { fileUri: part.url, mimeType: part.mediaType } }]
      : [degradedTextPart(part, context, 'Google fileData requires a mediaType for URI-backed image parts')],
  'image-file-id': (part, context) => [
    degradedTextPart(part, context, 'Google messages do not support Crux image file ids'),
  ],
  'file-data': (part, _context) => [
    {
      inlineData: {
        data: part.data,
        mimeType: part.mediaType,
        ...(part.filename ? { displayName: part.filename } : {}),
      },
    },
  ],
  'file-url': (part, context) =>
    part.mediaType
      ? [
          {
            fileData: {
              fileUri: part.url,
              mimeType: part.mediaType,
              ...(part.filename ? { displayName: part.filename } : {}),
            },
          },
        ]
      : [degradedTextPart(part, context, 'Google fileData requires a mediaType for URI-backed file parts')],
  'file-id': (part, context) => [
    degradedTextPart(part, context, 'Google messages do not support Crux file ids'),
  ],
  custom: (part, context) => [degradedTextPart(part, context, 'Google messages do not support custom content parts')],
} satisfies { readonly [K in ContentPart['type']]: GooglePartEncoder<K> }

function encodeGooglePart(part: ContentPart, context: ContentDegradationContext): Part[] {
  switch (part.type) {
    case 'text':
      return googlePartTable.text(part, context)
    case 'image-data':
      return googlePartTable['image-data'](part, context)
    case 'image-url':
      return googlePartTable['image-url'](part, context)
    case 'image-file-id':
      return googlePartTable['image-file-id'](part, context)
    case 'file-data':
      return googlePartTable['file-data'](part, context)
    case 'file-url':
      return googlePartTable['file-url'](part, context)
    case 'file-id':
      return googlePartTable['file-id'](part, context)
    case 'custom':
      return googlePartTable.custom(part, context)
  }
}

function degradedTextPart(part: ContentPart, context: ContentDegradationContext, reason: string): Part {
  return {
    text: degradeContentPart(part, { ...context, reason }).text,
  }
}

function inlineDataToPart(inlineData: { readonly data: string; readonly mimeType: string; readonly displayName?: string }): ContentPart {
  if (inlineData.mimeType.startsWith('image/')) {
    return { type: 'image-data', data: inlineData.data, mediaType: inlineData.mimeType }
  }
  return {
    type: 'file-data',
    data: inlineData.data,
    mediaType: inlineData.mimeType,
    ...(typeof inlineData.displayName === 'string' ? { filename: inlineData.displayName } : {}),
  }
}

function isGoogleBlob(value: unknown): value is { readonly data: string; readonly mimeType: string; readonly displayName?: string } {
  return (
    isRecord(value) &&
    typeof value.data === 'string' &&
    typeof value.mimeType === 'string' &&
    (value.displayName === undefined || typeof value.displayName === 'string')
  )
}

function isGoogleFileData(
  value: unknown,
): value is { readonly fileUri: string; readonly mimeType: string; readonly displayName?: string } {
  return (
    isRecord(value) &&
    typeof value.fileUri === 'string' &&
    typeof value.mimeType === 'string' &&
    (value.displayName === undefined || typeof value.displayName === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
