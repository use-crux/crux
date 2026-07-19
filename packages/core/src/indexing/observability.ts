/**
 * Observability for indexing and corpus operations.
 *
 * Wraps index operations in spans, emits ingest/indexing/corpus report
 * artifacts with edges, forwards progress to instrumentation hooks, and derives
 * span attributes from stage records.
 *
 * @module
 */

import { observe } from '../observability'
import { getHooks } from '../runtime/runtime'
import { isFailedLoadResult, isSuccessfulLoadResult } from './source'
import type {
  CorpusProgressEvent,
  CorpusSourceResult,
  CorpusSyncOptions,
  CorpusSyncResult,
  CruxDocument,
  CruxIngestLoadResultLike,
  IndexDryRunResult,
  IndexResult,
  SourceStageRecord,
} from './types'

/** Forward a progress event to hooks/callback and strip transport fields. */
export function emitProgress(options: CorpusSyncOptions, event: CorpusProgressEvent): CorpusSourceResult {
  options.onProgress?.(event)
  const { syncId: _syncId, corpusId: _corpusId, namespace: _namespace, dryRun: _dryRun, ...result } = event
  return result
}

/** Emit a span + ingest.report artifact for a single load result. */
export function emitIngestLoadObservation(
  input: CruxDocument | CruxIngestLoadResultLike,
  args: { syncId: string; corpusId: string; namespace: string },
): void {
  if (!isSuccessfulLoadResult(input) && !isFailedLoadResult(input)) return
  const document = isSuccessfulLoadResult(input) ? input.document : undefined
  const sourceId = document?.sourceId ?? (isFailedLoadResult(input) ? input.sourceId : '<unknown>')
  const span = observe.openSpan({
    name: `${args.corpusId}.ingest:${sourceId}`,
    primitive: 'ingest.parse',
    attributes: {
      syncId: args.syncId,
      corpusId: args.corpusId,
      namespace: args.namespace,
      sourceId,
      status: input.ok ? 'success' : 'error',
      warningCount: document?.warnings?.length ?? 0,
      partCount: document?.parts?.length ?? 0,
      ...(isFailedLoadResult(input) && input.error.code ? { errorCode: input.error.code } : {}),
      ...(isFailedLoadResult(input) && input.error.parser ? { parser: input.error.parser } : {}),
    },
  })
  try {
    span.withContext(() => {
      observe.event({
        name: input.ok ? 'ingest.parse.success' : 'ingest.parse.error',
        attributes: {
          syncId: args.syncId,
          corpusId: args.corpusId,
          namespace: args.namespace,
          sourceId,
          warningCount: document?.warnings?.length ?? 0,
          partCount: document?.parts?.length ?? 0,
          ...(isFailedLoadResult(input) ? { error: input.error.message } : {}),
        },
      })
      const status = input.ok ? 'success' : 'failed'
      const artifactId = observe.artifact({
        kind: 'ingest.report',
        contentType: 'application/json',
        encoding: 'json',
        preview: {
          kind: 'ingest.report',
          sourceId,
          status,
          ...(isFailedLoadResult(input) && input.error.parser ? { parser: input.error.parser } : {}),
          warningCount: document?.warnings?.length ?? 0,
          parts: document?.parts?.length ?? 0,
          ...(isFailedLoadResult(input) ? { reason: input.error.message } : {}),
        },
        attributes: {
          primitive: 'ingest.parse',
          syncId: args.syncId,
          corpusId: args.corpusId,
          namespace: args.namespace,
          sourceId,
          status,
        },
      })
      if (artifactId) {
        observe.edge({
          edgeType: 'produced',
          from: { kind: 'span', id: span.spanId },
          to: { kind: 'artifact', id: artifactId },
          attributes: { sourceId, status },
        })
      }
    })
    if (isFailedLoadResult(input)) {
      span.error(new Error(input.error.message))
      return
    }
    span.end({ attributes: { warningCount: document?.warnings?.length ?? 0, partCount: document?.parts?.length ?? 0 } })
  } catch (error) {
    span.error(error)
  }
}

/** Emit an indexing.report artifact for one pipeline stage. */
export function emitIndexingStageArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  record: SourceStageRecord,
): void {
  const artifactId = observe.artifact({
    kind: 'indexing.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'indexing.report',
      operation: 'stage',
      totals: {
        sources: 1,
        chunks: record.chunkCount ?? 0,
        parents: record.parentCount,
      },
      stageCounts: stageCountsFromStages([record]),
      stages: [record],
    },
    attributes: {
      primitive: 'indexing.pipeline',
      stageKind: record.kind,
      stageName: record.name,
      stageVersion: record.version,
      embeddingKind: record.embeddingKind,
      status: record.status,
      ...(record.cache ? { cache: record.cache } : {}),
      ...(record.chunkCount !== undefined ? { chunkCount: record.chunkCount } : {}),
      ...(record.parentCount !== undefined ? { parentCount: record.parentCount } : {}),
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { stageKind: record.kind, stageName: record.name, status: record.status },
    })
  }
}

/** Emit an indexing.report artifact for a completed index operation. */
export function emitIndexingOutputArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  result: {
    indexerId: string
    namespace: string
    operation: string
    sourceCount?: number
    chunkCount?: number
    deletedCount?: number
    dryRun?: boolean
    stages?: SourceStageRecord[]
  },
): void {
  const artifactId = observe.artifact({
    kind: 'indexing.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'indexing.report',
      operation: result.operation,
      indexerId: result.indexerId,
      namespace: result.namespace,
      totals: {
        sources: result.sourceCount ?? 0,
        chunks: result.chunkCount ?? 0,
        deleted: result.deletedCount ?? 0,
      },
      sourceCount: result.sourceCount ?? 0,
      chunkCount: result.chunkCount ?? 0,
      deletedCount: result.deletedCount ?? 0,
      dryRun: result.dryRun === true,
      stageCounts: stageCountsFromStages(result.stages ?? []),
      stages: result.stages?.slice(0, 20),
    },
    attributes: {
      primitive: 'indexing.pipeline',
      indexerId: result.indexerId,
      namespace: result.namespace,
      operation: result.operation,
      ...(result.sourceCount !== undefined ? { sourceCount: result.sourceCount } : {}),
      ...(result.chunkCount !== undefined ? { chunkCount: result.chunkCount } : {}),
      ...(result.deletedCount !== undefined ? { deletedCount: result.deletedCount } : {}),
      ...(result.dryRun !== undefined ? { dryRun: result.dryRun } : {}),
      stageCount: result.stages?.length ?? 0,
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { operation: result.operation, namespace: result.namespace },
    })
  }
}

/** Emit a corpus.report artifact for a completed sync. */
export function emitCorpusSyncArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  result: CorpusSyncResult,
): void {
  const artifactId = observe.artifact({
    kind: 'corpus.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'corpus.report',
      syncId: result.syncId,
      corpusId: result.corpusId,
      namespace: result.namespace,
      mode: result.mode,
      stalePolicy: result.stalePolicy,
      sourceSet: result.sourceSet,
      dryRun: result.dryRun,
      added: result.added,
      changed: result.changed,
      unchanged: result.unchanged,
      stale: result.stale,
      skipped: result.skipped,
      deleted: result.deleted,
      failed: result.failed,
      chunkCount: result.chunkCount,
      totals: {
        added: result.added,
        changed: result.changed,
        unchanged: result.unchanged,
        skipped: result.skipped,
        failed: result.failed,
        stale: result.stale,
        deleted: result.deleted,
        chunks: result.chunkCount,
      },
      stageCounts: stageCountsFromStages(result.sources.flatMap((source) => source.stages ?? [])),
      sources: result.sources.slice(0, 50).map(corpusSourcePreview),
    },
    attributes: {
      primitive: 'corpus.sync',
      syncId: result.syncId,
      corpusId: result.corpusId,
      namespace: result.namespace,
      sourceCount: result.sources.length,
      chunkCount: result.chunkCount,
      failed: result.failed,
      dryRun: result.dryRun,
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { syncId: result.syncId, corpusId: result.corpusId, namespace: result.namespace },
    })
  }
}

/** Count stage records by kind (or name). */
export function stageCountsFromStages(stages: readonly SourceStageRecord[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const stage of stages) {
    const key = stage.kind ?? stage.name
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/** A compact preview of a corpus source result for artifacts. */
export function corpusSourcePreview(source: CorpusSourceResult): Record<string, unknown> {
  return {
    id: source.sourceId,
    action: source.action,
    ...(source.reason ? { reason: source.reason } : {}),
    ...(source.chunkCount !== undefined ? { chunks: source.chunkCount } : {}),
  }
}

/** Span attributes derived from a stage record. */
export function stageRecordAttributes(record: SourceStageRecord): Record<string, unknown> {
  return {
    stageKind: record.kind,
    stageName: record.name,
    stageVersion: record.version,
    embeddingKind: record.embeddingKind,
    status: record.status,
    durationMs: record.durationMs,
    ...(record.cache ? { cache: record.cache } : {}),
    ...(record.chunkCount !== undefined ? { chunkCount: record.chunkCount } : {}),
    ...(record.parentCount !== undefined ? { parentCount: record.parentCount } : {}),
  }
}

let indexOperationCounter = 0

/** Run an index operation inside a span, emitting start/end hooks + artifact. */
export async function runIndexOperation<T extends IndexResult | IndexDryRunResult | number>(args: {
  indexerId: string
  namespace: string
  operation: 'indexDocuments' | 'indexChunks' | 'deleteSource' | 'clear'
  sourceCount: number
  chunkCount: number
  replaceSources?: boolean
  sourceId?: string
  dryRun?: boolean
  instrument?: boolean
  run: () => Promise<T>
}): Promise<T> {
  const startedAt = Date.now()
  const indexId = `${startedAt}-index-${++indexOperationCounter}`
  const eventBase = {
    indexId,
    indexerId: args.indexerId,
    namespace: args.namespace,
    operation: args.operation,
    sourceCount: args.sourceCount,
    chunkCount: args.chunkCount,
    ...(args.replaceSources !== undefined ? { replaceSources: args.replaceSources } : {}),
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
  }

  const span =
    args.instrument === false
      ? undefined
      : observe.openSpan({
          name: `${args.indexerId}.${args.operation}`,
          primitive: 'indexing.pipeline',
          attributes: eventBase,
        })

  try {
    const result = span ? await span.withContext(args.run) : await args.run()
    if (span) {
      span.withContext(() => {
        emitIndexingOutputArtifact(span.spanId, {
          ...eventBase,
          operation: args.operation,
          deletedCount: typeof result === 'number' ? result : undefined,
          stages: typeof result === 'number' ? undefined : result.stages,
        })
      })
      span.end({
        attributes:
          typeof result === 'number'
            ? { deletedCount: result }
            : { sourceCount: result.sourceCount, chunkCount: result.chunkCount },
      })
    }
    return result
  } catch (error) {
    span?.error(error)
    throw error
  }
}
