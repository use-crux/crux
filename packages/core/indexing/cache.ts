/**
 * Pipeline stage caching.
 *
 * Resolves cache config/mode and runs a pipeline stage with read-through /
 * write-back caching keyed by source + stage fingerprint, emitting a span and
 * stage record (cache hit/miss/refresh/bypass) for each execution.
 *
 * @module
 */

import { observe } from '../observability'
import type { JsonObject, RecordStore } from '../storage'
import { stableHash } from './hash'
import { emitIndexingStageArtifact, stageRecordAttributes } from './observability'
import type {
  ChunkingResult,
  CruxChunk,
  CruxDocument,
  PipelineCacheConfig,
  PipelineCacheMode,
  SourceStageRecord,
} from './types'

/** Resolve a pipeline cache config from user input + indexer defaults. */
export function normalizePipelineCache(
  cache: PipelineCacheConfig | undefined,
  indexStore: RecordStore,
  indexerId: string,
): { enabled: boolean; records: RecordStore; scope: string } {
  if (!cache) {
    return { enabled: false, records: indexStore, scope: indexerId }
  }
  if (cache === true) {
    return { enabled: true, records: indexStore, scope: indexerId }
  }
  return {
    enabled: true,
    records: cache.records ?? indexStore,
    scope: cache.scope ?? indexerId,
  }
}

/** Resolve the effective cache mode for a run. */
export function resolveCacheMode(
  cache: { enabled: boolean },
  requested?: PipelineCacheMode,
): PipelineCacheMode | 'disabled' {
  if (!cache.enabled) return 'disabled'
  return requested ?? 'readwrite'
}

/** Run a pipeline stage with read-through/write-back caching + instrumentation. */
export async function runCachedStage<T extends JsonObject | CruxDocument | ChunkingResult | CruxChunk[]>(args: {
  cacheConfig: { enabled: boolean; records: RecordStore; scope: string }
  cacheMode: PipelineCacheMode | 'disabled'
  namespace: string
  sourceId: string
  sourceHash: string
  previousHash: string
  stageKind: string
  stageName: string
  stageVersion: string
  stageFingerprint: unknown
  summarize?: (value: T) => Partial<Pick<SourceStageRecord, 'chunkCount' | 'parentCount'>>
  onStage?: (record: SourceStageRecord) => void
  run: () => Promise<T> | T
}): Promise<T> {
  const startedAt = Date.now()
  const span = observe.openSpan({
    name: `${args.stageKind}:${args.stageName}`,
    family: 'indexing',
    primitive: 'indexing.pipeline',
    attributes: {
      namespace: args.namespace,
      sourceId: args.sourceId,
      stageKind: args.stageKind,
      stageName: args.stageName,
      stageVersion: args.stageVersion,
      cacheMode: args.cacheMode,
      inputHash: args.previousHash,
    },
  })
  const baseRecord = (value: T, status: SourceStageRecord['status'], cache?: SourceStageRecord['cache']) => ({
    name: args.stageName,
    kind: args.stageKind as SourceStageRecord['kind'],
    version: args.stageVersion,
    status,
    ...(cache ? { cache } : {}),
    hash: stableHash(args.stageFingerprint),
    inputHash: args.previousHash,
    outputHash: stableHash(value),
    durationMs: Date.now() - startedAt,
    ...(args.summarize ? args.summarize(value) : {}),
    updatedAt: Date.now(),
  })

  if (args.cacheMode === 'disabled' || args.cacheMode === 'bypass') {
    try {
      const value = await span.withContext(args.run)
      const record = baseRecord(value, 'success', args.cacheMode === 'bypass' ? 'bypass' : undefined)
      args.onStage?.(record)
      span.withContext(() => emitIndexingStageArtifact(span.spanId, record))
      span.end({ attributes: stageRecordAttributes(record) })
      return value
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  const key = pipelineCacheKey(args)
  if (args.cacheMode === 'readwrite') {
    const cached = await args.cacheConfig.records.get(key)
    if (cached && cached._cruxRecordType === 'pipeline-cache' && 'value' in cached) {
      const value = cached.value as T
      const record = baseRecord(value, 'success', 'hit')
      args.onStage?.(record)
      span.withContext(() => emitIndexingStageArtifact(span.spanId, record))
      span.end({ attributes: stageRecordAttributes(record) })
      return value
    }
  }

  try {
    const value = await span.withContext(args.run)
    await args.cacheConfig.records.put(key, {
      _cruxRecordType: 'pipeline-cache',
      namespace: args.namespace,
      sourceId: args.sourceId,
      stageKind: args.stageKind,
      stageName: args.stageName,
      stageVersion: args.stageVersion,
      inputHash: args.previousHash,
      outputHash: stableHash(value),
      value: value as JsonObject,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const record = baseRecord(value, 'success', args.cacheMode === 'refresh' ? 'refresh' : 'miss')
    args.onStage?.(record)
    span.withContext(() => emitIndexingStageArtifact(span.spanId, record))
    span.end({ attributes: stageRecordAttributes(record) })
    return value
  } catch (error) {
    span.error(error)
    throw error
  }
}

/** Build the data-store key for a cached pipeline stage. */
export function pipelineCacheKey(args: {
  cacheConfig: { scope: string }
  namespace: string
  sourceId: string
  sourceHash: string
  previousHash: string
  stageKind: string
  stageName: string
  stageVersion: string
  stageFingerprint: unknown
}): string {
  return `indexer:${args.cacheConfig.scope}:namespace:${args.namespace}:pipeline-cache:${stableHash({
    sourceId: args.sourceId,
    sourceHash: args.sourceHash,
    previousHash: args.previousHash,
    stageKind: args.stageKind,
    stageName: args.stageName,
    stageVersion: args.stageVersion,
    stageFingerprint: args.stageFingerprint,
  })}`
}
