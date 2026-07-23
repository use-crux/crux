import {
  applyPlugins,
  getHooks,
  inMemoryStorage,
  prompt,
  setHooks,
  type CruxPlugin,
  type createInMemoryObservabilityTransport,
} from "@use-crux/core";
import { createSemanticCache } from "@use-crux/core/cache";
import { embedding } from "@use-crux/core/embedding";
import type { LanguageModel } from "ai";
import { z } from "zod";

export function generationStreamSpan(
  records: ReturnType<typeof createInMemoryObservabilityTransport>["records"],
): Extract<
  ReturnType<typeof createInMemoryObservabilityTransport>["records"][number],
  { type: "span:start" }
> | undefined {
  return records.find(
    (record): record is Extract<typeof record, { type: "span:start" }> =>
      record.type === "span:start" &&
      record.primitive === "generation.stream",
  );
}

export function model(): LanguageModel {
  return {
    provider: "openai",
    modelId: "gpt-4o",
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}

export const textPrompt = prompt({
  id: "ai-text-stream-result-correlation",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});

export const structuredPrompt = prompt({
  id: "ai-structured-stream-result-correlation",
  input: z.object({ message: z.string() }),
  output: z.object({ answer: z.number() }),
  prompt: ({ input }) => input.message,
});

export const cachedPrompt = prompt({
  id: "ai-cached-stream-result-correlation",
  input: z.object({ message: z.string() }),
  cache: {
    semantic: { query: ({ input }) => input.message },
  },
  prompt: ({ input }) => input.message,
});

export const cachedStructuredPrompt = prompt({
  id: "ai-cached-structured-stream-result-correlation",
  input: z.object({ message: z.string() }),
  output: z.object({ answer: z.number() }),
  cache: {
    semantic: { query: ({ input }) => input.message },
  },
  prompt: ({ input }) => input.message,
});

export function installPlugins(...plugins: readonly CruxPlugin[]): void {
  setHooks(applyPlugins(plugins, getHooks()).hooks);
}

export function installSemanticCache(): void {
  const cacheEmbedding = embedding({
    kind: "dense",
    name: "stream-result-correlation",
    dimensions: 2,
    maxInputTokens: 128,
    batch: { maxSize: 8 },
    embed: async (texts) => ({
      embeddings: texts.map(() => [1, 0]),
    }),
  });
  installPlugins(
    createSemanticCache({
      storage: inMemoryStorage(),
      embedding: cacheEmbedding,
      ttl: 60_000,
      scope: "global",
    }),
  );
}
