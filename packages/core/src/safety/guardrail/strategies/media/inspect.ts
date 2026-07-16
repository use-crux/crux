import type { MediaPartSubject } from '../../../boundary'
import { parseDataUrl } from '../../../../content/media-data-url'
import { sniffImageMediaType } from '../../../../content/media-sniff'
import type { MediaPolicyFacts } from './types'

const IMAGE_SIGNATURE_BYTES = 12

export async function inspectMediaPart(subject: MediaPartSubject): Promise<MediaPolicyFacts> {
  const observedMediaType = subject.part.mediaType ?? sourceMediaType(subject.part.source)
  const mediaType = observedMediaType === undefined
    ? await sniffUndeclaredImage(subject)
    : normalizeObservedMediaType(observedMediaType)
  const sizeBytes = sourceSize(subject.part.source)
  return {
    partType: subject.part.type,
    ...(mediaType ? { mediaType } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    source: inspectSource(subject.part.source),
  }
}

function inspectSource(source: unknown): MediaPolicyFacts['source'] {
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

function sourceSize(source: unknown): number | undefined {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return source.byteLength
  if (source instanceof Blob) return source.size
  const url = dataUrl(source)
  if (url !== undefined) return dataUrlSize(url)
  if (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    source.type === 'data' &&
    'data' in source
  ) {
    return sourceSize(source.data)
  }
  if (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    source.type === 'url' &&
    'url' in source &&
    source.url instanceof URL &&
    source.url.protocol === 'data:'
  ) {
    return dataUrlSize(source.url.href)
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

function dataUrlSize(value: string): number | undefined {
  try {
    return parseDataUrl(value, 'media source').data.byteLength
  } catch {
    return undefined
  }
}

async function sniffUndeclaredImage(subject: MediaPartSubject): Promise<string | undefined> {
  if (subject.part.type !== 'image') return undefined
  const prefix = await localBytePrefix(subject.part.source)
  return prefix ? sniffImageMediaType(prefix) : undefined
}

async function localBytePrefix(source: unknown): Promise<Uint8Array | undefined> {
  if (source instanceof Uint8Array) return source.subarray(0, IMAGE_SIGNATURE_BYTES)
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source, 0, Math.min(source.byteLength, IMAGE_SIGNATURE_BYTES))
  }
  if (source instanceof Blob) {
    return new Uint8Array(await source.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer())
  }
  const url = dataUrl(source)
  if (url !== undefined) return dataUrlBytes(url)
  if (typeof source !== 'object' || source === null || !('type' in source)) {
    return undefined
  }
  if (source.type === 'data' && 'data' in source) {
    return localBytePrefix(source.data)
  }
  if (source.type === 'url' && 'url' in source && source.url instanceof URL && source.url.protocol === 'data:') {
    return dataUrlBytes(source.url.href)
  }
  return undefined
}

function sourceMediaType(source: MediaPartSubject['part']['source']): string | undefined {
  if (source instanceof Blob && source.type !== '') return source.type
  const url = dataUrl(source)
  if (url !== undefined) return dataUrlMediaType(url)
  if (typeof source === 'object' && source !== null && 'mediaType' in source && typeof source.mediaType === 'string') {
    return source.mediaType
  }
  if (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    source.type === 'url' &&
    'url' in source &&
    source.url instanceof URL &&
    source.url.protocol === 'data:'
  ) {
    return dataUrlMediaType(source.url.href)
  }
  return undefined
}

function dataUrlMediaType(value: string): string | undefined {
  try {
    return parseDataUrl(value, 'media source').mediaType
  } catch {
    return undefined
  }
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

function dataUrlBytes(value: string): Uint8Array | undefined {
  try {
    return parseDataUrl(value, 'media source').data.subarray(0, IMAGE_SIGNATURE_BYTES)
  } catch {
    return undefined
  }
}

function normalizeObservedMediaType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const essence = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence) ? essence : undefined
}
