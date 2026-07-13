import type { Asset, DataAsset } from '../asset/types'
import type { AudioSource } from './contracts'
import { assertAudioMediaType, validateAudioBytes } from './audio-validation'

const MAX_DATA_URL_BYTES = 20 * 1024 * 1024

/** Normalize audio without storage access or hidden network I/O. */
export async function normalizeAudioSource(
  source: AudioSource,
  options: Readonly<{ mediaType?: string }> = {},
): Promise<Asset> {
  if (isAsset(source)) {
    if (source.mediaType) assertAudioMediaType(source.mediaType)
    if (source.type !== 'data') return source
    const data = await bytesFromData(source.data)
    return dataAsset(data, source.mediaType, source.filename)
  }
  if (source instanceof URL) return normalizeUrl(source, options.mediaType)
  if (typeof source === 'string') return normalizeUrl(new URL(source), options.mediaType)
  if (source instanceof Uint8Array) return dataAsset(source.slice(), options.mediaType)
  if (source instanceof ArrayBuffer) return dataAsset(new Uint8Array(source.slice(0)), options.mediaType)
  if (isBlob(source)) return dataAsset(new Uint8Array(await source.arrayBuffer()), options.mediaType ?? source.type)
  throw new TypeError('Unsupported audio source')
}

function normalizeUrl(url: URL, mediaType?: string): Asset {
  if (url.protocol === 'data:') return decodeDataUrl(url.href, mediaType)
  if (url.protocol !== 'https:') throw new TypeError('Audio URL must use HTTPS')
  if (url.username || url.password) throw new TypeError('Audio URL must not contain userinfo')
  if (mediaType) assertAudioMediaType(mediaType)
  return { type: 'url', url: new URL(url.href), ...(mediaType ? { mediaType } : {}) }
}

function decodeDataUrl(value: string, declared?: string): DataAsset {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/is.exec(value)
  if (!match) throw new TypeError('Invalid audio data URL')
  const mediaType = declared ?? match[1]!
  const encoded = match[3]!
  const estimated = match[2] ? Math.floor(encoded.length * 3 / 4) : encoded.length
  if (estimated > MAX_DATA_URL_BYTES) throw new TypeError('Audio data URL exceeds 20 MiB')
  const bytes = match[2]
    ? Uint8Array.from(Buffer.from(encoded, 'base64'))
    : Uint8Array.from(Buffer.from(decodeURIComponent(encoded), 'utf8'))
  if (bytes.byteLength > MAX_DATA_URL_BYTES) throw new TypeError('Audio data URL exceeds 20 MiB')
  return dataAsset(bytes, mediaType)
}

function dataAsset(data: Uint8Array, mediaType?: string, filename?: string): DataAsset {
  return { type: 'data', data, mediaType: validateAudioBytes(data, mediaType), ...(filename ? { filename } : {}) }
}

async function bytesFromData(data: Uint8Array | Blob): Promise<Uint8Array> {
  return data instanceof Uint8Array ? data.slice() : new Uint8Array(await data.arrayBuffer())
}

function isAsset(value: AudioSource): value is Asset {
  return typeof value === 'object' && value !== null && 'type' in value &&
    (value.type === 'data' || value.type === 'url' || value.type === 'provider-file')
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}
