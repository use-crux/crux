import {
  CRUX_OBSERVABILITY_REDACTION_SURFACES,
  type CruxGraphRecord,
  type CruxObservabilityRedactionSurface,
} from './contract'

const redactionMarker: unique symbol = Symbol('crux.redactionEvidence')

type ArtifactMarkerSurface = Extract<
  CruxObservabilityRedactionSurface,
  'artifact.preview' | 'artifact.uri' | 'attributes'
>

const ARTIFACT_MARKER_SURFACES = [
  'artifact.preview',
  'artifact.uri',
  'attributes',
] as const satisfies readonly ArtifactMarkerSurface[]

interface MarkerEvidence {
  readonly surfaces: readonly ArtifactMarkerSurface[]
  readonly values: Readonly<Partial<Record<ArtifactMarkerSurface, unknown>>>
}

const markerRegistry = new WeakMap<object, MarkerEvidence>()

/** Internal marker resolved before `observe.artifact()` field-picks options. */
export interface ResolvedArtifactRedactionMarker {
  readonly token: object
}

/**
 * Deduplicate affected surfaces into the public constant's canonical order.
 */
export function canonicalizeObservabilityRedactionSurfaces(
  surfaces: Iterable<CruxObservabilityRedactionSurface>,
): readonly CruxObservabilityRedactionSurface[] {
  const included = new Set(surfaces)
  return CRUX_OBSERVABILITY_REDACTION_SURFACES.filter((surface) =>
    included.has(surface),
  )
}

/** Attach an opaque evidence token to redacted public artifact options. */
export function markArtifactRedactionEvidence<T extends object>(
  artifact: T,
  surfaces: readonly CruxObservabilityRedactionSurface[],
): T {
  const artifactSurfaces = canonicalizeObservabilityRedactionSurfaces(
    surfaces,
  ).filter(isArtifactMarkerSurface)
  if (artifactSurfaces.length === 0) return artifact

  const token = {}
  const values: Partial<Record<ArtifactMarkerSurface, unknown>> = {}
  for (const surface of artifactSurfaces) {
    values[surface] = artifactValueForSurface(artifact, surface)
  }
  markerRegistry.set(token, { surfaces: artifactSurfaces, values })
  return Object.assign({}, artifact, { [redactionMarker]: token })
}

/** Resolve a truthful artifact marker before options are field-picked. */
export function resolveArtifactRedactionMarker(
  artifact: object,
): ResolvedArtifactRedactionMarker | undefined {
  const token = (
    artifact as { readonly [redactionMarker]?: unknown }
  )[redactionMarker]
  if (typeof token !== 'object' || token === null) return undefined
  const evidence = markerRegistry.get(token)
  if (!evidence) return undefined
  const unchanged = evidence.surfaces.every(
    (surface) =>
      Object.is(
        artifactValueForSurface(artifact, surface),
        evidence.values[surface],
      ),
  )
  return unchanged ? { token } : undefined
}

/** Copy a previously resolved opaque marker to a newly created graph record. */
export function attachResolvedArtifactRedactionMarker<T extends object>(
  record: T,
  marker: ResolvedArtifactRedactionMarker | undefined,
): T {
  return marker
    ? Object.assign({}, record, { [redactionMarker]: marker.token })
    : record
}

/**
 * Remove private/public evidence metadata before capture modes and the custom
 * redaction hook, returning marker-owned surfaces separately.
 */
export function consumeObservabilityRedactionMarker(
  record: CruxGraphRecord,
): {
  readonly record: CruxGraphRecord
  readonly surfaces: readonly CruxObservabilityRedactionSurface[]
} {
  const token = (
    record as CruxGraphRecord & { readonly [redactionMarker]?: unknown }
  )[redactionMarker]
  const evidence =
    typeof token === 'object' && token !== null
      ? markerRegistry.get(token)
      : undefined
  return {
    record: stripObservabilityRedactionMetadata(record),
    surfaces: evidence?.surfaces ?? [],
  }
}

/** Remove runtime-owned metadata by copy-on-write, including from frozen input. */
export function stripObservabilityRedactionMetadata(
  record: CruxGraphRecord,
): CruxGraphRecord {
  const withMetadata = record as CruxGraphRecord & {
    readonly [redactionMarker]?: unknown
  }
  if (
    withMetadata[redactionMarker] === undefined &&
    withMetadata.privacy === undefined
  ) {
    return record
  }
  const {
    [redactionMarker]: _marker,
    privacy: _privacy,
    ...clean
  } = withMetadata
  return clean as CruxGraphRecord
}

/** Attach canonical public evidence, or omit privacy when no surface changed. */
export function attachObservabilityRedactionEvidence(
  record: unknown,
  surfaces: Iterable<CruxObservabilityRedactionSurface>,
): unknown {
  if (typeof record !== 'object' || record === null) return record
  const canonical = canonicalizeObservabilityRedactionSurfaces(surfaces)
  const { privacy: _privacy, ...clean } = record as Record<string, unknown>
  if (canonical.length === 0) return clean
  return {
    ...clean,
    privacy: {
      redaction: {
        applied: true,
        surfaces: canonical,
      },
    },
  }
}

function isArtifactMarkerSurface(
  surface: CruxObservabilityRedactionSurface,
): surface is ArtifactMarkerSurface {
  return (ARTIFACT_MARKER_SURFACES as readonly string[]).includes(surface)
}

function artifactValueForSurface(
  artifact: object,
  surface: ArtifactMarkerSurface,
): unknown {
  const fields = artifact as {
    readonly preview?: unknown
    readonly uri?: unknown
    readonly attributes?: unknown
  }
  switch (surface) {
    case 'artifact.preview':
      return fields.preview
    case 'artifact.uri':
      return fields.uri
    case 'attributes':
      return fields.attributes
  }
}
