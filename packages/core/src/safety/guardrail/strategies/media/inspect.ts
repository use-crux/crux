import type { MediaPartSubject } from '../../../boundary'
import { parseDataUrl } from '../../../../content/media-data-url'
import { sniffImageMediaType } from '../../../../content/media-sniff'
import type { MediaPolicyFacts } from './types'

const IMAGE_SIGNATURE_BYTES = 12

interface DataUrlSnapshot {
  readonly location: 'source' | 'data' | 'url'
  readonly mediaType?: string
  readonly byteLength?: number
  readonly payloadPrefix?: Uint8Array
}

export async function inspectMediaPart(subject: MediaPartSubject): Promise<MediaPolicyFacts> {
  const dataUrl = createDataUrlSnapshot(subject.part.source)
  const observedMediaType = subject.part.mediaType ?? sourceMediaType(subject.part.source, dataUrl)
  const mediaType = observedMediaType === undefined
    ? await sniffUndeclaredImage(subject, dataUrl)
    : normalizeObservedMediaType(observedMediaType)
  const sizeBytes = sourceSize(subject.part.source, dataUrl)
  return {
    partType: subject.part.type,
    ...(mediaType ? { mediaType } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    source: inspectSource(subject.part.source, dataUrl),
  }
}

function inspectSource(
  source: unknown,
  dataUrl: DataUrlSnapshot | undefined,
): MediaPolicyFacts['source'] {
  if (dataUrl !== undefined) return { kind: 'inline' }
  if (source instanceof Uint8Array || source instanceof ArrayBuffer || source instanceof Blob) {
    return { kind: 'inline' }
  }
  if (typeof source === 'string') return inspectUrl(source)
  if (source instanceof URL) return inspectUrl(source)
  if (typeof source !== 'object' || source === null || !('type' in source)) {
    return { kind: 'unknown' }
  }
  if (source.type === 'data') return { kind: 'inline' }
  if (source.type === 'provider-file') return { kind: 'provider-file' }
  if (source.type === 'url' && 'url' in source) return inspectUrl(source.url)
  return { kind: 'unknown' }
}

function inspectUrl(value: unknown): MediaPolicyFacts['source'] {
  try {
    const url = value instanceof URL ? value : new URL(String(value))
    if (url.protocol === 'data:') return { kind: 'inline' }
    if (url.protocol !== 'https:') return { kind: 'unknown' }
    return {
      kind: 'url',
      hostname: url.hostname.toLowerCase(),
      hasUserInfo: url.username !== '' || url.password !== '',
      hasQuery: url.search !== '',
    }
  } catch {
    return { kind: 'unknown' }
  }
}

function sourceSize(
  source: unknown,
  dataUrl: DataUrlSnapshot | undefined,
): number | undefined {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return source.byteLength
  if (source instanceof Blob) return source.size
  if (dataUrl !== undefined) return dataUrl.byteLength
  if (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    source.type === 'data' &&
    'data' in source
  ) {
    return sourceSize(source.data, undefined)
  }
  if (
    typeof source === 'object' &&
    source !== null &&
    'size' in source &&
    typeof source.size === 'number' &&
    Number.isFinite(source.size) &&
    source.size >= 0
  ) {
    return source.size
  }
  return undefined
}

async function sniffUndeclaredImage(
  subject: MediaPartSubject,
  dataUrl: DataUrlSnapshot | undefined,
): Promise<string | undefined> {
  if (subject.part.type !== 'image') return undefined
  const prefix = await localBytePrefix(subject.part.source, dataUrl)
  return prefix ? sniffImageMediaType(prefix) : undefined
}

async function localBytePrefix(
  source: unknown,
  dataUrl: DataUrlSnapshot | undefined,
): Promise<Uint8Array | undefined> {
  if (source instanceof Uint8Array) return source.subarray(0, IMAGE_SIGNATURE_BYTES)
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source, 0, Math.min(source.byteLength, IMAGE_SIGNATURE_BYTES))
  }
  if (source instanceof Blob) {
    return new Uint8Array(await source.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer())
  }
  if (dataUrl !== undefined) return dataUrl.payloadPrefix
  if (typeof source !== 'object' || source === null || !('type' in source)) {
    return undefined
  }
  if (source.type === 'data' && 'data' in source) {
    return localBytePrefix(source.data, undefined)
  }
  return undefined
}

function sourceMediaType(
  source: MediaPartSubject['part']['source'],
  dataUrl: DataUrlSnapshot | undefined,
): string | undefined {
  if (source instanceof Blob && source.type !== '') return source.type
  if (dataUrl?.location === 'source') return dataUrl.mediaType
  if (typeof source === 'object' && source !== null && 'mediaType' in source && typeof source.mediaType === 'string') {
    return source.mediaType
  }
  if (dataUrl?.location === 'url') return dataUrl.mediaType
  return undefined
}

function createDataUrlSnapshot(source: unknown): DataUrlSnapshot | undefined {
  const located = locateDataUrl(source)
  if (located === undefined) return undefined
  try {
    const parsed = parseDataUrl(located.value, 'media source')
    return {
      location: located.location,
      ...(parsed.mediaType ? { mediaType: parsed.mediaType } : {}),
      byteLength: parsed.data.byteLength,
      payloadPrefix: parsed.data.subarray(0, IMAGE_SIGNATURE_BYTES),
    }
  } catch {
    return { location: located.location }
  }
}

function locateDataUrl(
  source: unknown,
): { readonly location: DataUrlSnapshot['location']; readonly value: string } | undefined {
  const direct = dataUrl(source)
  if (direct !== undefined) return { location: 'source', value: direct }
  if (typeof source !== 'object' || source === null || !('type' in source)) {
    return undefined
  }
  if (source.type === 'data' && 'data' in source) {
    const nested = locateDataUrl(source.data)
    return nested === undefined ? undefined : { ...nested, location: 'data' }
  }
  if (source.type === 'url' && 'url' in source && source.url instanceof URL && source.url.protocol === 'data:') {
    return { location: 'url', value: source.url.href }
  }
  return undefined
}

function dataUrl(value: unknown): string | undefined {
  try {
    const url = value instanceof URL
      ? value
      : typeof value === 'string'
        ? new URL(value)
        : undefined
    return url?.protocol === 'data:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function normalizeObservedMediaType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const essence = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence) ? essence : undefined
}
