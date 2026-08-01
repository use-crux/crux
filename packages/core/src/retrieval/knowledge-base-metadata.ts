/**
 * Metadata schema checks for knowledge-base ingestion.
 *
 * Validates source-level metadata before a knowledge base sends documents or
 * chunks to the indexer, preserving existing indexing result shapes while
 * producing source-specific diagnostics for schema failures.
 *
 * @module
 */

import type { z } from 'zod'
import type { CruxChunk, CruxDocument, CruxIngestLoadResultLike } from '../indexing'

/** A source-level metadata validation failure. Internal. */
export interface KnowledgeBaseMetadataFailure {
  /** Source id rejected by the metadata schema. */
  readonly sourceId: string
  /** Formatted Zod issues for the rejected source metadata. */
  readonly issues: readonly string[]
}

/** Documents that passed metadata schema validation. Internal. */
export interface KnowledgeBaseDocumentMetadataResult {
  /** Documents safe to pass to the indexer. */
  readonly documents: readonly CruxDocument[]
  /** Source-level validation failures. */
  readonly failures: readonly KnowledgeBaseMetadataFailure[]
}

/** Chunks that passed metadata schema validation. Internal. */
export interface KnowledgeBaseChunkMetadataResult {
  /** Chunks safe to pass to the indexer. */
  readonly chunks: readonly CruxChunk[]
  /** Source-level validation failures. */
  readonly failures: readonly KnowledgeBaseMetadataFailure[]
}

/** Corpus inputs with invalid documents converted to failed load results. Internal. */
export interface KnowledgeBaseCorpusMetadataResult {
  /** Corpus inputs safe to pass to `Corpus.sync()`. */
  readonly inputs: readonly (CruxDocument | CruxIngestLoadResultLike)[]
  /** Source-level validation failures converted into failed load results. */
  readonly failures: readonly KnowledgeBaseMetadataFailure[]
}

/** Aggregate error thrown after valid direct sources have been indexed. Internal. */
export class KnowledgeBaseMetadataValidationError extends AggregateError {
  /** Knowledge base id whose schema rejected one or more sources. */
  readonly knowledgeBaseId: string
  /** Source-level metadata validation failures. */
  readonly failures: readonly KnowledgeBaseMetadataFailure[]

  constructor(knowledgeBaseId: string, failures: readonly KnowledgeBaseMetadataFailure[]) {
    super(
      failures.map((failure) => new Error(formatFailureMessage(knowledgeBaseId, failure))),
      formatAggregateMessage(knowledgeBaseId, failures),
    )
    this.name = 'KnowledgeBaseMetadataValidationError'
    this.knowledgeBaseId = knowledgeBaseId
    this.failures = failures
  }
}

/** Validate document metadata and drop every source with schema failures. Internal. */
export function partitionKnowledgeBaseDocumentsByMetadata(
  knowledgeBaseId: string,
  schema: z.ZodType<unknown> | undefined,
  documents: readonly CruxDocument[],
): KnowledgeBaseDocumentMetadataResult {
  if (!schema) return { documents: [...documents], failures: [] }

  const failures = validateDocuments(schema, documents)
  if (failures.length === 0) return { documents: [...documents], failures }

  const failedSourceIds = new Set(failures.map((failure) => failure.sourceId))
  return {
    documents: documents.filter((document) => !failedSourceIds.has(document.sourceId)),
    failures,
  }
}

/**
 * Validate chunk metadata and drop every source with schema failures. Internal.
 *
 * Chunk inputs are already source-level materialized records. For each source,
 * the first chunk's metadata is treated as the source metadata shape to validate;
 * callers that pre-chunk should carry the merged source metadata on every chunk.
 */
export function partitionKnowledgeBaseChunksByMetadata(
  knowledgeBaseId: string,
  schema: z.ZodType<unknown> | undefined,
  chunks: readonly CruxChunk[],
): KnowledgeBaseChunkMetadataResult {
  if (!schema) return { chunks: [...chunks], failures: [] }

  const firstChunkBySource = new Map<string, CruxChunk>()
  for (const chunk of chunks) {
    if (!firstChunkBySource.has(chunk.sourceId)) firstChunkBySource.set(chunk.sourceId, chunk)
  }

  const failures = validateDocuments(schema, Array.from(firstChunkBySource.values()))
  if (failures.length === 0) return { chunks: [...chunks], failures }

  const failedSourceIds = new Set(failures.map((failure) => failure.sourceId))
  return {
    chunks: chunks.filter((chunk) => !failedSourceIds.has(chunk.sourceId)),
    failures,
  }
}

/** Convert invalid corpus documents into failed load results. Internal. */
export function applyKnowledgeBaseCorpusMetadataSchema(
  knowledgeBaseId: string,
  schema: z.ZodType<unknown> | undefined,
  inputs: readonly (CruxDocument | CruxIngestLoadResultLike)[],
): KnowledgeBaseCorpusMetadataResult {
  if (!schema) return { inputs: [...inputs], failures: [] }

  const documents = inputs.flatMap((input) => {
    const document = isSuccessfulLoadResult(input) ? input.document : isFailedLoadResult(input) ? undefined : input
    return document ? [document] : []
  })
  const failures = validateDocuments(schema, documents)
  if (failures.length === 0) return { inputs: [...inputs], failures }

  const failuresBySource = new Map(failures.map((failure) => [failure.sourceId, failure]))
  const output: Array<CruxDocument | CruxIngestLoadResultLike> = []

  for (const input of inputs) {
    const document = isSuccessfulLoadResult(input) ? input.document : isFailedLoadResult(input) ? undefined : input
    const failure = document ? failuresBySource.get(document.sourceId) : undefined
    if (!document || !failure) {
      output.push(input)
      continue
    }

    output.push({
      ok: false,
      namespace: document.namespace,
      sourceId: document.sourceId,
      error: { message: formatFailureMessage(knowledgeBaseId, failure) },
      ...(document.metadata ? { metadata: document.metadata } : {}),
    })
  }

  return { inputs: output, failures }
}

function validateDocuments(
  schema: z.ZodType<unknown>,
  documents: ReadonlyArray<Pick<CruxDocument, 'sourceId' | 'metadata'>>,
): KnowledgeBaseMetadataFailure[] {
  const failuresBySource = new Map<string, KnowledgeBaseMetadataFailure>()
  for (const document of documents) {
    if (failuresBySource.has(document.sourceId)) continue
    const failure = validateMetadata(schema, document.sourceId, document.metadata)
    if (failure) failuresBySource.set(document.sourceId, failure)
  }
  return Array.from(failuresBySource.values())
}

function validateMetadata(
  schema: z.ZodType<unknown>,
  sourceId: string,
  metadata: Record<string, unknown> | undefined,
): KnowledgeBaseMetadataFailure | undefined {
  const parsed = schema.safeParse(metadata ?? {})
  if (parsed.success) return undefined
  return {
    sourceId,
    issues: parsed.error.issues.map(formatIssue),
  }
}

function formatAggregateMessage(
  knowledgeBaseId: string,
  failures: readonly KnowledgeBaseMetadataFailure[],
): string {
  const sourceIds = failures.map((failure) => `"${failure.sourceId}"`).join(', ')
  const details = failures.map((failure) => formatFailureMessage(knowledgeBaseId, failure)).join('; ')
  return `knowledgeBase("${knowledgeBaseId}") metadata validation failed for source(s) ${sourceIds}: ${details}`
}

function formatFailureMessage(knowledgeBaseId: string, failure: KnowledgeBaseMetadataFailure): string {
  return `knowledgeBase("${knowledgeBaseId}") source "${failure.sourceId}" metadataSchema issues: ${failure.issues.join('; ')}`
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? `metadata.${issue.path.map(String).join('.')}` : 'metadata'
  return `${path}: ${issue.message} (${issue.code})`
}

function isSuccessfulLoadResult(value: unknown): value is Extract<CruxIngestLoadResultLike, { ok: true }> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true && 'document' in value)
}

function isFailedLoadResult(value: unknown): value is Extract<CruxIngestLoadResultLike, { ok: false }> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false && 'error' in value)
}
