/**
 * Final embedding-stage orchestration for the indexing pipeline.
 *
 * Partitions chunks by source, rehydrates valid source-bundle cache hits,
 * batches all misses once per embedding kind, validates complete output, and
 * emits privacy-safe source stage records.
 *
 * @module
 */

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
import { emitIndexingStageArtifact, stageRecordAttributes } from './observability'
import type { CruxChunk, PipelineCacheMode, SourceStageRecord } from './types'

interface EmbeddingStageArgs<TEmbedding extends CruxEmbedding> {
  readonly embedding: TEmbedding
  readonly chunks: readonly CruxChunk[]
  readonly namespace: string
  readonly cacheConfig: { records: RecordStore; scope: string }
  readonly cacheMode: PipelineCacheMode | 'disabled'
}

/** Ordered embedding output plus one stage record per source. */
export interface EmbeddingStageResult<TVector> {
  readonly embeddings: TVector[]
  readonly stages: SourceStageRecord[]
}

interface SourceGroup<TVector> {
  readonly sourceId: string
  readonly chunks: CruxChunk[]
  readonly indexes: number[]
  inputHash: string
  readonly startedAt: number
  readonly span: ReturnType<typeof observe.openSpan>
  vectors?: readonly TVector[]
  cache?: SourceStageRecord['cache']
}

/** Run a dense embedding stage. */
export function runEmbeddingStage(args: EmbeddingStageArgs<DenseEmbedding>): Promise<EmbeddingStageResult<number[]>>
/** Run a sparse embedding stage. */
export function runEmbeddingStage(args: EmbeddingStageArgs<SparseEmbedding>): Promise<EmbeddingStageResult<SparseVector>>
export function runEmbeddingStage(
  args: EmbeddingStageArgs<CruxEmbedding>,
): Promise<EmbeddingStageResult<number[]> | EmbeddingStageResult<SparseVector>> {
  return args.embedding.kind === 'dense'
    ? runStage(args, denseEmbeddingStageCodec(args.embedding.dimensions))
    : runStage(args, sparseEmbeddingStageCodec)
}

async function runStage<TVector>(
  args: EmbeddingStageArgs<CruxEmbedding>,
  codec: EmbeddingStageCodec<TVector>,
): Promise<EmbeddingStageResult<TVector>> {
  if (args.chunks.length === 0) {
    return { embeddings: [], stages: [] }
  }

  const groups = sourceGroups<TVector>(args)
  const completed = new Set<SourceGroup<TVector>>()
  const stages = new Array<SourceStageRecord>(groups.length)
  const embeddings = new Array<TVector>(args.chunks.length)
  const fingerprint = args.embedding.fingerprint
  const cacheable = fingerprint !== undefined && args.cacheMode !== 'disabled' && args.cacheMode !== 'bypass'

  try {
    if (cacheable && args.cacheMode === 'readwrite') {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex]
        const cached = await args.cacheConfig.records.get(cacheKey(args, group, fingerprint))
        const vectors = codec.read(cached, entryContext(args, group))
        if (vectors === undefined) {
          if (cached !== null) emitCorruptEntry(args, group)
          group.cache = 'miss'
          continue
        }
        group.vectors = vectors
        group.cache = 'hit'
        scatter(embeddings, group)
        stages[groupIndex] = finishGroup(args, group)
        completed.add(group)
      }
    } else {
      for (const group of groups) {
        group.cache = cacheOutcome(args.cacheMode, fingerprint)
      }
    }

    const misses = groups.filter((group) => group.vectors === undefined)
    if (misses.length > 0) {
      const contents = misses.flatMap((group) => group.chunks.map((chunk) => chunk.content))
      const vectors = await embedMany<TVector>(args.embedding, contents)
      if (!codec.isBundle(vectors, contents.length)) {
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

      if (cacheable) {
        const entries = misses.map((group) => ({
          key: cacheKey(args, group, fingerprint),
          value: codec.create(entryContext(args, group), group.vectors ?? []),
        }))
        for (const entry of entries) {
          await args.cacheConfig.records.put(entry.key, entry.value)
        }
      }
    }

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]
      if (completed.has(group)) continue
      stages[groupIndex] = finishGroup(args, group)
      completed.add(group)
    }
    return { embeddings, stages }
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
    let group = groups.get(chunk.sourceId)
    if (!group) {
      const startedAt = Date.now()
      group = {
        sourceId: chunk.sourceId,
        chunks: [],
        indexes: [],
        inputHash: '',
        startedAt,
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
      ...(args.embedding.fingerprint ? { fingerprintHash: stableHash(args.embedding.fingerprint) } : {}),
    },
  })
}

function finishGroup<TVector>(
  args: EmbeddingStageArgs<CruxEmbedding>,
  group: SourceGroup<TVector>,
): SourceStageRecord {
  const record: SourceStageRecord = {
    name: args.embedding.name,
    kind: 'embedding',
    version: String(EMBEDDING_STAGE_CACHE_EPOCH),
    embeddingKind: args.embedding.kind,
    status: 'success',
    ...(group.cache ? { cache: group.cache } : {}),
    ...(args.embedding.fingerprint ? { hash: stableHash(args.embedding.fingerprint) } : {}),
    inputHash: group.inputHash,
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
): SourceStageRecord['cache'] | undefined {
  if (fingerprint === undefined || mode === 'disabled') return undefined
  if (mode === 'bypass') return 'bypass'
  return mode === 'refresh' ? 'refresh' : 'miss'
}

function scatter<TVector>(output: TVector[], group: SourceGroup<TVector>): void {
  for (let index = 0; index < group.indexes.length; index++) {
    output[group.indexes[index]] = group.vectors?.[index] as TVector
  }
}

async function embedMany<TVector>(embedding: CruxEmbedding, contents: string[]): Promise<TVector[]> {
  return embedding.embedMany(contents) as Promise<TVector[]>
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
