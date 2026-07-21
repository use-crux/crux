/**
 * Final embedding-stage orchestration for the indexing pipeline.
 *
 * Partitions chunks by source, rehydrates complete source-bundle cache hits,
 * batches misses, and scatters vectors back to their original chunk indexes.
 * Media is dense-only; sparse stages omit media chunks entirely.
 *
 * @module
 */

import { embeddingIdentity, embeddingSpaceDigest } from '../embedding'
import type { CruxEmbedding, DenseEmbedding, SparseEmbedding } from '../embedding'
import { observe } from '../observability'
import type { RecordStore, SparseVector } from '../storage'
import {
  EMBEDDING_STAGE_CACHE_EPOCH,
  embeddingStageCacheKey,
  embeddingStageInputHash,
} from './embedding-stage-cache'
import {
  denseEmbeddingStageCodec,
  sparseEmbeddingStageCodec,
  type EmbeddingStageCodec,
  type EmbeddingStageEntryContext,
} from './embedding-stage-codec'
import { stableHash } from './hash'
import { assertStageModalities, embedStageChunks, stageModalityCounts } from './embedding-stage-input'
import { emitIndexingStageArtifact, stageRecordAttributes } from './observability'
import type { CruxChunk, PipelineCacheMode, SourceStageRecord } from './types'

interface EmbeddingStageArgs<TEmbedding extends CruxEmbedding> {
  readonly embedding: TEmbedding
  readonly chunks: readonly CruxChunk[]
  readonly namespace: string
  readonly cacheConfig: { records: RecordStore; scope: string }
  readonly cacheMode: PipelineCacheMode | 'disabled'
  /** Whether cache misses may be persisted. Dry-runs disable writes. */
  readonly writeCache?: boolean
}

/** Ordered embedding output plus one stage record per participating source. */
export interface EmbeddingStageResult<TVector> {
  readonly embeddings: TVector[]
  readonly stages: SourceStageRecord[]
}

interface SourceGroup<TVector> {
  readonly sourceId: string
  readonly chunks: CruxChunk[]
  readonly indexes: number[]
  readonly startedAt: number
  readonly span: ReturnType<typeof observe.openSpan>
  inputHash?: string
  vectors?: readonly TVector[]
  cache?: SourceStageRecord['cache']
}

/** Run a dense embedding stage over text and supported media chunks. */
export function runEmbeddingStage(args: EmbeddingStageArgs<DenseEmbedding>): Promise<EmbeddingStageResult<number[]>>
/** Run a sparse embedding stage, leaving media indexes empty. */
export function runEmbeddingStage(
  args: EmbeddingStageArgs<SparseEmbedding>,
): Promise<EmbeddingStageResult<SparseVector | undefined>>
export function runEmbeddingStage(
  args: EmbeddingStageArgs<CruxEmbedding>,
): Promise<EmbeddingStageResult<number[]> | EmbeddingStageResult<SparseVector | undefined>> {
  if (args.embedding.kind === 'dense') {
    assertStageModalities(args.embedding, args.chunks)
    return runStage(args, denseEmbeddingStageCodec(args.embedding.dimensions))
  }
  return runStage(args, sparseEmbeddingStageCodec) as Promise<EmbeddingStageResult<SparseVector | undefined>>
}

async function runStage<TVector>(
  args: EmbeddingStageArgs<CruxEmbedding>,
  codec: EmbeddingStageCodec<TVector>,
): Promise<EmbeddingStageResult<TVector>> {
  if (args.chunks.length === 0) return { embeddings: [], stages: [] }

  const groups = sourceGroups<TVector>(args)
  const completed = new Set<SourceGroup<TVector>>()
  const stages = new Array<SourceStageRecord>(groups.length)
  const embeddings = new Array<TVector | undefined>(args.chunks.length)
  const fingerprint = args.embedding.fingerprint

  try {
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]
      if (args.cacheMode === 'readwrite' && group.inputHash !== undefined && fingerprint !== undefined) {
        const cached = await args.cacheConfig.records.get(cacheKey(args, group, fingerprint))
        const vectors = codec.read(cached, entryContext(args, group))
        if (vectors !== undefined) {
          group.vectors = vectors
          group.cache = 'hit'
          scatter(embeddings, group)
          stages[groupIndex] = finishGroup(args, group)
          completed.add(group)
          continue
        }
        if (cached !== null) emitCorruptEntry(args, group)
      }
      group.cache = cacheOutcome(args.cacheMode, fingerprint, group.inputHash)
    }

    const misses = groups.filter((group) => group.vectors === undefined)
    if (misses.length > 0) {
      const chunks = misses.flatMap((group) => group.chunks)
      const vectors = await embedStageChunks<TVector>(args.embedding, chunks)
      if (!codec.isBundle(vectors, chunks.length)) {
        throw new Error(
          `${args.embedding.kind === 'dense' ? 'Dense' : 'Sparse'} embedding output does not match the expected count and shape.`,
        )
      }

      let offset = 0
      for (const group of misses) {
        group.vectors = vectors.slice(offset, offset + group.chunks.length)
        offset += group.chunks.length
        scatter(embeddings, group)
      }

      if (args.writeCache !== false && fingerprint !== undefined &&
        args.cacheMode !== 'disabled' && args.cacheMode !== 'bypass') {
        for (const group of misses) {
          if (group.inputHash === undefined) continue
          await args.cacheConfig.records.put(
            cacheKey(args, group, fingerprint),
            codec.create(entryContext(args, group), group.vectors ?? []),
          )
        }
      }
    }

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]
      if (completed.has(group)) continue
      stages[groupIndex] = finishGroup(args, group)
      completed.add(group)
    }
    return { embeddings: embeddings as TVector[], stages }
  } catch (error) {
    for (const group of groups) {
      if (!completed.has(group)) group.span.error(error)
    }
    throw error
  }
}

function sourceGroups<TVector>(args: EmbeddingStageArgs<CruxEmbedding>): SourceGroup<TVector>[] {
  const groups = new Map<string, SourceGroup<TVector>>()
  for (let index = 0; index < args.chunks.length; index++) {
    const chunk = args.chunks[index]
    if (args.embedding.kind === 'sparse' && chunk.media) continue
    let group = groups.get(chunk.sourceId)
    if (!group) {
      group = {
        sourceId: chunk.sourceId,
        chunks: [],
        indexes: [],
        startedAt: Date.now(),
        span: openStageSpan(args, chunk.sourceId),
      }
      groups.set(chunk.sourceId, group)
    }
    group.chunks.push(chunk)
    group.indexes.push(index)
  }
  for (const group of groups.values()) {
    group.inputHash = embeddingStageInputHash(group.chunks)
  }
  return [...groups.values()]
}

function openStageSpan(args: EmbeddingStageArgs<CruxEmbedding>, sourceId: string) {
  return observe.openSpan({
    name: `embedding:${args.embedding.name}`,
    primitive: 'indexing.pipeline',
    attributes: {
      namespace: args.namespace,
      sourceId,
      stageKind: 'embedding',
      stageName: args.embedding.name,
      stageVersion: String(EMBEDDING_STAGE_CACHE_EPOCH),
      embeddingKind: args.embedding.kind,
      cacheMode: args.cacheMode,
      role: 'document',
      ...(args.embedding.fingerprint ? { fingerprintHash: stableHash(args.embedding.fingerprint) } : {}),
    },
  })
}

function finishGroup<TVector>(
  args: EmbeddingStageArgs<CruxEmbedding>,
  group: SourceGroup<TVector>,
): SourceStageRecord {
  const modalityCounts = stageModalityCounts(group.chunks)
  const embeddingSpace = args.embedding.kind === 'dense'
    ? embeddingSpaceDigest(embeddingIdentity(args.embedding))
    : undefined
  const record: SourceStageRecord = {
    name: args.embedding.name,
    kind: 'embedding',
    version: String(EMBEDDING_STAGE_CACHE_EPOCH),
    embeddingKind: args.embedding.kind,
    role: 'document',
    modalityCounts,
    ...(embeddingSpace ? { embeddingSpace } : {}),
    status: 'success',
    ...(group.cache ? { cache: group.cache } : {}),
    ...(args.embedding.fingerprint ? { hash: stableHash(args.embedding.fingerprint) } : {}),
    ...(group.inputHash ? { inputHash: group.inputHash } : {}),
    outputHash: stableHash(group.vectors ?? []),
    chunkCount: group.chunks.length,
    durationMs: Date.now() - group.startedAt,
    updatedAt: Date.now(),
  }
  group.span.withContext(() => emitIndexingStageArtifact(group.span.spanId, record))
  group.span.end({ attributes: stageRecordAttributes(record) })
  return record
}

function cacheKey<TVector>(
  args: EmbeddingStageArgs<CruxEmbedding>,
  group: SourceGroup<TVector>,
  fingerprint: string,
): string {
  if (!group.inputHash) throw new Error('Uncacheable embedding groups do not have cache keys.')
  return embeddingStageCacheKey({
    scope: args.cacheConfig.scope,
    namespace: args.namespace,
    sourceId: group.sourceId,
    kind: args.embedding.kind,
    embeddingFingerprint: fingerprint,
    inputHash: group.inputHash,
  })
}

function entryContext<TVector>(
  args: EmbeddingStageArgs<CruxEmbedding>,
  group: SourceGroup<TVector>,
): EmbeddingStageEntryContext {
  if (!group.inputHash) throw new Error('Uncacheable embedding groups do not have cache entries.')
  return {
    namespace: args.namespace,
    sourceId: group.sourceId,
    embeddingFingerprint: args.embedding.fingerprint ?? '',
    inputHash: group.inputHash,
    chunkCount: group.chunks.length,
  }
}

function cacheOutcome(
  mode: PipelineCacheMode | 'disabled',
  fingerprint: string | undefined,
  inputHash: string | undefined,
): SourceStageRecord['cache'] | undefined {
  if (fingerprint === undefined || mode === 'disabled') return undefined
  if (inputHash === undefined) return 'miss'
  if (mode === 'bypass') return 'bypass'
  return mode === 'refresh' ? 'refresh' : 'miss'
}

function scatter<TVector>(output: Array<TVector | undefined>, group: SourceGroup<TVector>): void {
  for (let index = 0; index < group.indexes.length; index++) {
    output[group.indexes[index]] = group.vectors?.[index]
  }
}

function emitCorruptEntry<TVector>(args: EmbeddingStageArgs<CruxEmbedding>, group: SourceGroup<TVector>): void {
  observe.event({
    name: 'embedding-stage-cache.corrupt',
    attributes: {
      namespace: args.namespace,
      sourceId: group.sourceId,
      embeddingKind: args.embedding.kind,
    },
  })
}
