import { sha256Hex } from '../content/sha256'

const MAX_DESCRIPTOR_HASH_BYTES = 256 * 1024
const MAX_DEPTH = 8
const MAX_KEYS = 100
const MAX_ARRAY_ITEMS = 100
const MAX_STRING_LENGTH = 64 * 1024
const MIME_ESSENCE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i
const BASE64_LIKE = /^[a-z0-9+/=_-]+$/i
const SENSITIVE_MEDIA_KEY = /^(?:file_?id|provider_?file_?id|filename|ref|uri|url)$/i

type MediaKind = 'image' | 'file'
type SourceCategory = 'asset-ref' | 'blob' | 'bytes' | 'data' | 'data-url' | 'provider-file' | 'unknown' | 'url'

type SafeMediaDescriptor = Readonly<{
  kind: MediaKind
  mediaType?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationSeconds?: number
  pageCount?: number
  digestPrefix?: string
  sourceCategory: SourceCategory
}>

interface SanitizeState {
  readonly seen: WeakSet<object>
}

/** Replace media-bearing preview values with bounded allowlisted facts before serialization. */
export function sanitizeMediaPreview(value: unknown): unknown {
  try {
    return sanitizeValue(value, { seen: new WeakSet<object>() }, 0)
  } catch {
    return '[Uninspectable]'
  }
}

function sanitizeValue(value: unknown, state: SanitizeState, depth: number): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'symbol' || typeof value === 'function') return String(value)
  if (value instanceof Uint8Array) return bytesDescriptor('file', value)
  if (value instanceof ArrayBuffer) return bytesDescriptor('file', new Uint8Array(value))
  if (value instanceof URL) return '[url]'
  if (isBlob(value)) return blobDescriptor('file', value)
  if (depth >= MAX_DEPTH) return '[Truncated]'
  if (typeof value !== 'object') return String(value)
  if (state.seen.has(value)) return '[Circular]'

  if (Array.isArray(value)) return sanitizeArray(value, state, depth)
  if (!isRecord(value)) return String(value)
  if (isMediaPart(value)) return mediaDescriptor(value.type, value.source, value)
  if (isAsset(value)) return mediaDescriptor(kindFromMediaType(value.mediaType), value, value)

  state.seen.add(value)
  try {
    return sanitizeRecord(value, state, depth)
  } finally {
    state.seen.delete(value)
  }
}

function sanitizeArray(value: readonly unknown[], state: SanitizeState, depth: number): unknown[] {
  state.seen.add(value)
  try {
    const result = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, state, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) result.push('[Truncated]')
    return result
  } finally {
    state.seen.delete(value)
  }
}

function sanitizeRecord(value: Record<string, unknown>, state: SanitizeState, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const keys = safeKeys(value)
  for (const key of keys.slice(0, MAX_KEYS)) {
    const child = safeProperty(value, key)
    result[key] = SENSITIVE_MEDIA_KEY.test(key)
      ? sanitizeLocator(key, child)
      : sanitizeValue(child, state, depth + 1)
  }
  if (keys.length > MAX_KEYS) result.__truncated = true
  return result
}

function mediaDescriptor(kind: MediaKind, source: unknown, facts: Record<string, unknown>): SafeMediaDescriptor {
  const sourceFacts = isRecord(source) ? source : undefined
  const mediaType = safeMediaType(facts.mediaType) ?? safeMediaType(sourceFacts?.mediaType) ?? blobMediaType(source)
  const bytes = byteView(sourceFacts?.type === 'data' ? sourceFacts.data : source)
  const blob = isBlob(sourceFacts?.type === 'data' ? sourceFacts.data : source)
    ? (sourceFacts?.type === 'data' ? sourceFacts.data : source) as Blob
    : undefined
  const knownSize = safeInteger(facts.size) ?? safeInteger(sourceFacts?.size) ?? bytes?.byteLength ?? blob?.size
  const digest = digestPrefix(facts.sha256) ?? digestPrefix(sourceFacts?.sha256) ?? (bytes ? digestBytes(bytes) : undefined)
  return Object.freeze({
    kind,
    ...(mediaType ? { mediaType } : {}),
    ...(knownSize !== undefined ? { sizeBytes: knownSize } : {}),
    ...optionalFact('width', facts.width ?? sourceFacts?.width),
    ...optionalFact('height', facts.height ?? sourceFacts?.height),
    ...optionalFact('durationSeconds', facts.durationInSeconds ?? sourceFacts?.durationInSeconds),
    ...optionalFact('pageCount', facts.pageCount ?? sourceFacts?.pageCount),
    ...(digest ? { digestPrefix: digest } : {}),
    sourceCategory: sourceCategory(source),
  })
}

function bytesDescriptor(kind: MediaKind, bytes: Uint8Array): SafeMediaDescriptor {
  const digest = digestBytes(bytes)
  return Object.freeze({
    kind,
    sizeBytes: bytes.byteLength,
    ...(digest ? { digestPrefix: digest } : {}),
    sourceCategory: 'bytes',
  })
}

function blobDescriptor(kind: MediaKind, blob: Blob): SafeMediaDescriptor {
  const mediaType = safeMediaType(blob.type)
  return Object.freeze({
    kind,
    ...(mediaType ? { mediaType } : {}),
    sizeBytes: blob.size,
    sourceCategory: 'blob',
  })
}

function sourceCategory(source: unknown): SourceCategory {
  if (typeof source === 'string') return source.trimStart().toLowerCase().startsWith('data:') ? 'data-url' : 'url'
  if (source instanceof URL) return 'url'
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return 'bytes'
  if (isBlob(source)) return 'blob'
  if (!isRecord(source)) return 'unknown'
  if ('ref' in source || source.type === 'asset-ref') return 'asset-ref'
  if (source.type === 'data') return 'data'
  if (source.type === 'url') return 'url'
  if (source.type === 'provider-file') return 'provider-file'
  return 'unknown'
}

function sanitizeString(value: string): string {
  const trimmed = value.trim()
  if (trimmed.toLowerCase().startsWith('data:') || isBase64Like(trimmed)) return '[redacted media]'
  if (isUrlString(trimmed)) return '[url]'
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}[Truncated]` : value
}

function sanitizeLocator(key: string, value: unknown): string {
  if (/^(?:url|uri)$/i.test(key) || value instanceof URL || (typeof value === 'string' && isUrlString(value))) return '[url]'
  return '[redacted media]'
}

function digestBytes(bytes: Uint8Array): string | undefined {
  return bytes.byteLength <= MAX_DESCRIPTOR_HASH_BYTES ? sha256Hex(bytes).slice(0, 12) : undefined
}

function digestPrefix(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{8,}$/i.test(value) ? value.slice(0, 12).toLowerCase() : undefined
}

function optionalFact(key: string, value: unknown): Record<string, number> {
  const fact = safeNumber(value)
  return fact === undefined ? {} : { [key]: fact }
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function safeMediaType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const essence = value.split(';', 1)[0]?.trim().toLowerCase()
  return essence && MIME_ESSENCE.test(essence) ? essence : undefined
}

function blobMediaType(value: unknown): string | undefined {
  if (isBlob(value)) return safeMediaType(value.type)
  if (typeof value !== 'string' || !value.toLowerCase().startsWith('data:')) return undefined
  return safeMediaType(value.slice(5).split(/[;,]/, 1)[0])
}

function byteView(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value
  return value instanceof ArrayBuffer ? new Uint8Array(value) : undefined
}

function kindFromMediaType(value: unknown): MediaKind {
  return safeMediaType(value)?.startsWith('image/') ? 'image' : 'file'
}

function isMediaPart(value: Record<string, unknown>): value is Record<string, unknown> & { type: MediaKind; source: unknown } {
  return (value.type === 'image' || value.type === 'file') && 'source' in value
}

function isAsset(value: Record<string, unknown>): boolean {
  return value.type === 'data' || value.type === 'url' || value.type === 'provider-file' || value.type === 'asset-ref'
}

function isUrlString(value: string): boolean {
  return /^(?:https?|asset|convex|s3|gs):\/\//i.test(value)
}

function isBase64Like(value: string): boolean {
  if (!BASE64_LIKE.test(value) || /^[a-f0-9]+$/i.test(value)) return false
  if (value.length >= 32 && /={1,2}$/.test(value)) return true
  return value.length >= 128 && new Set(value.toLowerCase()).size >= 8 && value.length % 4 === 0
}

function safeKeys(value: object): string[] {
  try {
    return Object.keys(value)
  } catch {
    return []
  }
}

function safeProperty(value: Record<string, unknown>, key: string): unknown {
  return value[key]
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
