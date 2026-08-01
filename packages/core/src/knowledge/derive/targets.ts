/**
 * Claim endpoint locator resolution over active indexed records.
 *
 * @module
 */

import { indexedNamespacePrefix, listIndexedEntries } from '../../indexed-knowledge/keys'
import type { JsonObject, RecordStore } from '../../storage'
import { decodeKnowledgeRef, encodeKnowledgeRef, isKnowledgeRef, type KnowledgeRef } from '../refs'
import { isKnowledgeLocator, type KnowledgeLocator } from './claims'

/** Configuration for building a namespace locator index. */
export interface ClaimTargetIndexConfig {
  /** Store containing indexed records. */
  readonly records: RecordStore
  /** Indexer id used by indexed record keys. */
  readonly indexerId: string
  /** Namespace whose active records can be targeted. */
  readonly namespace: string
}

/** Result of resolving one claim endpoint. */
export type ClaimTargetResolution =
  | { readonly status: 'resolved'; readonly ref: KnowledgeRef }
  | { readonly status: 'pending' | 'ambiguous' }

/** Locator index used by graph compilation. */
export interface ClaimTargetIndex {
  /** Resolve an emitted ref or locator into one indexed knowledge ref. */
  resolve(endpoint: string | KnowledgeLocator): ClaimTargetResolution
}

/** Build a locator index from active indexed records in a namespace. */
export async function buildClaimTargetIndex(config: ClaimTargetIndexConfig): Promise<ClaimTargetIndex> {
  const entries = await listIndexedEntries(config.records, indexedNamespacePrefix(config.indexerId, config.namespace))
  const refs = new Set<string>()
  const urls = new Map<string, Set<string>>()
  const titles = new Map<string, Set<string>>()
  const anchors = new Map<string, Set<string>>()

  for (const entry of entries) {
    const value = entry.value
    if (!isActiveIndexedRecord(value, config.namespace)) continue
    const ref = recordRef(value)
    const encoded = encodeKnowledgeRef(ref)
    refs.add(encoded)
    refs.add(encodeKnowledgeRef(documentRef(value.sourceId)))
    add(anchors, value.sourceId, documentRef(value.sourceId))
    add(anchors, recordId(value), ref)
    for (const anchor of stringFacts(value.metadata, ['anchor', 'slug', 'id'])) add(anchors, anchor, ref)
    for (const source of sourceFacts(value.source)) {
      if (source.url) add(urls, normalizeUrl(source.url), documentRef(value.sourceId))
      if (source.path) add(urls, source.path, documentRef(value.sourceId))
    }
    for (const title of titleFacts(value)) add(titles, title, titleRef(value))
  }

  const index: ClaimTargetIndex = {
    resolve(endpoint: string | KnowledgeLocator) {
      if (typeof endpoint === 'string') {
        const ref = decodeKnowledgeRef(endpoint)
        if (ref?.kind === 'entity') return { status: 'resolved' as const, ref }
        return ref && refs.has(encodeKnowledgeRef(ref))
          ? { status: 'resolved' as const, ref }
          : { status: 'pending' as const }
      }
      if (!isKnowledgeLocator(endpoint)) return { status: 'pending' }
      if ('url' in endpoint) return resolveSet(urls.get(normalizeUrl(endpoint.url)))
      if ('title' in endpoint) return resolveSet(titles.get(endpoint.title))
      return resolveSet(anchors.get(endpoint.anchor))
    },
  }
  return Object.freeze(index)
}

function resolveSet(values: ReadonlySet<string> | undefined): ClaimTargetResolution {
  if (!values || values.size === 0) return { status: 'pending' }
  if (values.size > 1) return { status: 'ambiguous' }
  const encoded = [...values][0]
  const ref = encoded ? decodeKnowledgeRef(encoded) : null
  return ref ? { status: 'resolved', ref } : { status: 'pending' }
}

type ActiveIndexedRecord = {
  readonly _cruxRecordType: 'chunk' | 'parent'
  readonly namespace: string
  readonly sourceId: string
  readonly active: true
  readonly metadata?: JsonObject
  readonly source?: JsonObject
  readonly chunkId?: string
  readonly parentId?: string
  readonly parent?: JsonObject
}

function isActiveIndexedRecord(value: JsonObject, namespace: string): value is ActiveIndexedRecord {
  return (value._cruxRecordType === 'chunk' || value._cruxRecordType === 'parent') &&
    value.active === true &&
    value.namespace === namespace &&
    typeof value.sourceId === 'string'
}

function recordRef(value: ActiveIndexedRecord): KnowledgeRef {
  if (value._cruxRecordType === 'parent' && typeof value.parentId === 'string') {
    return { kind: 'parent', sourceId: value.sourceId, parentId: value.parentId }
  }
  if (value._cruxRecordType === 'chunk' && typeof value.chunkId === 'string') {
    return { kind: 'chunk', sourceId: value.sourceId, chunkId: value.chunkId }
  }
  return documentRef(value.sourceId)
}

function titleRef(value: ActiveIndexedRecord): KnowledgeRef {
  const parentId = isRecord(value.parent) && typeof value.parent.parentId === 'string'
    ? value.parent.parentId
    : undefined
  return parentId
    ? { kind: 'parent', sourceId: value.sourceId, parentId }
    : documentRef(value.sourceId)
}

function recordId(value: ActiveIndexedRecord): string {
  return value._cruxRecordType === 'parent'
    ? value.parentId ?? value.sourceId
    : value.chunkId ?? value.sourceId
}

function titleFacts(value: ActiveIndexedRecord): readonly string[] {
  return unique([
    ...stringFacts(value.metadata, ['title', 'name']),
    ...(isRecord(value.parent) && typeof value.parent.title === 'string' ? [value.parent.title] : []),
    value.sourceId,
  ])
}

function sourceFacts(value: unknown): ReadonlyArray<{ readonly url?: string; readonly path?: string }> {
  if (!isRecord(value)) return []
  return [{
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
  }]
}

function stringFacts(value: unknown, keys: readonly string[]): readonly string[] {
  if (!isRecord(value)) return []
  return keys.flatMap((key) => {
    const fact = value[key]
    return typeof fact === 'string' && fact.trim() ? [fact] : []
  })
}

function add(map: Map<string, Set<string>>, value: string, ref: KnowledgeRef): void {
  const key = value.trim()
  if (!key) return
  const encoded = encodeKnowledgeRef(ref)
  const existing = map.get(key)
  if (existing) existing.add(encoded)
  else map.set(key, new Set([encoded]))
}

function documentRef(sourceId: string): KnowledgeRef {
  return { kind: 'document', sourceId }
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return value
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
