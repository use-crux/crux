/** Embedding, asset materialization, and indexed-generation writes. @module */

import type { AssetStore } from "../asset";
import type { DenseEmbedding, SparseEmbedding } from "../embedding";
import {
  guardIndexedEmbeddingSpace,
  registerIndexedEmbeddingSpaceWriter,
  resolveIndexedEmbeddingSpace,
  type IndexedKnowledgeStore,
} from "../indexed-knowledge";
import type { RecordStore, SparseVector } from "../storage";
import type { ResolvedPipelineCache } from "./cache";
import { runEmbeddingStage } from "./embedding-stage";
import { materializeChunkMedia } from "./media";
import { normalizeChunk, normalizeParentChunk } from "./normalize";
import type { PreparedPipelineOutput } from "./pipeline-runner";
import type {
  IndexDryRunResult,
  IndexResult,
  PipelineCacheMode,
  SourceStageRecord,
} from "./types";
import { unique } from "./collections";

type IndexWritePayload =
  | Omit<IndexResult, "_meta">
  | Omit<IndexDryRunResult, "_meta">;

/** Function that embeds and optionally persists prepared chunks. */
export type WritePreparedChunks = (
  prepared: PreparedPipelineOutput,
  options: {
    replaceSources: boolean;
    dryRun: boolean;
    cacheMode: PipelineCacheMode | "disabled";
  },
) => Promise<IndexWritePayload>;

/** Bind the mutation boundary for one index namespace. */
export function createIndexWriter(args: {
  readonly indexerId: string;
  readonly namespace: string;
  readonly records: RecordStore;
  readonly indexed: IndexedKnowledgeStore;
  readonly assets?: AssetStore;
  readonly dense?: DenseEmbedding;
  readonly sparse?: SparseEmbedding;
  readonly cache: ResolvedPipelineCache;
}): WritePreparedChunks {
  return async (prepared, options) => {
    const normalizedChunks = prepared.chunks.map((chunk) =>
      normalizeChunk(chunk, args.namespace),
    );
    const parents = prepared.parents.map((parent) =>
      normalizeParentChunk(parent, args.namespace),
    );
    const sourceIds = unique(normalizedChunks.map((chunk) => chunk.sourceId));
    const resolvedEmbeddingSpace =
      args.dense && normalizedChunks.length > 0
        ? resolveIndexedEmbeddingSpace(args.dense)
        : undefined;
    const embeddingSpace = resolvedEmbeddingSpace
      ? await guardIndexedEmbeddingSpace({
          records: args.records,
          indexerId: args.indexerId,
          namespace: args.namespace,
          space: resolvedEmbeddingSpace,
          write: !options.dryRun,
        })
      : undefined;
    const chunks = await materializeChunkMedia(normalizedChunks, {
      assets: args.assets,
      dryRun: options.dryRun,
    });
    const embeddings = await prepareEmbeddings(
      args,
      chunks,
      options.cacheMode,
      !options.dryRun,
    );
    const stages = [...(prepared.stages ?? []), ...embeddings.stages];

    if (options.dryRun) {
      return {
        namespace: args.namespace,
        sourceCount: sourceIds.length,
        chunkCount: chunks.length,
        dryRun: true,
        chunks,
        parents,
        ...(stages.length > 0 ? { stages } : {}),
        embeddings: {
          dense: embeddings.dense !== undefined,
          sparse: embeddings.sparse !== undefined,
        },
      };
    }

    await args.indexed.persistGeneration({
      chunks,
      parents,
      dense: embeddings.dense,
      sparse: embeddings.sparse,
      embeddingSpace,
      replaceSources: options.replaceSources,
    });
    if (resolvedEmbeddingSpace) {
      await registerIndexedEmbeddingSpaceWriter({
        records: args.records,
        indexerId: args.indexerId,
        namespace: args.namespace,
        space: resolvedEmbeddingSpace,
      });
    }
    return {
      namespace: args.namespace,
      sourceCount: sourceIds.length,
      chunkCount: chunks.length,
      ...(stages.length > 0 ? { stages } : {}),
    };
  };
}

async function prepareEmbeddings(
  args: {
    dense?: DenseEmbedding;
    sparse?: SparseEmbedding;
    namespace: string;
    cache: ResolvedPipelineCache;
  },
  chunks: Parameters<typeof runEmbeddingStage>[0]["chunks"],
  cacheMode: PipelineCacheMode | "disabled",
  writeCache: boolean,
): Promise<{
  dense?: number[][];
  sparse?: Array<SparseVector | undefined>;
  stages: SourceStageRecord[];
}> {
  const dense = args.dense
    ? await runEmbeddingStage({
        embedding: args.dense,
        chunks,
        namespace: args.namespace,
        cacheConfig: args.cache,
        cacheMode,
        writeCache,
      })
    : undefined;
  const sparse = args.sparse
    ? await runEmbeddingStage({
        embedding: args.sparse,
        chunks,
        namespace: args.namespace,
        cacheConfig: args.cache,
        cacheMode,
        writeCache,
      })
    : undefined;
  return {
    ...(dense ? { dense: dense.embeddings } : {}),
    ...(sparse ? { sparse: sparse.embeddings } : {}),
    stages: [...(dense?.stages ?? []), ...(sparse?.stages ?? [])],
  };
}
