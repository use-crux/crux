import { messageText } from '@use-crux/core'
import type { MessageContent } from '@use-crux/core'
import { isRecord, stringValue } from './lifecycle-utils'

/** Canonical media source categories for observability (no data-url alias). */
type SafeSourceCategory =
  | 'data'
  | 'url'
  | 'provider-file'
  | 'asset-ref'
  | 'bytes'
  | 'blob'
  | 'unknown'

type MediaKind = 'image' | 'audio' | 'video' | 'file'

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

/**
 * Emit a canonical descriptor-shaped media fact for observability.
 * No raw sources, locators, or provider identifiers.
 */
function redactedMediaPart(part: Record<string, unknown>): Record<string, unknown> {
  const kind = mediaKindOf(part.type)
  const source = part.source ?? part.image ?? part.data
  const out: Record<string, unknown> = {
    kind,
    sourceCategory: sourceCategoryOf(source),
  }
  if (typeof part.mediaType === 'string' && part.mediaType.length > 0) {
    out.mediaType = part.mediaType
  }
  const sizeBytes = sizeBytesOf(source)
  if (sizeBytes !== undefined) out.sizeBytes = sizeBytes
  return out
}

function needsSafeMediaProjection(content: readonly unknown[]): boolean {
  return content.some((part) => {
    if (!isRecord(part)) return false
    if (part.type === 'image') return !('source' in part) || hasUrlSource(part.source ?? part.image)
    if (part.type === 'file') return !('source' in part) || hasUrlSource(part.source ?? part.data)
    if (part.type === 'audio' || part.type === 'video') return true
    return false
  })
}

function safeContentProjection(content: readonly unknown[]): string {
  return content.map(safePartProjection).filter(Boolean).join('\n')
}

function safePartProjection(part: unknown): string {
  if (!isRecord(part)) return ''
  if (part.type === 'text') return stringValue(part.text) ?? ''
  if (part.type === 'image' || part.type === 'audio' || part.type === 'video' || part.type === 'file') {
    const source = part.source ?? part.image ?? part.data
    return `[${part.type}${mediaTypeText(part.mediaType)} ${sourceCategoryOf(source)}]`
  }
  return ''
}

function sourceCategoryOf(source: unknown): SafeSourceCategory {
  if (typeof source === 'string') {
    if (/^https?:\/\//i.test(source)) return 'url'
    if (/^data:/i.test(source)) return 'data'
    return 'data'
  }
  if (source instanceof URL) return 'url'
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return 'bytes'
  if (typeof Blob !== 'undefined' && source instanceof Blob) return 'blob'
  if (!isRecord(source)) return 'unknown'
  if ('ref' in source || source.type === 'asset-ref') return 'asset-ref'
  if (source.type === 'data') return sourceCategoryOf(source.data)
  if (source.type === 'url') return 'url'
  if (source.type === 'provider-file') return 'provider-file'
  return 'unknown'
}

function sizeBytesOf(source: unknown): number | undefined {
  if (source instanceof Uint8Array) return source.byteLength
  if (source instanceof ArrayBuffer) return source.byteLength
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source.size
  if (!isRecord(source)) return undefined
  if (source.type === 'data') return sizeBytesOf(source.data)
  if (typeof source.size === 'number' && Number.isFinite(source.size) && source.size >= 0) {
    return source.size
  }
  return undefined
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

function mediaKindOf(value: unknown): MediaKind {
  if (value === 'image' || value === 'audio' || value === 'video' || value === 'file') {
    return value
  }
  return 'file'
}

function isMediaPart(value: Record<string, unknown>): boolean {
  return (
    value.type === 'image' ||
    value.type === 'audio' ||
    value.type === 'video' ||
    value.type === 'file'
  )
}
