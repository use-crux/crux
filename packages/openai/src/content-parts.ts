import type OpenAI from 'openai'
import {
  contentText,
  createUnsupportedCapabilityError,
  type ContentPart,
  type DataAsset,
  type MessageContent,
  type ProviderFileAsset,
  type UrlAsset,
} from '@use-crux/core'

type OpenAIContentPart = OpenAI.ChatCompletionContentPart
type OpenAITextPart = OpenAI.ChatCompletionContentPartText

/** Encode canonical Crux message content into OpenAI chat-completion content. */
export function openAIMessageContent(role: 'system' | 'assistant', content: MessageContent): string
export function openAIMessageContent(role: 'user', content: MessageContent): string | OpenAIContentPart[]
export function openAIMessageContent(
  role: 'system' | 'user' | 'assistant',
  content: MessageContent,
): string | OpenAIContentPart[] {
  if (typeof content === 'string') return content
  if (role !== 'user' && content.some((part) => part.type !== 'text')) {
    throw unsupported(`input.media.${role}`, `${role} messages do not accept media content in OpenAI chat completions.`)
  }
  if (role !== 'user') return contentText(content)
  return content.flatMap(encodeOpenAIPart)
}

/** Encode canonical tool-result parts for OpenAI text-only tool messages. */
export function openAIToolResultContent(parts: readonly ContentPart[]): OpenAITextPart[] {
  if (parts.some((part) => part.type !== 'text')) {
    throw unsupported('input.tool_result.media', 'Return text or JSON from the tool for OpenAI chat-completion tool messages.')
  }
  return parts.flatMap((part): OpenAITextPart[] => (part.type === 'text' ? [{ type: 'text', text: part.text }] : []))
}

/** Decode an OpenAI chat content payload into canonical Crux content. */
export function messageContentFromOpenAIContent(content: unknown): MessageContent {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts = content.flatMap((part): ContentPart[] => {
    if (!isRecord(part) || typeof part.type !== 'string') return []
    switch (part.type) {
      case 'text':
        return typeof part.text === 'string' ? [{ type: 'text', text: part.text }] : []
      case 'image_url':
        return isRecord(part.image_url) && typeof part.image_url.url === 'string'
          ? [{ type: 'image', source: part.image_url.url }]
          : []
      case 'input_audio':
        if (!isRecord(part.input_audio) || typeof part.input_audio.data !== 'string') return []
        {
          const mediaType = openAIAudioFormatToMediaType(part.input_audio.format)
          return mediaType ? [{ type: 'file', source: dataAsset(part.input_audio.data, mediaType), mediaType }] : []
        }
      case 'file':
        return isRecord(part.file) ? fileToPart(part.file) : []
      default:
        return []
    }
  })
  if (parts.length === 0) return ''
  return parts.every((part) => part.type === 'text') ? parts.map((part) => part.text).join('') : parts
}

/** Text projection for decoded OpenAI content payloads. */
export function openAIContentText(content: unknown): string {
  return contentText(messageContentFromOpenAIContent(content))
}

function encodeOpenAIPart(part: ContentPart): OpenAIContentPart[] {
  switch (part.type) {
    case 'text':
      return [{ type: 'text', text: part.text }]
    case 'image':
      return [{ type: 'image_url', image_url: { url: imageUrl(part) } }]
    case 'file':
      return [encodeOpenAIFilePart(part)]
  }
}

function imageUrl(part: Extract<ContentPart, { type: 'image' }>): string {
  const source = part.source
  if (typeof source === 'string') return source
  if (source instanceof URL) return source.href
  if (source instanceof Uint8Array) return `data:${part.mediaType ?? 'image/png'};base64,${base64(source)}`
  if (source instanceof ArrayBuffer) return `data:${part.mediaType ?? 'image/png'};base64,${base64(new Uint8Array(source))}`
  if (isDataAsset(source)) return `data:${part.mediaType ?? source.mediaType};base64,${dataSourceBase64(source.data)}`
  if (isUrlAsset(source)) return source.url.href
  throw unsupported('input.image.provider-file', 'Hydrate provider-file image assets to a URL or byte source before calling OpenAI.')
}

function encodeOpenAIFilePart(part: Extract<ContentPart, { type: 'file' }>): OpenAIContentPart {
  const source = part.source
  const mediaType = part.mediaType ?? (isAssetWithMediaType(source) ? source.mediaType : undefined)
  if (mediaType) {
    const audioFormat = openAIAudioFormat(mediaType)
    if (audioFormat) return { type: 'input_audio', input_audio: { data: sourceBase64(source), format: audioFormat } }
  }
  if (isProviderFile(source)) return { type: 'file', file: { file_id: source.fileId } }
  if (typeof source === 'string' || source instanceof URL || isUrlAsset(source)) {
    throw unsupported('input.file.url', 'OpenAI chat-completion file parts require byte data or an OpenAI provider file ID.')
  }
  return {
    type: 'file',
    file: {
      file_data: sourceBase64(source),
      ...(part.filename ? { filename: part.filename } : {}),
    },
  }
}

function sourceBase64(source: Extract<ContentPart, { type: 'file' }>['source']): string {
  if (source instanceof Uint8Array) return base64(source)
  if (source instanceof ArrayBuffer) return base64(new Uint8Array(source))
  if (typeof source === 'string') return source
  if (source instanceof URL) return source.href
  if (isDataAsset(source)) return dataSourceBase64(source.data)
  if (isUrlAsset(source)) return source.url.href
  if (isProviderFile(source)) return source.fileId
  return ''
}

function dataSourceBase64(data: Uint8Array | Blob): string {
  if (data instanceof Uint8Array) return base64(data)
  throw unsupported('input.file.blob', 'Blob sources must be normalized to bytes before OpenAI request encoding.')
}

function dataAsset(data: string, mediaType: string): Extract<ContentPart, { type: 'file' }>['source'] {
  return { type: 'data', data: new Uint8Array(Buffer.from(data, 'base64')), mediaType }
}

function fileToPart(file: Record<string, unknown>): ContentPart[] {
  if (typeof file.file_id === 'string') return [{ type: 'file', source: { type: 'provider-file', provider: 'openai', fileId: file.file_id } }]
  if (typeof file.file_data === 'string') {
    return [
      {
        type: 'file',
        source: dataAsset(file.file_data, 'application/octet-stream'),
        mediaType: 'application/octet-stream',
        ...(typeof file.filename === 'string' ? { filename: file.filename } : {}),
      },
    ]
  }
  return []
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function isProviderFile(source: Extract<ContentPart, { type: 'file' }>['source']): source is ProviderFileAsset {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'type' in source && source.type === 'provider-file'
}

function isAssetWithMediaType(source: Extract<ContentPart, { type: 'file' }>['source']): source is Extract<ContentPart, { type: 'file' }>['source'] & { readonly mediaType: string } {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'mediaType' in source && typeof source.mediaType === 'string'
}

function isDataAsset(source: Extract<ContentPart, { type: 'image' | 'file' }>['source']): source is DataAsset {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'type' in source && source.type === 'data'
}

function isUrlAsset(source: Extract<ContentPart, { type: 'image' | 'file' }>['source']): source is UrlAsset {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'type' in source && source.type === 'url'
}

function isBlob(source: unknown): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob
}

function openAIAudioFormat(mediaType: string): 'wav' | 'mp3' | undefined {
  if (mediaType === 'audio/wav') return 'wav'
  if (mediaType === 'audio/mpeg') return 'mp3'
  return undefined
}

function openAIAudioFormatToMediaType(value: unknown): 'audio/wav' | 'audio/mpeg' | undefined {
  if (value === 'wav') return 'audio/wav'
  if (value === 'mp3') return 'audio/mpeg'
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unsupported(capability: string, remediation: string): never {
  throw createUnsupportedCapabilityError({
    adapter: 'openai',
    model: '<custom>',
    issues: [{ capability, remediation }],
  })
}
