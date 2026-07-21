/** Cache-aware document-to-chunk pipeline execution. @module */

import { resolveCacheMode, runCachedStage } from './cache'
import type { ResolvedPipelineCache } from './cache'
import { normalizeChunkingOptions } from './chunking-options'
import { stableHash } from './hash'
import { hasMediaParts, normalizeMediaDocument } from './media'
import { normalizeChunk, normalizeParentChunk } from './normalize'
import { indexingPipeline, stageFingerprint } from './pipeline'
import { applyParentProvenanceConfidence, applyProvenanceConfidence } from './provenance'
import { sourceFactsWithLocations } from './source-facts'
import type {
  ChunkingOptions,
  ChunkProvenance,
  CruxChunk,
  CruxDocument,
  CruxParentChunk,
  IndexingPipeline,
  PipelineCacheMode,
  SourceStageRecord,
} from './types'

/** Fully normalized output ready for embedding and persistence. */
export interface PreparedPipelineOutput {
  readonly chunks: CruxChunk[]
  readonly parents: CruxParentChunk[]
  readonly stages?: SourceStageRecord[]
}

/** Function that executes an indexer's configured pipeline. */
export type PreparePipelineOutput = (
  documents: CruxDocument[],
  options: { chunking?: ChunkingOptions; cache?: PipelineCacheMode; dryRun?: boolean },
) => Promise<PreparedPipelineOutput>

/** Create a pipeline runner bound to one index namespace. */
export function createPipelineRunner(args: {
  readonly namespace: string
  readonly pipeline?: IndexingPipeline
  readonly cache: ResolvedPipelineCache
  readonly hasAssetStore: boolean
}): PreparePipelineOutput {
  const pipeline = args.pipeline ?? indexingPipeline()

  return async (documents, options) => {
    const normalizedChunking = normalizeChunkingOptions(options.chunking)
    const cacheMode = resolveCacheMode(args.cache, options.cache)
    const allChunks: CruxChunk[] = []
    const allParents: CruxParentChunk[] = []
    const allStages: SourceStageRecord[] = []

    for (const inputDocument of documents) {
      let stageCacheMode = hasMediaParts(inputDocument) && cacheMode !== 'disabled' ? 'bypass' : cacheMode
      let document = await normalizeMediaDocument(inputDocument, { hasAssetStore: args.hasAssetStore })
      let sourceHash = documentHash(document)
      let provenanceConfidence: ChunkProvenance['confidence'] = 'exact'

      for (const documentTransform of pipeline.documents) {
        const before = document
        const transformed = await runCachedStage({
          cacheConfig: args.cache,
          cacheMode: stageCacheMode,
          namespace: args.namespace,
          sourceId: document.sourceId,
          sourceHash,
          previousHash: sourceHash,
          stageKind: 'document-transform',
          stageName: documentTransform.name,
          stageVersion: documentTransform.version,
          stageFingerprint: stageFingerprint(documentTransform),
          onStage: (stage) => allStages.push(stage),
          writeCache: options.dryRun !== true,
          cacheable: (value) => !hasMediaParts(value),
          run: async () => {
            let markedDerived = false
            const next = await documentTransform.run(document, {
              sourceHash,
              markDerived() {
                markedDerived = true
              },
            })
            assertDocumentIdentity(next, before, documentTransform.name)
            if (next.content !== before.content && !markedDerived) provenanceConfidence = 'derived'
            return { ...next, ...(before.source ? { source: before.source } : {}) }
          },
        })
        document = await normalizeMediaDocument(transformed, { hasAssetStore: args.hasAssetStore })
        if (hasMediaParts(document) && stageCacheMode !== 'disabled') stageCacheMode = 'bypass'
        sourceHash = documentHash(document)
      }

      const chunkingResult = await runCachedStage({
        cacheConfig: args.cache,
        cacheMode: stageCacheMode,
        namespace: args.namespace,
        sourceId: document.sourceId,
        sourceHash,
        previousHash: sourceHash,
        stageKind: 'chunker',
        stageName: pipeline.chunker.name,
        stageVersion: pipeline.chunker.version,
        stageFingerprint: pipeline.chunker.fingerprint(),
        summarize: (value) => ({
          chunkCount: value.chunks.length,
          parentCount: value.parents?.length ?? 0,
        }),
        onStage: (stage) => allStages.push(stage),
        writeCache: options.dryRun !== true,
        cacheable: (value) => !value.chunks.some((chunk) => chunk.media),
        run: () => pipeline.chunker.chunkDocument(document, { chunking: normalizedChunking }),
      })
      if (chunkingResult.chunks.some((chunk) => chunk.media) && stageCacheMode !== 'disabled') {
        stageCacheMode = 'bypass'
      }

      let chunks = chunkingResult.chunks.map((chunk) => normalizePipelineChunk(
        chunk,
        document,
        args.namespace,
        provenanceConfidence,
      ))
      const parents = (chunkingResult.parents ?? []).map((parent) => normalizePipelineParent(
        parent,
        document,
        args.namespace,
        provenanceConfidence,
      ))

      for (const chunkTransform of pipeline.chunks) {
        chunks = await runCachedStage({
          cacheConfig: args.cache,
          cacheMode: stageCacheMode,
          namespace: args.namespace,
          sourceId: document.sourceId,
          sourceHash,
          previousHash: stableHash(chunks),
          stageKind: 'chunk-transform',
          stageName: chunkTransform.name,
          stageVersion: chunkTransform.version,
          stageFingerprint: stageFingerprint(chunkTransform),
          summarize: (value) => ({ chunkCount: value.length }),
          onStage: (stage) => allStages.push(stage),
          writeCache: options.dryRun !== true,
          cacheable: (value) => !value.some((chunk) => chunk.media),
          run: async () => (await chunkTransform.run(chunks, { sourceHash })).map((chunk) =>
            normalizeChunk({
              ...chunk,
              source: sourceFactsWithLocations(
                chunk.source ?? document.source,
                chunk.provenance?.sourceLocations ?? [],
              ),
            }, args.namespace)),
        })
        if (chunks.some((chunk) => chunk.media) && stageCacheMode !== 'disabled') stageCacheMode = 'bypass'
      }

      allChunks.push(...chunks)
      allParents.push(...parents)
    }
    return { chunks: allChunks, parents: allParents, stages: allStages }
  }
}

function normalizePipelineChunk(
  chunk: CruxChunk,
  document: CruxDocument,
  namespace: string,
  confidence: ChunkProvenance['confidence'],
): CruxChunk {
  return normalizeChunk(applyProvenanceConfidence({
    ...chunk,
    source: sourceFactsWithLocations(chunk.source ?? document.source, chunk.provenance?.sourceLocations ?? []),
  }, confidence), namespace)
}

function normalizePipelineParent(
  parent: CruxParentChunk,
  document: CruxDocument,
  namespace: string,
  confidence: ChunkProvenance['confidence'],
): CruxParentChunk {
  return normalizeParentChunk(applyParentProvenanceConfidence({
    ...parent,
    source: sourceFactsWithLocations(parent.source ?? document.source, parent.provenance?.sourceLocations ?? []),
  }, confidence), namespace)
}

function documentHash(document: CruxDocument): string {
  return stableHash({
    content: document.content,
    metadata: document.metadata ?? {},
    parts: (document.parts ?? []).map((part) => part.kind === 'media'
      ? {
          id: part.id,
          kind: part.kind,
          modality: part.modality,
          media: part.asset.type === 'data'
            ? part.asset.sha256
            : part.asset.type === 'url'
              ? part.asset.url.href
              : `${part.asset.provider}:${part.asset.fileId}`,
          caption: part.caption,
          metadata: part.metadata,
          sourceLocation: part.sourceLocation,
        }
      : part),
  })
}

function assertDocumentIdentity(next: CruxDocument, before: CruxDocument, transformName: string): void {
  if (next.namespace !== before.namespace || next.sourceId !== before.sourceId) {
    throw new Error(`Document transform "${transformName}" must preserve namespace and sourceId.`)
  }
}
