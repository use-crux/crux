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
    case 'image-data':
      return typeof value.data === 'string' && typeof value.mediaType === 'string'
    case 'image-url':
      return typeof value.url === 'string' && optionalString(value.mediaType)
    case 'image-file-id':
      return typeof value.fileId === 'string' || isStringRecord(value.fileId)
    case 'file-data':
      return typeof value.data === 'string' && typeof value.mediaType === 'string' && optionalString(value.filename)
    case 'file-url':
      return typeof value.url === 'string' && optionalString(value.mediaType) && optionalString(value.filename)
    case 'file-id':
      return typeof value.fileId === 'string' || isStringRecord(value.fileId)
    case 'custom':
      return true
    default:
      return false
  }
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
