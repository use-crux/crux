import type { AssetRef } from '../asset'
import type { CruxSourceFacts, CruxSourceLocation } from './types'

/** Return the safe, serializable source fields accepted by indexed records. */
export function projectSourceFacts(source: CruxSourceFacts | undefined): CruxSourceFacts | undefined {
  if (!source) return undefined
  const url = validHttpsUrl(source.url)
  const path = validText(source.path)
  const assetRef = validAssetRef(source.assetRef)
  const mediaType = validMediaType(source.mediaType)
  const location = validSourceLocation(source.location)
  const projected = {
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(assetRef ? { assetRef } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(location ? { location } : {}),
  }
  return Object.keys(projected).length ? projected : undefined
}

/** Merge source coordinates without inventing a location. */
export function mergeSourceLocations(
  locations: readonly CruxSourceLocation[],
): CruxSourceLocation | undefined {
  const valid = locations.map(validSourceLocation)
  if (valid.some((location) => !location)) return undefined
  const normalized = valid as CruxSourceLocation[]
  if (normalized.length === 0) return undefined
  if (normalized.length === 1) return normalized[0]

  const first = normalized[0]
  if (first.type === 'page') {
    return normalized.every((location) => location.type === 'page' && location.pageNumber === first.pageNumber)
      ? first
      : undefined
  }

  let end = first.end
  for (const location of normalized.slice(1)) {
    if (location.type !== 'time' || location.unit !== 'seconds' || location.start !== end) return undefined
    end = location.end
  }
  return { type: 'time', unit: 'seconds', start: first.start, end }
}

/** Add one unambiguous location to already validated document source facts. */
export function sourceFactsWithLocations(
  source: CruxSourceFacts | undefined,
  locations: readonly CruxSourceLocation[],
): CruxSourceFacts | undefined {
  const base = projectSourceFacts(source)
  const location = mergeSourceLocations(locations)
  return projectSourceFacts({ ...(base ?? {}), ...(location ? { location } : {}) })
}

function validHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

function validText(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function validAssetRef(value: AssetRef | undefined): AssetRef | undefined {
  return value && validText(value.uri) ? { uri: value.uri } : undefined
}

function validMediaType(value: string | undefined): string | undefined {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase()
  return normalized && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized) ? normalized : undefined
}

function validSourceLocation(value: CruxSourceLocation | undefined): CruxSourceLocation | undefined {
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
