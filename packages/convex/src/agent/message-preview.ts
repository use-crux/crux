import { messageText } from '@use-crux/core'
import type { MessageContent } from '@use-crux/core'
import { isRecord, stringValue } from './lifecycle-utils'

export function trimmedContentProjection(content: unknown): string | undefined {
  if (typeof content !== 'string' && !Array.isArray(content)) return undefined
  const text = (
    Array.isArray(content) && needsSafeMediaProjection(content)
      ? safeContentProjection(content)
      : messageText({ content: content as MessageContent })
  ).trim()
  return text ? text : undefined
}

export function redactedMessagesPreview(value: unknown): unknown {
  if (!Array.isArray(value)) return redactedPreviewValue(value)
  return value.map(redactedPreviewValue)
}

function redactedPreviewValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactedPreviewValue)
  if (!isRecord(value)) return value
  if (isMediaPart(value)) return redactedMediaPart(value)
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    next[key] = redactedPreviewValue(item)
  }
  return next
}

function redactedMediaPart(part: Record<string, unknown>): Record<string, unknown> {
  const type = stringValue(part.type) ?? 'media'
  return {
    type,
    ...(typeof part.mediaType === 'string' && part.mediaType.length > 0
      ? { mediaType: part.mediaType }
      : {}),
    source: safeMediaSourceDescriptor(part.source ?? part.image ?? part.data),
  }
}

function needsSafeMediaProjection(content: readonly unknown[]): boolean {
  return content.some((part) => {
    if (!isRecord(part)) return false
    if (part.type === 'image') return !('source' in part) || hasUrlSource(part.source ?? part.image)
    if (part.type === 'file') return !('source' in part) || hasUrlSource(part.source ?? part.data)
    return false
  })
}

function safeContentProjection(content: readonly unknown[]): string {
  return content.map(safePartProjection).filter(Boolean).join('\n')
}

function safePartProjection(part: unknown): string {
  if (!isRecord(part)) return ''
  if (part.type === 'text') return stringValue(part.text) ?? ''
  if (part.type === 'image') {
    return `[image${mediaTypeText(part.mediaType)} ${safeMediaSourceDescriptor(part.source ?? part.image)}]`
  }
  if (part.type === 'file') {
    return `[file${mediaTypeText(part.mediaType)} ${safeMediaSourceDescriptor(part.source ?? part.data)}]`
  }
  return ''
}

function safeMediaSourceDescriptor(source: unknown): string {
  if (typeof source === 'string') {
    if (/^https?:\/\//i.test(source)) return 'url'
    if (/^data:/i.test(source)) return 'data-url'
    return 'data'
  }
  if (source instanceof URL) return 'url'
  if (source instanceof Uint8Array) return `${source.byteLength}B`
  if (source instanceof ArrayBuffer) return `${source.byteLength}B`
  if (typeof Blob !== 'undefined' && source instanceof Blob) return `${source.size}B`
  if (!isRecord(source)) return 'unknown'
  if (source.type === 'data') return safeMediaSourceDescriptor(source.data)
  if (source.type === 'url') return 'url'
  if (source.type === 'provider-file') return `provider-file:${stringValue(source.provider) ?? 'unknown'}`
  return 'unknown'
}

function hasUrlSource(source: unknown): boolean {
  if (source instanceof URL) return true
  if (typeof source === 'string') return /^https?:\/\//i.test(source)
  if (!isRecord(source)) return false
  return source.type === 'url' || hasUrlSource(source.url)
}

function mediaTypeText(mediaType: unknown): string {
  return typeof mediaType === 'string' && mediaType.length > 0 ? ` ${mediaType}` : ''
}

function isMediaPart(value: Record<string, unknown>): boolean {
  return value.type === 'image' || value.type === 'file'
}
