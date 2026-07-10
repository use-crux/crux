import type Anthropic from '@anthropic-ai/sdk'
import {
  contentText,
  createUnsupportedCapabilityError,
  type ContentPart,
  type DataAsset,
  type ProviderFileAsset,
  type ToolModelOutput,
  type UrlAsset,
} from '@use-crux/core'

export type AnthropicToolResultContent =
  | string
  | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>

/** Render Crux tool model output into Anthropic `tool_result` content. */
export function anthropicToolResultContent(
  modelOutput: ToolModelOutput | undefined,
  fallback: string,
): AnthropicToolResultContent {
  if (!modelOutput) return fallback

  switch (modelOutput.type) {
    case 'text':
    case 'error-text':
      return modelOutput.value
    case 'json':
    case 'error-json':
      return JSON.stringify(modelOutput.value)
    case 'execution-denied':
      return modelOutput.reason ? `Tool execution denied: ${modelOutput.reason}` : 'Tool execution denied.'
    case 'content':
      return anthropicContentBlocks(modelOutput.value)
  }
}

type AnthropicContentBlockParam = Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam

/** Encode canonical content parts into Anthropic content blocks. */
export function anthropicContentBlocks(parts: readonly ContentPart[]): AnthropicContentBlockParam[] {
  return parts.flatMap(anthropicContentBlock)
}

function anthropicContentBlock(part: ContentPart): AnthropicContentBlockParam[] {
  switch (part.type) {
    case 'text':
      return [{ type: 'text', text: part.text }]
    case 'image':
      return [anthropicImageBlock(part)]
    case 'file':
      return [anthropicDocumentBlock(part)]
  }
}

function anthropicImageBlock(part: Extract<ContentPart, { type: 'image' }>): Anthropic.ImageBlockParam {
  const source = part.source
  const mediaType = part.mediaType ?? mediaTypeFromSource(source)
  if (typeof source === 'string') return { type: 'image', source: { type: 'url', url: source } }
  if (source instanceof URL) return { type: 'image', source: { type: 'url', url: source.href } }
  if (source instanceof Uint8Array) return base64ImageBlock(source, mediaType)
  if (source instanceof ArrayBuffer) return base64ImageBlock(new Uint8Array(source), mediaType)
  if (isDataAsset(source)) return base64ImageBlock(source.data, mediaType)
  if (isUrlAsset(source)) return { type: 'image', source: { type: 'url', url: source.url.href } }
  throw unsupported('input.image.provider-file', 'Hydrate provider-file image assets to a URL or byte source before calling Anthropic.')
}

function anthropicDocumentBlock(part: Extract<ContentPart, { type: 'file' }>): Anthropic.DocumentBlockParam {
  const source = part.source
  const mediaType = part.mediaType ?? mediaTypeFromSource(source)
  if (mediaType !== 'application/pdf') {
    throw unsupported('input.file', 'Anthropic rich tool results support PDF files; return text for other file types.')
  }
  const title = part.filename ? { title: part.filename } : {}
  if (typeof source === 'string') return { type: 'document', source: { type: 'url', url: source }, ...title }
  if (source instanceof URL) return { type: 'document', source: { type: 'url', url: source.href }, ...title }
  if (source instanceof Uint8Array) return { type: 'document', source: base64PdfSource(source), ...title }
  if (source instanceof ArrayBuffer) return { type: 'document', source: base64PdfSource(new Uint8Array(source)), ...title }
  if (isDataAsset(source)) return { type: 'document', source: base64PdfSource(source.data), ...title }
  if (isUrlAsset(source)) return { type: 'document', source: { type: 'url', url: source.url.href }, ...title }
  throw unsupported('input.file.provider-file', 'Hydrate provider-file assets to a URL or byte source before calling Anthropic.')
}

function base64ImageBlock(data: Uint8Array | Blob, mediaType: string | undefined): Anthropic.ImageBlockParam {
  if (!isAnthropicImageMediaType(mediaType)) {
    throw unsupported('input.image.media_type', 'Image parts require an image mediaType before Anthropic request encoding.')
  }
  return { type: 'image', source: base64Source(data, mediaType) }
}

type AnthropicImageMediaType = Extract<Anthropic.ImageBlockParam['source'], { type: 'base64' }>['media_type']
type AnthropicImageBase64Source = Extract<Anthropic.ImageBlockParam['source'], { type: 'base64' }>
type AnthropicPdfBase64Source = Extract<Anthropic.DocumentBlockParam['source'], { type: 'base64' }>

function base64Source(data: Uint8Array | Blob, mediaType: AnthropicImageMediaType): AnthropicImageBase64Source {
  if (!(data instanceof Uint8Array)) {
    throw unsupported('input.file.blob', 'Blob sources must be normalized to bytes before Anthropic request encoding.')
  }
  return { type: 'base64', data: Buffer.from(data).toString('base64'), media_type: mediaType }
}

function base64PdfSource(data: Uint8Array | Blob): AnthropicPdfBase64Source {
  if (!(data instanceof Uint8Array)) {
    throw unsupported('input.file.blob', 'Blob sources must be normalized to bytes before Anthropic request encoding.')
  }
  return { type: 'base64', data: Buffer.from(data).toString('base64'), media_type: 'application/pdf' }
}

function isAnthropicImageMediaType(mediaType: string | undefined): mediaType is AnthropicImageMediaType {
  return mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/gif' || mediaType === 'image/webp'
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

function isProviderFileAsset(source: Extract<ContentPart, { type: 'image' | 'file' }>['source']): source is ProviderFileAsset {
  return typeof source === 'object' && source !== null && !isBlob(source) && 'type' in source && source.type === 'provider-file'
}

function isBlob(source: unknown): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob
}

function unsupported(capability: string, remediation: string): never {
  throw createUnsupportedCapabilityError({
    adapter: 'anthropic',
    model: '<custom>',
    issues: [{ capability, remediation }],
  })
}
