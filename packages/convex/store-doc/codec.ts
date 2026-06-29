/**
 * Serialization and decoding policy for Convex store documents.
 *
 * Server stores and React transport helpers are intentionally strict: reads
 * fail clearly when a document was not written in the current Crux store
 * document format.
 *
 * @module
 */

import type { JsonObject } from '@use-crux/core/store'
import { STORE_DOC_COMPONENT_SPEC } from './manifest'
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
          ? { ...value, [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: updatedAt + setOptions.ttl }
          : value
      const embedding = isNumberArray(value.embedding) ? value.embedding : undefined
      return {
        key,
        content: JSON.stringify(stored),
        metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
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
      const decoded = decodeCruxStoreDoc(doc, now)
      return decoded.expired ? null : decoded.value
    },

    entries(docs, entryOptions) {
      return docs
        .map((doc) => decodeCruxStoreDoc(doc, now))
        .filter((decoded) => !decoded.expired && matchesTopLevelFilter(decoded.value, entryOptions?.filter))
        .map((decoded) => ({ key: decoded.key, value: decoded.value }))
    },

    matchesFilter: matchesTopLevelFilter,
  }
}

function decodeCruxStoreDoc(doc: StoreDocRecord, now: () => number): DecodedStoreDoc {
  const key = requireStringField(doc, 'key')
  const metadata = isRecord(doc.metadata) ? doc.metadata : undefined
  if (metadata?.[STORE_DOC_COMPONENT_SPEC.fields.marker] !== true || typeof doc.content !== 'string') {
    throw new Error('Convex store expected a document written in the current Crux store format.')
  }
  const content = requireStringField(doc, 'content')
  const value = parseJsonObject(content)
  const expiresAtValue = value[STORE_DOC_COMPONENT_SPEC.fields.expiresAt]
  const expiresAt = typeof expiresAtValue === 'number' ? expiresAtValue : undefined
  return {
    key,
    value,
    ...(typeof doc._score === 'number' ? { score: doc._score } : {}),
    expired: expiresAt !== undefined && now() >= expiresAt,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    encoding: 'crux-doc',
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
