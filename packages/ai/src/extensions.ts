/**
 * Provider-specific extensions for the AI SDK runtime.
 *
 * These capabilities sit beside generation on `aiSdkProviderRuntime.create()`
 * and keep non-generation AI SDK calls behind the same scripted gateway seam.
 *
 * @module
 */

import type { EmbeddingModel, LanguageModel, RerankingModel } from "ai";
import type { z } from "zod";
import {
  embedding as coreEmbedding,
  type DenseEmbedding,
} from "@use-crux/core/embedding";
import type {
  Reranker,
  RetrievalModel,
  RetrieverHit,
} from "@use-crux/core/retrieval";
import type { SdkGateway } from "./gateway";

export interface AIRetrievalModelConfig {
  model: LanguageModel;
  maxRetries?: number;
}

export interface AIRerankerConfig {
  name: string;
  model: RerankingModel;
  topN?: number;
  maxRetries?: number;
  document?: (hit: RetrieverHit) => string;
}

export interface AIEmbeddingConfig {
  name: string;
  model: EmbeddingModel;
  /** Additional vector-semantic revision appended to the derived model identity. */
  version?: string;
  dimensions: number;
  maxInputTokens: number;
  batch?: {
    maxSize?: number;
    concurrency?: number;
  };
  maxRetries?: number;
  maxParallelCalls?: number;
  headers?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
}

/** Extensions attached to a bound `aiSdkProviderRuntime`. */
export interface AiSdkRuntimeExtensions {
  /** Create a dense Crux embedding backed by AI SDK `embedMany()`. */
  embedding(config: AIEmbeddingConfig): DenseEmbedding;
  /** Create a bound retrieval model backed by AI SDK generation helpers. */
  retrievalModel(config: AIRetrievalModelConfig): RetrievalModel;
  /** Create a Crux retriever reranker backed by AI SDK `rerank()`. */
  reranker(config: AIRerankerConfig): Reranker;
}

/** Bind AI SDK non-generation capabilities to a scripted or live gateway. */
export function createAiSdkRuntimeExtensions(
  gateway: SdkGateway,
): AiSdkRuntimeExtensions {
  return Object.freeze({
    embedding(config: AIEmbeddingConfig) {
      return coreEmbedding({
        kind: "dense",
        name: config.name,
        dimensions: config.dimensions,
        maxInputTokens: config.maxInputTokens,
        version: embeddingVersion(config),
        batch: {
          maxSize: config.batch?.maxSize ?? 100,
          concurrency: config.batch?.concurrency ?? 1,
        },
        async embed(texts) {
          const result = await gateway.embedMany({
            model: config.model,
            values: texts,
            maxRetries: config.maxRetries,
            maxParallelCalls: config.maxParallelCalls ?? 1,
            headers: config.headers,
            providerOptions: config.providerOptions as Parameters<
              SdkGateway["embedMany"]
            >[0]["providerOptions"],
          });

          return {
            embeddings: result.embeddings.map((embedding) => [...embedding]),
            usage: {
              inputTokens: result.usage.tokens,
              totalTokens: result.usage.tokens,
            },
          };
        },
      });
    },
    retrievalModel(config: AIRetrievalModelConfig) {
      const model: RetrievalModel = {
        generateText: async (args: { system?: string; prompt: string }) => {
          const result = await gateway.generateText({
            model: config.model,
            system: args.system,
            prompt: args.prompt,
            maxRetries: config.maxRetries,
          } as Parameters<SdkGateway["generateText"]>[0]);
          return { text: result.text };
        },
        generateObject: async <T>(args: {
          system?: string;
          prompt: string;
          schema: z.ZodType<T>;
        }) => {
          const result = await gateway.generateObject({
            model: config.model,
            system: args.system,
            prompt: args.prompt,
            schema: args.schema,
            maxRetries: config.maxRetries,
          } as Parameters<SdkGateway["generateObject"]>[0]);
          return { object: result.object as T };
        },
      };
      return model;
    },
    reranker(config: AIRerankerConfig) {
      const engine: Reranker = {
        name: config.name,
        async rerank(args: { query: string; hits: readonly RetrieverHit[] }) {
          const { query, hits } = args;
          if (hits.length === 0) return [];

          const result = await gateway.rerank({
            model: config.model,
            query,
            documents: hits.map((hit) =>
              config.document ? config.document(hit) : hit.content,
            ),
            topN: config.topN,
            maxRetries: config.maxRetries,
          });

          return result.ranking.flatMap((ranking) => {
            const hit = hits[ranking.originalIndex];
            return hit ? [{ ...hit, score: ranking.score }] : [];
          });
        },
      };
      return engine;
    },
  });
}

/** Build a stable identity from an AI SDK embedding model. */
function embeddingVersion(config: AIEmbeddingConfig): string {
  const modelIdentity =
    typeof config.model === "string"
      ? `model=${JSON.stringify(config.model)}`
      : [
          `provider=${JSON.stringify(config.model.provider)}`,
          `modelId=${JSON.stringify(config.model.modelId)}`,
        ].join(";");
  return [
    `ai-sdk:${modelIdentity}`,
    ...(config.version === undefined
      ? []
      : [`version=${JSON.stringify(config.version)}`]),
  ].join(";");
}
