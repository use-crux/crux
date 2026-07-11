import type OpenAI from 'openai'
import {
  createUnsupportedCapabilityError,
  type ContentPart,
  type DataAsset,
  type MediaSource,
  type ProviderFileAsset,
  type UrlAsset,
} from '@use-crux/core'

type OpenAIContentPart = OpenAI.ChatCompletionContentPart

/** Lower one normalized Crux content part to native OpenAI chat content. */
export function encodeOpenAIContentPart(part: ContentPart): OpenAIContentPart[] {
  switch (part.type) {
    case 'text':
      return [{ type: 'text', text: part.text }]
    case 'image':
      return [
        {
          type: 'image_url',
          image_url: {
            url: imageUrl(part),
            ...openAIImageOptions(part),
          },
        },
      ]
    case 'audio':
      return [encodeOpenAIAudioPart(part)]
    case 'video':
      throw unsupported('input.video', 'OpenAI chat completions do not accept video content.')
    case 'file':
      return [encodeOpenAIFilePart(part)]
  }
}

function encodeOpenAIAudioPart(part: Extract<ContentPart, { type: 'audio' }>): OpenAIContentPart {
  const source = part.source
  const mediaType = part.mediaType ?? (isAssetWithMediaType(source) ? source.mediaType : undefined)
  const audioFormat = mediaType ? openAIAudioFormat(mediaType) : undefined
  if (!audioFormat) {
    throw unsupported('input.audio.format', 'OpenAI audio input requires a wav or mp3 mediaType.')
  }
  return { type: 'input_audio', input_audio: { data: sourceBase64(source), format: audioFormat } }
}

function imageUrl(part: Extract<ContentPart, { type: 'image' }>): string {
  const source = part.source
  if (typeof source === 'string') return source
  if (source instanceof URL) return source.href
  if (source instanceof Uint8Array) return `data:${part.mediaType ?? 'image/png'};base64,${base64(source)}`
  if (source instanceof ArrayBuffer)
    return `data:${part.mediaType ?? 'image/png'};base64,${base64(new Uint8Array(source))}`
  if (isDataAsset(source)) return `data:${part.mediaType ?? source.mediaType};base64,${dataSourceBase64(source.data)}`
  if (isUrlAsset(source)) return source.url.href
  throw unsupported(
    'input.image.provider-file',
    'Hydrate provider-file image assets to a URL or byte source before calling OpenAI.',
  )
}

function encodeOpenAIFilePart(part: Extract<ContentPart, { type: 'file' }>): OpenAIContentPart {
  const source = part.source
  if (isProviderFile(source)) {
    if (source.provider !== 'openai') {
      throw unsupported('input.file.provider-file', 'Use an OpenAI provider-file asset with the OpenAI adapter.')
    }
    return { type: 'file', file: { file_id: source.fileId } }
  }
  const mediaType = part.mediaType ?? (isAssetWithMediaType(source) ? source.mediaType : undefined)
  if (mediaType) {
    const audioFormat = openAIAudioFormat(mediaType)
    if (audioFormat) {
      return {
        type: 'input_audio',
        input_audio: { data: sourceBase64(source), format: audioFormat },
      }
    }
  }
  if (typeof source === 'string' || source instanceof URL || isUrlAsset(source)) {
    throw unsupported(
      'input.file.url',
      'OpenAI chat-completion file parts require byte data or an OpenAI provider file ID.',
    )
  }
  if (!mediaType) {
    throw unsupported('input.file.media-type', 'Provide a mediaType for OpenAI file byte data.')
  }
  const partFilename = filename(part)
  return {
    type: 'file',
    file: {
      file_data: `data:${mediaType};base64,${sourceBase64(source)}`,
      ...(partFilename ? { filename: partFilename } : {}),
    },
  }
}

function filename(part: Extract<ContentPart, { type: 'file' }>): string | undefined {
  if (part.filename) return part.filename
  const source = part.source
  if (typeof source === 'object' && source !== null && 'filename' in source) {
    return typeof source.filename === 'string' ? source.filename : undefined
  }
  return undefined
}

function openAIImageOptions(
  part: Extract<ContentPart, { type: 'image' }>,
): Pick<OpenAI.ChatCompletionContentPartImage.ImageURL, 'detail'> {
  const detail = part.providerOptions?.openai?.detail
  return detail === 'auto' || detail === 'low' || detail === 'high' ? { detail } : {}
}

function sourceBase64(source: MediaSource): string {
  if (source instanceof Uint8Array) return base64(source)
  if (source instanceof ArrayBuffer) return base64(new Uint8Array(source))
  if (isDataAsset(source)) return dataSourceBase64(source.data)
  throw unsupported('input.file.data', 'Provide file audio as bytes or a data asset.')
}

function dataSourceBase64(data: Uint8Array | Blob): string {
  if (data instanceof Uint8Array) return base64(data)
  throw unsupported('input.file.blob', 'Blob sources must be normalized to bytes before OpenAI request encoding.')
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function isProviderFile(source: Extract<ContentPart, { type: 'file' }>['source']): source is ProviderFileAsset {
  return isAsset(source, 'provider-file')
}

function isAssetWithMediaType(source: MediaSource): source is MediaSource & {
  readonly mediaType: string
} {
  return (
    typeof source === 'object' &&
    source !== null &&
    !isBlob(source) &&
    'mediaType' in source &&
    typeof source.mediaType === 'string'
  )
}

function isDataAsset(source: MediaSource): source is DataAsset {
  return isAsset(source, 'data')
}

function isUrlAsset(source: MediaSource): source is UrlAsset {
  return isAsset(source, 'url')
}

function isAsset<T extends 'data' | 'url' | 'provider-file'>(
  source: unknown,
  type: T,
): source is Extract<DataAsset | UrlAsset | ProviderFileAsset, { type: T }> {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'type' in source && source.type === type
}

function isBlob(source: unknown): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob
}

function openAIAudioFormat(mediaType: string): 'wav' | 'mp3' | undefined {
  if (mediaType === 'audio/wav') return 'wav'
  if (mediaType === 'audio/mpeg') return 'mp3'
  return undefined
}

function unsupported(capability: string, remediation: string): never {
  throw createUnsupportedCapabilityError({
    adapter: 'openai',
    model: '<custom>',
    issues: [{ capability, remediation }],
  })
}
