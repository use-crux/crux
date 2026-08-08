/**
 * Validation and normalization for indexer inputs.
 *
 * Validates that documents/chunks/parents belong to the indexer namespace and
 * carry required ids, normalizes them to a canonical record shape, and projects
 * the subset of fields stored as vector metadata.
 *
 * @module
 */

import type { CruxChunk, CruxDocument, CruxParentChunk } from './types'
import { projectSourceFacts } from './source-facts'

/** Validate every document belongs to the namespace and has a source id. */
export function validateDocuments(documents: CruxDocument[], namespace: string): void {
  for (const document of documents) {
    if (document.namespace !== namespace) {
      throw new Error(`Document namespace "${document.namespace}" does not match indexer namespace "${namespace}".`)
    }
    if (!document.sourceId.trim()) {
      throw new Error('Document sourceId must be non-empty.')
    }
    if (document.content === undefined && !document.parts?.length && document.asset === undefined) {
      throw new Error('Document must provide content, parts, or asset.')
    }
    if (document.source && !projectSourceFacts(document.source)) {
      throw new Error('Document source facts must contain at least one valid allowlisted field.')
    }
  }
}

/** Validate every chunk belongs to the namespace and has source/chunk ids. */
export function validateChunks(chunks: CruxChunk[], namespace: string): void {
  for (const chunk of chunks) {
    if (chunk.namespace !== namespace) {
      throw new Error(`Chunk namespace "${chunk.namespace}" does not match indexer namespace "${namespace}".`)
    }
    if (!chunk.sourceId.trim()) {
      throw new Error('Chunk sourceId must be non-empty.')
    }
    if (!chunk.chunkId.trim()) {
      throw new Error('Chunk chunkId must be non-empty.')
    }
  }
}

/** Normalize a chunk to a canonical record, dropping undefined optionals. */
export function normalizeChunk(chunk: CruxChunk, namespace: string): CruxChunk {
  if (chunk.namespace !== namespace) {
    throw new Error(`Chunk namespace "${chunk.namespace}" does not match indexer namespace "${namespace}".`)
  }

  const source = projectSourceFacts(chunk.source)
  return {
    namespace,
    sourceId: chunk.sourceId,
    chunkId: chunk.chunkId,
    ...(chunk.generationId ? { generationId: chunk.generationId } : {}),
    ...(chunk.active !== undefined ? { active: chunk.active } : {}),
    ordinal: chunk.ordinal,
    content: chunk.content,
    ...(chunk.media ? { media: chunk.media } : {}),
    metadata: chunk.metadata ?? {},
    ...(source ? { source } : {}),
    ...(chunk.parent ? { parent: chunk.parent } : {}),
    ...(chunk.provenance ? { provenance: chunk.provenance } : {}),
    ...(chunk.evidence ? { evidence: chunk.evidence } : {}),
  }
}

/** Normalize a parent chunk to a canonical record. */
export function normalizeParentChunk(parent: CruxParentChunk, namespace: string): CruxParentChunk {
  if (parent.namespace !== namespace) {
    throw new Error(`Parent chunk namespace "${parent.namespace}" does not match indexer namespace "${namespace}".`)
  }
  if (!parent.sourceId.trim()) {
    throw new Error('Parent chunk sourceId must be non-empty.')
  }
  if (!parent.parentId.trim()) {
    throw new Error('Parent chunk parentId must be non-empty.')
  }
  const source = projectSourceFacts(parent.source)
  return {
    namespace,
    sourceId: parent.sourceId,
    parentId: parent.parentId,
    ...(parent.generationId ? { generationId: parent.generationId } : {}),
    ...(parent.active !== undefined ? { active: parent.active } : {}),
    ordinal: parent.ordinal,
    content: parent.content,
    metadata: parent.metadata ?? {},
    ...(source ? { source } : {}),
    ...(parent.provenance ? { provenance: parent.provenance } : {}),
  }
}

/** Whether a value is a non-array object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
