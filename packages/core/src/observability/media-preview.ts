import { sha256Hex } from '../content/sha256'

const MAX_DESCRIPTOR_HASH_BYTES = 256 * 1024
const MIME_ESSENCE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i

/** Replace media-bearing preview values with an allowlisted private descriptor. */
export function sanitizeMediaPreview(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const sanitized = value.map((item) => sanitizeMediaPreview(item, seen))
    seen.delete(value)
    return sanitized
  }
  if (!isRecord(value)) return value
  if (seen.has(value)) return '[Circular]'
  if (isMediaPart(value)) return sanitizeMediaPart(value)

  seen.add(value)
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, sanitizeMediaPreview(child, seen)]),
  )
  seen.delete(value)
  return sanitized
}

function sanitizeMediaPart(value: Record<string, unknown>): unknown {
  const mediaType = safeMediaType(value.mediaType)
  return {
    type: value.type,
    source: `[${value.type}${mediaType ? ` ${mediaType}` : ''} ${sourceDescriptor(value.source)}]`,
    ...(mediaType ? { mediaType } : {}),
  }
}

function sourceDescriptor(source: unknown): string {
  if (typeof source === 'string') {
    return source.toLowerCase().startsWith('data:') ? 'data-url' : 'url'
  }
  if (source instanceof URL) return 'url'
  if (source instanceof Uint8Array) return bytesDescriptor(source)
  if (source instanceof ArrayBuffer) return bytesDescriptor(new Uint8Array(source))
  if (isBlob(source)) return `${formatBytes(source.size)} sha256:unavailable`
  if (!isRecord(source)) return 'media'

  switch (source.type) {
    case 'data':
      return source.data instanceof Uint8Array
        ? bytesDescriptor(source.data)
        : isBlob(source.data)
          ? `${formatBytes(source.data.size)} sha256:unavailable`
          : 'data'
    case 'url':
      return 'url'
    case 'provider-file':
      return 'provider-file'
    case 'asset-ref':
      return 'asset-ref'
    default:
      return 'media'
  }
}

function bytesDescriptor(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_DESCRIPTOR_HASH_BYTES) {
    return `${formatBytes(bytes.byteLength)} sha256:omitted`
  }
  return `${formatBytes(bytes.byteLength)} sha256:${sha256Hex(bytes).slice(0, 12)}`
}

function safeMediaType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const essence = value.split(';', 1)[0]?.trim().toLowerCase()
  return essence && MIME_ESSENCE.test(essence) ? essence : undefined
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${formatScaled(bytes / 1024)}KB`
  return `${formatScaled(bytes / (1024 * 1024))}MB`
}

function formatScaled(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function isMediaPart(value: Record<string, unknown>): value is Record<string, unknown> & {
  readonly type: 'image' | 'file'
  readonly source: unknown
} {
  return (value.type === 'image' || value.type === 'file') && 'source' in value
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
