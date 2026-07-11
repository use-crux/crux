import type { RetrieverHit, RetrieverSource } from './types'

/** Validate one application-provided hit and remove fields outside the public source contract. */
export function normalizeRetrieverHit(hit: RetrieverHit): RetrieverHit {
  return { ...hit, source: normalizeRetrieverSource(hit.source) }
}

/** Keep only valid, allowlisted source attribution without performing source I/O. */
export function normalizeRetrieverSource(source: RetrieverSource): RetrieverSource {
  if (!source || typeof source.id !== 'string' || !source.id.trim()) {
    throw new Error('Retriever hit source.id must be a non-empty string.')
  }
  const url = validHttpsUrl(source.url)
  const path = validText(source.path)
  const assetRef = source.assetRef && validText(source.assetRef.uri) ? { uri: source.assetRef.uri } : undefined
  const mediaType = validMediaType(source.mediaType)
  const location = validLocation(source.location)
  return {
    id: source.id,
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(assetRef ? { assetRef } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(location ? { location } : {}),
  }
}

function validHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function validText(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function validMediaType(value: string | undefined): string | undefined {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase()
  return normalized && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized) ? normalized : undefined
}

function validLocation(value: RetrieverSource['location']): RetrieverSource['location'] {
  if (!value) return undefined
  if (value.type === 'page') {
    return Number.isInteger(value.pageNumber) && value.pageNumber > 0
      ? { type: 'page', pageNumber: value.pageNumber }
      : undefined
  }
  return value.unit === 'seconds' && Number.isFinite(value.start) && Number.isFinite(value.end) &&
    value.start >= 0 && value.end >= value.start
    ? { type: 'time', unit: 'seconds', start: value.start, end: value.end }
    : undefined
}
