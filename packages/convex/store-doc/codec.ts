/**
 * Serialization and decoding policy for Convex store documents.
 *
 * The imperative store may decode legacy/raw memory records for compatibility.
 * React transport helpers are intentionally strict: reactive UI reads should
 * fail clearly when a document was not written by `cruxConvexStore()`.
 *
 * @module
 */

import type { JsonObject } from '@crux/core/store'
import type { DecodedStoreDoc, StoreDocCodec, StoreDocCodecOptions, StoreDocRecord } from './types'

/**
 * Create the shared Convex store document codec.
 *
 * The codec writes the current `_cruxDoc` format and decodes enough metadata
 * for stores to apply TTL cleanup, vector scores, and top-level filters.
 */
export function createStoreDocCodec(options: StoreDocCodecOptions = {}): StoreDocCodec {
  const now = options.now ?? Date.now

  return {
    encode(key, value, setOptions) {
      const updatedAt = now()
      const stored =
        setOptions?.ttl !== undefined && setOptions.ttl > 0
          ? { ...value, _expiresAt: updatedAt + setOptions.ttl }
          : value
      const embedding = isNumberArray(value.embedding) ? value.embedding : undefined
      return {
        key,
        content: JSON.stringify(stored),
        metadata: { _cruxDoc: true },
        ...(embedding ? { embedding } : {}),
        updatedAt,
      }
    },

    decode(doc) {
      return decodeCruxStoreDoc(doc, now)
    },

    value(doc) {
      if (doc === undefined) return undefined
      if (doc === null) return null
      const decoded = decodeStrictCruxStoreDoc(doc, now)
      return decoded.expired ? null : decoded.value
    },

    entries(docs, entryOptions) {
      return docs
        .map((doc) => decodeStrictCruxStoreDoc(doc, now))
        .filter((decoded) => !decoded.expired && matchesTopLevelFilter(decoded.value, entryOptions?.filter))
        .map((decoded) => ({ key: decoded.key, value: decoded.value }))
    },

    matchesFilter: matchesTopLevelFilter,
  }
}

function decodeStrictCruxStoreDoc(doc: StoreDocRecord, now: () => number): DecodedStoreDoc {
  const metadata = isRecord(doc.metadata) ? doc.metadata : undefined
  if (metadata?._cruxDoc !== true || typeof doc.content !== 'string') {
    throw new Error('createConvexTransport() expected a CruxStore document written by cruxConvexStore().')
  }
  return decodeCruxStoreDoc(doc, now)
}

function decodeCruxStoreDoc(doc: StoreDocRecord, now: () => number): DecodedStoreDoc {
  const key = requireStringField(doc, 'key')
  const metadata = isRecord(doc.metadata) ? doc.metadata : undefined
  if (metadata?._cruxDoc) {
    const content = requireStringField(doc, 'content')
    const value = parseJsonObject(content)
    const expiresAt = typeof value._expiresAt === 'number' ? value._expiresAt : undefined
    return {
      key,
      value,
      ...(typeof doc._score === 'number' ? { score: doc._score } : {}),
      expired: expiresAt !== undefined && now() >= expiresAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      encoding: 'crux-doc',
    }
  }

  return {
    key,
    value: {
      content: typeof doc.content === 'string' ? doc.content : '',
      metadata: metadata ?? {},
      ...(isNumberArray(doc.embedding) ? { embedding: doc.embedding } : {}),
      createdAt: typeof doc.createdAt === 'number' ? doc.createdAt : undefined,
      updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : undefined,
    },
    ...(typeof doc._score === 'number' ? { score: doc._score } : {}),
    expired: false,
    encoding: 'raw-memory-doc',
  }
}

function matchesTopLevelFilter(value: JsonObject, filter?: Record<string, unknown>): boolean {
  if (!filter) return true
  for (const [key, expected] of Object.entries(filter)) {
    const actual = value[key]
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function parseJsonObject(content: string): JsonObject {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed)) {
    throw new Error('Crux store document content must decode to a JSON object.')
  }
  return parsed
}

function requireStringField(record: StoreDocRecord, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') {
    throw new Error(`Crux store document field "${field}" must be a string.`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}
