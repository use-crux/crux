/**
 * The {@link corpus} factory.
 *
 * Builds a {@link Corpus} that tracks source records and syncs documents through
 * an {@link Indexer}: it hashes sources to detect changes, indexes added/changed
 * sources, records failures, and optionally prunes stale sources when given the
 * complete source set.
 *
 * @module
 */

import { collect } from './collections'
import { computeSourceHashes } from './source-hash'
import { listAll, sourceKey, sourcePrefixKey } from './keys'
import { emitCorpusSyncArtifact, emitIngestLoadObservation, emitProgress } from './observability'
import {
  classifySource,
  getCorpusRecordStore,
  isFailedLoadResult,
  isSourceRecord,
  isSuccessfulLoadResult,
  toSourceError,
  validateCorpusConfig,
  validateCorpusDocument,
} from './source'
import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import type {
  Corpus,
  CorpusConfig,
  CorpusSourceResult,
  CorpusSyncOptions,
  CorpusSyncResult,
  CruxDocument,
  CruxIngestLoadResultLike,
  SourceClearResult,
  SourceDeleteResult,
  SourceListOptions,
  SourceRecord,
} from './types'

/**
 * Create a {@link Corpus} backed by a data store and an {@link Indexer}.
 *
 * @example
 * ```ts
 * const docs = corpus({ id: 'docs', namespace: 'docs', store, indexer: index })
 * await docs.sync(documents, { sourceSet: 'complete', stale: 'delete' })
 * ```
 */
export function corpus(config: CorpusConfig): Corpus {
  validateCorpusConfig(config)
  const recordStore = getCorpusRecordStore(config)

  async function sync(
    documentsInput:
      | AsyncIterable<CruxDocument | CruxIngestLoadResultLike>
      | Array<CruxDocument | CruxIngestLoadResultLike>,
    options: CorpusSyncOptions = {},
  ): Promise<CorpusSyncResult> {
    const mode = options.mode ?? 'replaceChanged'
    const stale = options.stale ?? 'keep'
    const sourceSet = options.sourceSet ?? 'partial'
    const dryRun = options.dryRun === true

    if (stale === 'delete' && sourceSet !== 'complete') {
      throw new Error("corpus.sync({ stale: 'delete' }) requires sourceSet: 'complete'.")
    }

    const startedAt = Date.now()
    const syncId = `${startedAt}-corpus-${config.id}`
    const inputs = await collect(documentsInput)
    const span = observe.openSpan({
      name: `${config.id}.sync`,
      primitive: 'corpus.sync',
      attributes: {
        syncId,
        corpusId: config.id,
        namespace: config.namespace,
        mode,
        stalePolicy: stale,
        sourceSet,
        dryRun,
        sourceCount: inputs.length,
      },
    })
    try {
      return await span.withContext(async () => {
        const seenSourceIds = new Set<string>()
        const sourceResults: CorpusSourceResult[] = []
        let added = 0
        let changed = 0
        let unchanged = 0
        let staleCount = 0
        let skipped = 0
        let deleted = 0
        let failed = 0
        let chunkCount = 0

        for (const input of inputs) {
          emitIngestLoadObservation(input, { syncId, corpusId: config.id, namespace: config.namespace })
          if (isFailedLoadResult(input)) {
            seenSourceIds.add(input.sourceId)
            failed++
            const sourceError = toSourceError(input.error)
            if (!dryRun && input.sourceId) {
              const existing = await getSource(input.sourceId)
              const now = Date.now()
              await recordStore.put(sourceKey(config.id, config.namespace, input.sourceId), {
                _tag: 'SourceRecord',
                corpusId: config.id,
                namespace: config.namespace,
                sourceId: input.sourceId,
                contentHash: existing?.contentHash ?? '',
                metadataHash: existing?.metadataHash ?? '',
                sourceHash: existing?.sourceHash ?? '',
                indexHash: existing?.indexHash ?? '',
                status: 'failed',
                chunkCount: existing?.chunkCount ?? 0,
                ...(input.metadata
                  ? { metadata: input.metadata }
                  : existing?.metadata
                    ? { metadata: existing.metadata }
                    : {}),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                firstSeenAt: existing?.firstSeenAt ?? now,
                lastSeenAt: now,
                failedAt: now,
                lastSyncRunId: syncId,
                lastError: sourceError,
                errors: [...(existing?.errors ?? []), sourceError],
              } as unknown as import('../storage').JsonObject)
            }

            sourceResults.push(
              emitProgress(options, {
                syncId,
                corpusId: config.id,
                namespace: config.namespace,
                dryRun,
                sourceId: input.sourceId || '<unknown>',
                action: 'failed',
                reason: 'error',
                error: sourceError,
                chunkCount: 0,
              }),
            )
            continue
          }

          const document = isSuccessfulLoadResult(input) ? input.document : input
          try {
            validateCorpusDocument(document, config.namespace)
            seenSourceIds.add(document.sourceId)

            const hashes = computeSourceHashes(document, config.hash)
            const indexHash = config.indexer.fingerprint({
              chunking: options.chunking,
              indexVersion: options.indexVersion ?? config.indexVersion,
            })
            const existing = await getSource(document.sourceId)
            const classification = classifySource(existing, hashes, indexHash)

            if (classification.action === 'unchanged') {
              unchanged++
              const result = emitProgress(options, {
                syncId,
                corpusId: config.id,
                namespace: config.namespace,
                dryRun,
                sourceId: document.sourceId,
                action: 'unchanged',
                previousHash: existing?.sourceHash,
                nextHash: hashes.sourceHash,
                previousIndexHash: existing?.indexHash,
                nextIndexHash: indexHash,
              })
              sourceResults.push(result)
              continue
            }

            if (classification.action === 'changed') {
              if (mode === 'appendOnly') {
                changed++
                skipped++
                const result = emitProgress(options, {
                  syncId,
                  corpusId: config.id,
                  namespace: config.namespace,
                  dryRun,
                  sourceId: document.sourceId,
                  action: 'skipped',
                  reason: 'appendOnly',
                  previousHash: existing?.sourceHash,
                  nextHash: hashes.sourceHash,
                  previousIndexHash: existing?.indexHash,
                  nextIndexHash: indexHash,
                })
                sourceResults.push(result)
                continue
              }
            }

            const indexResult = dryRun
              ? await config.indexer.indexDocuments([document], {
                  replaceSources: true,
                  chunking: options.chunking,
                  cache: options.cache,
                  dryRun: true,
                })
              : await config.indexer.indexDocuments([document], {
                  replaceSources: true,
                  chunking: options.chunking,
                  cache: options.cache,
                })
            chunkCount += indexResult.chunkCount

            const action = classification.action === 'changed' ? 'changed' : 'added'
            const reason = classification.action === 'changed' ? classification.reason : 'new'
            if (action === 'changed') {
              changed++
            } else {
              added++
            }
            if (!dryRun) {
              const now = Date.now()
              await recordStore.put(sourceKey(config.id, config.namespace, document.sourceId), {
                _tag: 'SourceRecord',
                corpusId: config.id,
                namespace: config.namespace,
                sourceId: document.sourceId,
                contentHash: hashes.contentHash,
                metadataHash: hashes.metadataHash,
                sourceHash: hashes.sourceHash,
                indexHash,
                status: 'indexed',
                chunkCount: indexResult.chunkCount,
                ...(document.title ? { title: document.title } : {}),
                ...(document.metadata ? { metadata: document.metadata } : {}),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                firstSeenAt: existing?.firstSeenAt ?? now,
                lastSeenAt: now,
                indexedAt: now,
                lastSyncRunId: syncId,
                errors: existing?.errors ?? [],
                ...(indexResult.stages ? { stages: indexResult.stages } : {}),
              } as unknown as import('../storage').JsonObject)
            }

            const result = emitProgress(options, {
              syncId,
              corpusId: config.id,
              namespace: config.namespace,
              dryRun,
              sourceId: document.sourceId,
              action,
              reason,
              previousHash: existing?.sourceHash,
              nextHash: hashes.sourceHash,
              previousIndexHash: existing?.indexHash,
              nextIndexHash: indexHash,
              chunkCount: indexResult.chunkCount,
              ...(indexResult.stages ? { stages: indexResult.stages } : {}),
            })
            sourceResults.push(result)
          } catch (error) {
            failed++
            const sourceError = toSourceError(error)
            const sourceId = document.sourceId || '<unknown>'
            if (!dryRun && document.sourceId) {
              const existing = await getSource(document.sourceId)
              const now = Date.now()
              await recordStore.put(sourceKey(config.id, config.namespace, document.sourceId), {
                _tag: 'SourceRecord',
                corpusId: config.id,
                namespace: config.namespace,
                sourceId: document.sourceId,
                contentHash: existing?.contentHash ?? '',
                metadataHash: existing?.metadataHash ?? '',
                sourceHash: existing?.sourceHash ?? '',
                indexHash: existing?.indexHash ?? '',
                status: 'failed',
                chunkCount: existing?.chunkCount ?? 0,
                ...(document.title ? { title: document.title } : existing?.title ? { title: existing.title } : {}),
                ...(document.metadata
                  ? { metadata: document.metadata }
                  : existing?.metadata
                    ? { metadata: existing.metadata }
                    : {}),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                firstSeenAt: existing?.firstSeenAt ?? now,
                lastSeenAt: now,
                failedAt: now,
                lastSyncRunId: syncId,
                lastError: sourceError,
                errors: [...(existing?.errors ?? []), sourceError],
              } as unknown as import('../storage').JsonObject)
            }

            const result = emitProgress(options, {
              syncId,
              corpusId: config.id,
              namespace: config.namespace,
              dryRun,
              sourceId,
              action: 'failed',
              reason: 'error',
              error: sourceError,
              chunkCount: 0,
            })
            sourceResults.push(result)
          }
        }

        if (sourceSet === 'complete') {
          const activeSources = await listSources({ includeDeleted: false })
          for (const source of activeSources) {
            if (seenSourceIds.has(source.sourceId)) {
              continue
            }
            const staleResult: CorpusSourceResult = {
              sourceId: source.sourceId,
              action: stale === 'delete' ? 'deleted' : 'stale',
              reason: 'stale',
              previousHash: source.sourceHash,
              previousIndexHash: source.indexHash,
              chunkCount: source.chunkCount,
            }
            staleCount++
            sourceResults.push(
              emitProgress(options, {
                syncId,
                corpusId: config.id,
                namespace: config.namespace,
                dryRun,
                ...staleResult,
              }),
            )

            if (stale === 'delete') {
              deleted++
              if (!dryRun) {
                await deleteSource(source.sourceId)
              }
            }
          }
        }

        const result = {
          syncId,
          corpusId: config.id,
          namespace: config.namespace,
          mode,
          stalePolicy: stale,
          sourceSet,
          dryRun,
          added,
          changed,
          unchanged,
          stale: staleCount,
          skipped,
          deleted,
          failed,
          chunkCount,
          durationMs: Date.now() - startedAt,
          sources: sourceResults,
        }

        emitCorpusSyncArtifact(span.spanId, result)
        span.end({
          attributes: {
            added: result.added,
            changed: result.changed,
            unchanged: result.unchanged,
            stale: result.stale,
            skipped: result.skipped,
            deleted: result.deleted,
            failed: result.failed,
            chunkCount: result.chunkCount,
            sourceCount: result.sources.length,
            dryRun: result.dryRun,
          },
        })

        return result
      })
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  async function getSource(sourceId: string): Promise<SourceRecord | null> {
    const value = await recordStore.get(sourceKey(config.id, config.namespace, sourceId))
    return isSourceRecord(value) ? value : null
  }

  async function listSources(options: SourceListOptions = {}): Promise<SourceRecord[]> {
    const entries = await listAll(recordStore, sourcePrefixKey(config.id, config.namespace))
    const statuses = options.status
      ? new Set(Array.isArray(options.status) ? options.status : [options.status])
      : undefined
    let sources = entries.flatMap((entry) => (isSourceRecord(entry.value) ? [entry.value] : []))
      .filter((source) => (options.includeDeleted ? true : source.status !== 'deleted'))
      .filter((source) => (statuses ? statuses.has(source.status) : true))

    if (options.limit !== undefined) {
      sources = sources.slice(0, options.limit)
    }
    return sources
  }

  async function deleteSource(sourceId: string): Promise<SourceDeleteResult> {
    const existing = await getSource(sourceId)
    const deletedCount = await config.indexer.deleteSource(sourceId)
    const now = Date.now()
    await recordStore.put(sourceKey(config.id, config.namespace, sourceId), {
      _tag: 'SourceRecord',
      corpusId: config.id,
      namespace: config.namespace,
      sourceId,
      contentHash: existing?.contentHash ?? '',
      metadataHash: existing?.metadataHash ?? '',
      sourceHash: existing?.sourceHash ?? '',
      indexHash: existing?.indexHash ?? '',
      status: 'deleted',
      chunkCount: 0,
      ...(existing?.title ? { title: existing.title } : {}),
      ...(existing?.metadata ? { metadata: existing.metadata } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      firstSeenAt: existing?.firstSeenAt ?? now,
      deletedAt: now,
      errors: existing?.errors ?? [],
    } as unknown as import('../storage').JsonObject)
    return { sourceId, deletedCount }
  }

  async function clearSources(): Promise<SourceClearResult> {
    const sources = await listSources({ includeDeleted: false })
    const deletedCount = await config.indexer.clear()
    for (const source of sources) {
      await deleteSource(source.sourceId)
    }
    return { deletedCount, sourceCount: sources.length }
  }

  return Object.freeze({
    _tag: 'Corpus' as const,
    id: config.id,
    namespace: config.namespace,
    sync,
    getSource,
    listSources,
    deleteSource,
    clearSources,
  })
}
