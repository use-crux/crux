import type { Part } from '@google/genai'
import {
  contentText,
  createUnsupportedCapabilityError,
  type ContentPart,
  type DataAsset,
  type MessageContent,
  type ProviderFileAsset,
  type UrlAsset,
} from '@use-crux/core'

/** Encode canonical Crux message content into Google `Part[]` values. */
export function googleContentParts(_role: 'system' | 'user' | 'assistant' | 'tool', content: MessageContent): Part[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map(googleContentPart)
}

/** Project Google content to text. */
export function googleContentText(_role: 'system' | 'user' | 'assistant' | 'tool', content: MessageContent): string {
  return contentText(content)
}

/** Decode Google `Part[]` values into canonical Crux content. */
export function messageContentFromGoogleParts(parts: readonly GoogleInboundPart[]): MessageContent {
  const content = parts.flatMap((part): ContentPart[] => {
    if (typeof part.text === 'string') return [{ type: 'text', text: part.text }]
    if (isGoogleBlob(part.inlineData)) return [inlineDataToPart(part.inlineData)]
    if (isGoogleFileData(part.fileData)) {
      return [
        {
          type: 'file',
          source: part.fileData.fileUri,
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

function inlineDataToPart(inlineData: {
  readonly data: string
  readonly mimeType: string
  readonly displayName?: string
}): ContentPart {
  const source = {
    type: 'data' as const,
    data: new Uint8Array(Buffer.from(inlineData.data, 'base64')),
    mediaType: inlineData.mimeType,
  }
  if (inlineData.mimeType.startsWith('image/')) return { type: 'image', source, mediaType: inlineData.mimeType }
  return {
    type: 'file',
    source,
    mediaType: inlineData.mimeType,
    ...(typeof inlineData.displayName === 'string' ? { filename: inlineData.displayName } : {}),
  }
}

function googleContentPart(part: ContentPart): Part {
  switch (part.type) {
    case 'text':
      return { text: part.text }
    case 'image':
      return googleMediaPart(part)
    case 'file':
      return googleMediaPart(part)
  }
}

function googleMediaPart(part: Extract<ContentPart, { type: 'image' | 'file' }>): Part {
  const source = part.source
  const mediaType = part.mediaType ?? mediaTypeFromSource(source)
  if (!mediaType) {
    throw unsupported(
      `input.${part.type}.media_type`,
      'Google media parts require a mediaType before request encoding.',
    )
  }
  const displayName = part.type === 'file' ? filename(part) : undefined
  const options = googlePartOptions(part)
  if (typeof source === 'string') return { ...fileDataPart(source, mediaType, displayName), ...options }
  if (source instanceof URL) return { ...fileDataPart(source.href, mediaType, displayName), ...options }
  if (source instanceof Uint8Array) return { ...inlineDataPart(source, mediaType, displayName), ...options }
  if (source instanceof ArrayBuffer)
    return {
      ...inlineDataPart(new Uint8Array(source), mediaType, displayName),
      ...options,
    }
  if (isDataAsset(source))
    return {
      ...inlineDataPart(source.data, mediaType, displayName),
      ...options,
    }
  if (isUrlAsset(source))
    return {
      ...fileDataPart(source.url.href, mediaType, displayName),
      ...options,
    }
  if (isProviderFileAsset(source))
    return {
      ...fileDataPart(source.fileId, mediaType, displayName),
      ...options,
    }
  throw unsupported(
    `input.${part.type}.provider-file`,
    'Hydrate provider-file assets to a URL or byte source before calling Google.',
  )
}

function googlePartOptions(part: Extract<ContentPart, { type: 'image' | 'file' }>): Pick<Part, 'mediaResolution'> {
  const mediaResolution = part.providerOptions?.google?.mediaResolution
  return isRecord(mediaResolution) ? { mediaResolution } : {}
}

function filename(part: Extract<ContentPart, { type: 'file' }>): string | undefined {
  if (part.filename) return part.filename
  const source = part.source
  if (typeof source === 'object' && source !== null && 'filename' in source) {
    return typeof source.filename === 'string' ? source.filename : undefined
  }
  return undefined
}

function inlineDataPart(data: Uint8Array | Blob, mimeType: string, displayName: string | undefined): Part {
  if (!(data instanceof Uint8Array)) {
    throw unsupported('input.file.blob', 'Blob sources must be normalized to bytes before Google request encoding.')
  }
  return {
    inlineData: {
      data: Buffer.from(data).toString('base64'),
      mimeType,
      ...(displayName ? { displayName } : {}),
    },
  }
}

function fileDataPart(fileUri: string, mimeType: string, displayName: string | undefined): Part {
  return {
    fileData: {
      fileUri,
      mimeType,
      ...(displayName ? { displayName } : {}),
    },
  }
}

function mediaTypeFromSource(source: Extract<ContentPart, { type: 'image' | 'file' }>['source']): string | undefined {
  return isDataAsset(source) || isUrlAsset(source) || isProviderFileAsset(source) ? source.mediaType : undefined
}

function isDataAsset(source: Extract<ContentPart, { type: 'image' | 'file' }>['source']): source is DataAsset {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'type' in source && source.type === 'data'
}

function isUrlAsset(source: Extract<ContentPart, { type: 'image' | 'file' }>['source']): source is UrlAsset {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'type' in source && source.type === 'url'
}

function isProviderFileAsset(
  source: Extract<ContentPart, { type: 'image' | 'file' }>['source'],
): source is ProviderFileAsset {
  return (
    typeof source === 'object' &&
    source !== null &&
    !isBlob(source) &&
    'type' in source &&
    source.type === 'provider-file'
  )
}

function isBlob(source: unknown): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob
}

function unsupported(capability: string, remediation: string): never {
  throw createUnsupportedCapabilityError({
    adapter: 'google',
    model: '<custom>',
    issues: [{ capability, remediation }],
  })
}

function isGoogleBlob(value: unknown): value is {
  readonly data: string
  readonly mimeType: string
  readonly displayName?: string
} {
  return (
    isRecord(value) &&
    typeof value.data === 'string' &&
    typeof value.mimeType === 'string' &&
    (value.displayName === undefined || typeof value.displayName === 'string')
  )
}

function isGoogleFileData(value: unknown): value is {
  readonly fileUri: string
  readonly mimeType: string
  readonly displayName?: string
} {
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
