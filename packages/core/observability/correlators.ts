import type { CruxAttributes } from './contract'

const maxMetadataValueLength = 200

/**
 * Correlators group observability records across run boundaries.
 *
 * `sessionId` and `userId` are stamped directly onto every graph record.
 * `metadata` is projected into record attributes with a `meta.` prefix so it
 * remains queryable without changing each record shape.
 */
export interface CruxCorrelators {
  /** Logical session for grouping runs in devtools and local storage. */
  readonly sessionId?: string
  /** End-user or actor identifier associated with the emitted records. */
  readonly userId?: string
  /** Flat string metadata copied into attributes as `meta.<key>`. */
  readonly metadata?: Readonly<Record<string, string>>
}

/**
 * Merge two correlator scopes.
 *
 * Shallow scalar fields from `inner` override `outer`. Metadata is merged by
 * key with the inner scope winning, matching nested tracing-scope behavior.
 */
export function mergeCruxCorrelators(
  outer: CruxCorrelators | undefined,
  inner: CruxCorrelators | undefined,
): CruxCorrelators | undefined {
  const outerMetadata = normalizeMetadata(outer?.metadata)
  const innerMetadata = normalizeMetadata(inner?.metadata)
  const metadata =
    outerMetadata || innerMetadata
      ? {
          ...(outerMetadata ?? {}),
          ...(innerMetadata ?? {}),
        }
      : undefined
  const merged: CruxCorrelators = {
    ...(outer?.sessionId !== undefined ? { sessionId: String(outer.sessionId) } : {}),
    ...(outer?.userId !== undefined ? { userId: String(outer.userId) } : {}),
    ...(inner?.sessionId !== undefined ? { sessionId: String(inner.sessionId) } : {}),
    ...(inner?.userId !== undefined ? { userId: String(inner.userId) } : {}),
    ...(metadata ? { metadata } : {}),
  }
  return hasCorrelators(merged) ? merged : undefined
}

/**
 * Add correlators to a graph record before validation and fan-out.
 *
 * Existing record attributes win over projected `meta.*` attributes. This
 * preserves explicit per-record facts when a caller deliberately supplies the
 * same attribute key.
 */
export function applyCruxCorrelators<TRecord extends { readonly attributes?: CruxAttributes }>(
  record: TRecord,
  correlators: CruxCorrelators | undefined,
): TRecord {
  if (!correlators) return record

  const metadataAttributes = attributesFromMetadata(correlators.metadata)
  const attributes =
    metadataAttributes || record.attributes
      ? {
          ...(metadataAttributes ?? {}),
          ...(record.attributes ?? {}),
        }
      : undefined

  return {
    ...record,
    ...(correlators.sessionId !== undefined ? { sessionId: String(correlators.sessionId) } : {}),
    ...(correlators.userId !== undefined ? { userId: String(correlators.userId) } : {}),
    ...(attributes ? { attributes } : {}),
  }
}

function normalizeMetadata(metadata: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined {
  if (!metadata) return undefined
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    normalized[key] = String(value).slice(0, maxMetadataValueLength)
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function attributesFromMetadata(metadata: Readonly<Record<string, string>> | undefined): CruxAttributes | undefined {
  const normalized = normalizeMetadata(metadata)
  if (!normalized) return undefined
  const attributes: CruxAttributes = {}
  for (const [key, value] of Object.entries(normalized)) {
    attributes[`meta.${key}`] = value
  }
  return attributes
}

function hasCorrelators(correlators: CruxCorrelators): boolean {
  return correlators.sessionId !== undefined || correlators.userId !== undefined || correlators.metadata !== undefined
}
