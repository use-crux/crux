/**
 * Corpus source helpers: config/document validation, load-result guards,
 * change classification, and source-record utilities.
 *
 * @module
 */

import type { CruxStore, DataStore, JsonObject } from '../store/types'
import type { CorpusConfig, CruxDocument, CruxIngestLoadResultLike, SourceError, SourceRecord } from './types'

/** Validate a corpus config: ids, namespace, and indexer namespace match. */
export function validateCorpusConfig(config: CorpusConfig): void {
  if (!config.id.trim()) {
    throw new Error('Corpus id must be non-empty.')
  }
  if (!config.namespace.trim()) {
    throw new Error('Corpus namespace must be non-empty.')
  }
  if (config.indexer.namespace !== config.namespace) {
    throw new Error(
      `Corpus namespace "${config.namespace}" does not match indexer namespace "${config.indexer.namespace}".`,
    )
  }
}

/** Resolve a corpus data store from config or fail. */
export function getCorpusDataStore(config: CorpusConfig): DataStore {
  const data = config.data ?? (config.store as CruxStore | undefined)
  if (!data) throw new Error('corpus() requires data or store.')
  return data
}

/** Validate that a document belongs to the corpus namespace and has a source id. */
export function validateCorpusDocument(document: CruxDocument, namespace: string): void {
  if (document.namespace !== namespace) {
    throw new Error(`Document namespace "${document.namespace}" does not match corpus namespace "${namespace}".`)
  }
  if (!document.sourceId.trim()) {
    throw new Error('Document sourceId must be non-empty.')
  }
}

/** Whether a load result succeeded with a document. */
export function isSuccessfulLoadResult(value: unknown): value is Extract<CruxIngestLoadResultLike, { ok: true }> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true && 'document' in value)
}

/** Whether a load result failed with an error. */
export function isFailedLoadResult(value: unknown): value is Extract<CruxIngestLoadResultLike, { ok: false }> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false && 'error' in value)
}

/** Classify a source as added/unchanged/changed by comparing hashes. */
export function classifySource(
  existing: SourceRecord | null,
  hashes: { contentHash: string; metadataHash: string; sourceHash: string },
  indexHash: string,
):
  | { action: 'added' }
  | { action: 'unchanged' }
  | { action: 'changed'; reason: 'contentChanged' | 'metadataChanged' | 'indexChanged' } {
  if (!existing || existing.status === 'deleted') {
    return { action: 'added' }
  }
  if (existing.contentHash !== hashes.contentHash) {
    return { action: 'changed', reason: 'contentChanged' }
  }
  if (existing.metadataHash !== hashes.metadataHash) {
    return { action: 'changed', reason: 'metadataChanged' }
  }
  if (existing.indexHash !== indexHash) {
    return { action: 'changed', reason: 'indexChanged' }
  }
  return { action: 'unchanged' }
}

/** Whether a stored value is a {@link SourceRecord}. */
export function isSourceRecord(value: JsonObject | null): value is SourceRecord {
  return value?._tag === 'SourceRecord'
}

/** Coerce an unknown error into a {@link SourceError}. */
export function toSourceError(error: unknown): SourceError {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const record = error as { message: unknown; stack?: unknown }
    return {
      message: String(record.message),
      ...(typeof record.stack === 'string' ? { stack: record.stack } : {}),
    }
  }
  return { message: String(error) }
}
