import type { ContentPart, MessageContent } from '../types/content'

/** Narrow unknown input to canonical message content. */
export function isMessageContent(value: unknown): value is MessageContent {
  return typeof value === 'string' || (Array.isArray(value) && value.every(isContentPart))
}

/** Narrow unknown input to a canonical content part. */
export function isContentPart(value: unknown): value is ContentPart {
  if (!isRecord(value) || typeof value.type !== 'string') return false

  switch (value.type) {
    case 'text':
      return typeof value.text === 'string'
    case 'image':
      return isMediaSource(value.source) && optionalString(value.mediaType)
    case 'file':
      return isMediaSource(value.source) && optionalString(value.mediaType) && optionalString(value.filename)
    default:
      return false
  }
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isMediaSource(value: unknown): boolean {
  if (typeof value === 'string') return true
  if (value instanceof URL || value instanceof Uint8Array || value instanceof ArrayBuffer) return true
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  return isAsset(value)
}

function isAsset(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'data':
      return (value.data instanceof Uint8Array || (typeof Blob !== 'undefined' && value.data instanceof Blob))
        && typeof value.mediaType === 'string'
    case 'url':
      return value.url instanceof URL && optionalString(value.mediaType)
    case 'provider-file':
      return typeof value.provider === 'string'
        && typeof value.fileId === 'string'
        && optionalString(value.mediaType)
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
