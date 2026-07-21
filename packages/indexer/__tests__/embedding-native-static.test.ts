import { embedding, embeddingSpaceDigest } from "@use-crux/core/embedding";
import { describe, expect } from "vitest";
import {
  expectNativeExtractionParity,
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

describe("embedding native static projection", () => {
  itWithRustOxc(
    "keeps embedding snapshots free of authored payloads and undeclared task fields",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding", "embed", "indexer"],
        source: [
          `import { embedding } from '@use-crux/core/embedding'`,
          `import { indexer } from '@use-crux/core/indexing'`,
          `declare const records: never`,
          `declare const vectors: never`,
          `const vision = embedding({`,
          `  kind: 'dense', name: 'vision', dimensions: 3, maxInputTokens: 32,`,
          `  version: '', truncate: {},`,
          `  tasks: { query: '', credential: 'PHASE7_PRIVATE_SENTINEL' },`,
          `  batch: { maxSize: 1 }, embed: async () => [],`,
          `})`,
          `const exact = embedding({`,
          `  kind: 'dense', name: 'exact', dimensions: 3, maxInputTokens: 32,`,
          `  version: '', truncate: {}, tasks: { query: '' },`,
          `  batch: { maxSize: 1 }, embed: async () => [],`,
          `})`,
          `const writer = indexer({ id: 'writer', namespace: 'shared', records, vectors, dense: vision, credential: 'PHASE7_PRIVATE_SENTINEL' })`,
          `void vision.embed({ type: 'image', source: 'data:image/png;base64,PHASE7_PRIVATE_SENTINEL' } as never)`,
        ].join("\n"),
      });

      expect(JSON.stringify(result.nativeOut)).not.toContain(
        "PHASE7_PRIVATE_SENTINEL",
      );
      expect(JSON.stringify(result.fallbackOut)).not.toContain(
        "PHASE7_PRIVATE_SENTINEL",
      );
      for (const definition of result.nativeOut.definitions.filter((item) =>
        ["embedding", "embedding.call", "rag.indexer"].includes(item.kind),
      )) {
        expect(definition).not.toHaveProperty("sourceSnippet");
      }
      expect(
        result.nativeOut.definitions.find(
          (item) => item.id === "embedding:src-fixture.ts:vision",
        )?.metadata?.facts,
      ).toMatchObject({ identityInputs: { tasks: { query: "" } } });
      expect(
        result.nativeOut.definitions.find(
          (item) => item.id === "embedding:src-fixture.ts:vision",
        )?.metadata?.facts,
      ).toMatchObject({
        space: { name: "vision", dimensions: 3 },
      });
      expect(
        result.nativeOut.definitions.find(
          (item) => item.id === "embedding:src-fixture.ts:vision",
        )?.metadata?.facts,
      ).not.toHaveProperty("identityDigest");
      expect(
        (
          result.nativeOut.definitions.find(
            (item) => item.id === "embedding:src-fixture.ts:vision",
          )?.metadata?.facts as { readonly space?: unknown } | undefined
        )?.space,
      ).not.toHaveProperty("digest");
      const runtime = embedding({
        kind: "dense",
        name: "exact",
        dimensions: 3,
        maxInputTokens: 32,
        version: "",
        truncate: {} as never,
        tasks: { query: "" },
        batch: { maxSize: 1 },
        embed: async () => [],
      });
      const digest = embeddingSpaceDigest(runtime.fingerprint!);
      expect(
        result.nativeOut.definitions.find(
          (item) => item.id === "embedding:src-fixture.ts:exact",
        )?.metadata?.facts,
      ).toMatchObject({ identityDigest: digest, space: { digest } });
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "projects one module-scoped multimodal embedding definition",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding"],
        source: [
          `import { embedding } from '@use-crux/core/embedding'`,
          `export const vision = embedding({`,
          `  kind: 'dense',`,
          `  name: 'vision-space',`,
          `  dimensions: 3,`,
          `  maxInputTokens: 1024,`,
          `  modalities: ['text', 'image'],`,
          `  batch: { maxSize: 8 },`,
          `  embed: async () => [],`,
          `})`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "embedding")).toBe(1);
      const projected = result.nativeOut.definitions.find(
        (definition) => definition.kind === "embedding",
      );
      expect(projected).toMatchObject({
        id: "embedding:src-fixture.ts:vision",
        name: "vision",
        metadata: {
          facts: {
            kind: "embedding",
            embeddingKind: "dense",
            adapter: "core",
            identityInputs: {
              name: "vision-space",
              dimensions: 3,
              maxInputTokens: 1024,
              truncate: { strategy: "fail" },
              modalities: ["text", "image"],
              normalization: "unknown",
              preprocessorCount: 0,
            },
            space: { name: "vision-space", dimensions: 3 },
          },
        },
      });

      const runtime = embedding({
        kind: "dense",
        name: "vision-space",
        dimensions: 3,
        maxInputTokens: 1024,
        modalities: ["text", "image"],
        batch: { maxSize: 8 },
        embed: async () => [],
      });
      const digest = embeddingSpaceDigest(runtime.fingerprint!);
      expect(projected?.metadata?.facts).toMatchObject({
        identityDigest: digest,
        space: { digest },
      });
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "scopes identical embedding bindings to their modules",
    async () => {
      const source = [
        `import { embedding } from '@use-crux/core/embedding'`,
        `export const vision = embedding({`,
        `  kind: 'dense', name: 'vision', dimensions: 3, maxInputTokens: 8,`,
        `  batch: { maxSize: 1 }, embed: async () => [],`,
        `})`,
      ].join("\n");
      const first = await extractNativeAndFallback({
        callNames: ["embedding"],
        source,
      });
      const second = await extractNativeAndFallback({
        callNames: ["embedding"],
        source,
        primaryPath: "src/other.ts",
      });

      expect(
        first.nativeOut.definitions.find((item) => item.kind === "embedding")
          ?.id,
      ).toBe("embedding:src-fixture.ts:vision");
      expect(
        second.nativeOut.definitions.find((item) => item.kind === "embedding")
          ?.id,
      ).toBe("embedding:src-other.ts:vision");
      expectNativeExtractionParity(first.nativeOut, first.fallbackOut);
      expectNativeExtractionParity(second.nativeOut, second.fallbackOut);
    },
  );

  itWithRustOxc("projects exact first-party provider defaults", async () => {
    const fixtures = [
      {
        module: "@use-crux/google",
        call: `embedding(client, { model: 'gemini-embedding-2' })`,
        adapter: "google",
        model: "gemini-embedding-2",
        runtime: {
          name: "gemini-embedding-2",
          dimensions: 3072,
          maxInputTokens: 8192,
          modalities: ["text", "image", "audio", "video", "document"] as const,
          version:
            'google:model="gemini-embedding-2";tasks.query=default;tasks.document=default;title=default;mimeType=default;autoTruncate=default',
        },
      },
      {
        module: "@use-crux/openai",
        call: `embedding(client, { name: 'small', model: 'text-embedding-3-small' })`,
        adapter: "openai",
        model: "text-embedding-3-small",
        runtime: {
          name: "small",
          dimensions: 1536,
          maxInputTokens: 8192,
          modalities: ["text"] as const,
          version: 'openai:model="text-embedding-3-small"',
        },
      },
      {
        module: "@use-crux/ai",
        call: `embedding({ name: 'sdk', model: 'provider:model', dimensions: 4, maxInputTokens: 32 })`,
        adapter: "ai-sdk",
        model: "provider:model",
        runtime: {
          name: "sdk",
          dimensions: 4,
          maxInputTokens: 32,
          modalities: ["text"] as const,
          version: 'ai-sdk:model="provider:model"',
        },
      },
    ] as const;

    for (const fixture of fixtures) {
      const result = await extractNativeAndFallback({
        callNames: ["embedding"],
        source: [
          `import { embedding } from '${fixture.module}'`,
          `declare const client: never`,
          `export const model = ${fixture.call}`,
        ].join("\n"),
      });
      const projected = result.nativeOut.definitions.find(
        (definition) => definition.kind === "embedding",
      );
      expect(nativeFactCount(result.record, "embedding")).toBe(1);
      const runtime = embedding({
        kind: "dense",
        ...fixture.runtime,
        batch: { maxSize: 100 },
        embed: async () => [],
      });
      const digest = embeddingSpaceDigest(runtime.fingerprint!);
      expect(projected?.metadata?.facts).toMatchObject({
        kind: "embedding",
        embeddingKind: "dense",
        adapter: fixture.adapter,
        model: fixture.model,
        identityDigest: digest,
        space: { digest },
      });
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    }
  });

  itWithRustOxc(
    "omits identity evidence for invalid Google capability literals",
    async () => {
      for (const invalidConfig of [
        `modalities: ['text', 'bogus']`,
        `autoTruncate: 'yes'`,
      ]) {
        const result = await extractNativeAndFallback({
          callNames: ["embedding"],
          source: [
            `import { embedding } from '@use-crux/google'`,
            `declare const client: never`,
            `export const model = embedding(client, { model: 'gemini-embedding-2', ${invalidConfig} })`,
          ].join("\n"),
        });
        const facts = result.nativeOut.definitions.find(
          (definition) => definition.kind === "embedding",
        )?.metadata?.facts;

        expect(facts).toMatchObject({
          space: { name: "gemini-embedding-2", dimensions: 3072 },
        });
        expect(facts).not.toHaveProperty("identityDigest");
        expect(
          (facts as { readonly space?: unknown } | undefined)?.space,
        ).not.toHaveProperty("digest");
        expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
      }
    },
  );

  itWithRustOxc(
    "projects a vector indexer and its embedding dependency",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding", "indexer"],
        source: [
          `import { embedding } from '@use-crux/core/embedding'`,
          `import { indexer } from '@use-crux/core/indexing'`,
          `const dense = embedding({`,
          `  kind: 'dense', name: 'dense', dimensions: 3, maxInputTokens: 32,`,
          `  batch: { maxSize: 1 }, embed: async () => [],`,
          `})`,
          `export const catalog = indexer({`,
          `  id: 'catalog', namespace: 'shared', dense, records, vectors,`,
          `})`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "rag.indexer")).toBe(1);
      expect(
        result.nativeOut.definitions.find(
          (item) => item.kind === "rag.indexer",
        ),
      ).toMatchObject({
        id: "rag.indexer:catalog",
        name: "catalog",
        metadata: {
          facts: {
            kind: "rag.indexer",
            indexerId: "catalog",
            namespace: "shared",
          },
        },
      });
      expect(result.record.nativeFacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            replaces: expect.arrayContaining([
              expect.objectContaining({ extractor: "rag.indexer" }),
            ]),
            facts: expect.objectContaining({
              references: expect.arrayContaining([
                {
                  type: "rag.indexer.uses_dense_embedding",
                  toVariable: "dense",
                },
              ]),
            }),
          }),
        ]),
      );
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "projects an embedding callsite and its local embedding dependency",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding", "embed"],
        source: [
          `import { embedding } from '@use-crux/core/embedding'`,
          `const vision = embedding({`,
          `  kind: 'dense', name: 'vision', dimensions: 3, maxInputTokens: 32,`,
          `  modalities: ['text', 'image'],`,
          `  batch: { maxSize: 1 }, embed: async () => [],`,
          `})`,
          `export async function search(image: unknown) {`,
          `  return vision.embed(image, { role: 'query' })`,
          `}`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "embedding.call")).toBe(1);
      const definition = result.nativeOut.definitions.find(
        (item) => item.kind === "embedding.call",
      );
      expect(definition).toMatchObject({
        kind: "embedding.call",
        metadata: {
          facts: {
            kind: "embedding.call",
            operation: "embed",
            role: "query",
          },
        },
      });
      expect(result.nativeOut.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: definition?.id,
            to: "embedding:src-fixture.ts:vision",
            type: "embedding.call.uses_embedding",
          }),
        ]),
      );
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "ignores same-name local factories and unrelated embed methods",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding", "embed"],
        source: [
          `function embedding(config: unknown) { return config }`,
          `const local = embedding({ kind: 'dense' })`,
          `const unrelated = { embed: (value: unknown) => value }`,
          `void unrelated.embed('text')`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "embedding")).toBe(0);
      expect(nativeFactCount(result.record, "embedding.call")).toBe(0);
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "projects an embedding whose config is a source-local reference",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding"],
        source: [
          `import { embedding } from '@use-crux/core/embedding'`,
          `const config = {`,
          `  kind: 'dense', name: 'vision', dimensions: 3, maxInputTokens: 32,`,
          `  modalities: ['text', 'image'], batch: { maxSize: 1 }, embed: async () => [],`,
          `}`,
          `export const vision = embedding(config)`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "embedding")).toBe(1);
      expect(
        result.nativeOut.definitions.find((item) => item.kind === "embedding"),
      ).toMatchObject({
        id: "embedding:src-fixture.ts:vision",
        metadata: {
          facts: {
            kind: "embedding",
            identityInputs: { modalities: ["text", "image"] },
          },
        },
      });
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc("projects an embedding through an import alias", async () => {
    const result = await extractNativeAndFallback({
      callNames: ["embedding"],
      source: [
        `import { embedding as defineEmbedding } from '@use-crux/core/embedding'`,
        `export const dense = defineEmbedding({`,
        `  kind: 'dense', name: 'dense', dimensions: 3, maxInputTokens: 32,`,
        `  batch: { maxSize: 1 }, embed: async () => [],`,
        `})`,
      ].join("\n"),
    });

    expect(nativeFactCount(result.record, "embedding")).toBe(1);
    expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
  });

  itWithRustOxc(
    "projects a callsite whose embedding receiver is imported",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding", "embed"],
        source: [
          `import { vision } from './models'`,
          `export const result = vision.embed('query')`,
        ].join("\n"),
        additionalFiles: [
          {
            path: "src/models.ts",
            source: [
              `import { embedding } from '@use-crux/core/embedding'`,
              `export const vision = embedding({`,
              `  kind: 'dense', name: 'vision', dimensions: 3, maxInputTokens: 32,`,
              `  batch: { maxSize: 1 }, embed: async () => [],`,
              `})`,
            ].join("\n"),
          },
        ],
      });

      expect(
        result.nativeOut.definitions.find(
          (item) => item.kind === "embedding.call",
        ),
      ).toBeDefined();
      expect(result.nativeOut.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "embedding.call.uses_embedding",
            to: "embedding:src-models.ts:vision",
          }),
        ]),
      );
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "infers bare-asset modality and role through local references",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["embedding", "embedMany"],
        source: [
          `import { embedding } from '@use-crux/core/embedding'`,
          `declare const privateBytes: Uint8Array`,
          `const vision = embedding({`,
          `  kind: 'dense', name: 'vision', dimensions: 3, maxInputTokens: 32,`,
          `  modalities: ['text', 'image'], batch: { maxSize: 1 }, embed: async () => [],`,
          `})`,
          `const image = { type: 'data', mediaType: 'IMAGE/PNG; charset=binary', data: privateBytes } as const`,
          `const options = { role: 'query' } as const`,
          `export const result = vision.embedMany([image], options)`,
        ].join("\n"),
      });

      expect(
        result.nativeOut.definitions.find(
          (item) => item.kind === "embedding.call",
        )?.metadata?.facts,
      ).toMatchObject({
        kind: "embedding.call",
        operation: "embedMany",
        modalities: ["image"],
        role: "query",
      });
      expect(JSON.stringify(result.nativeOut)).not.toContain("privateBytes");
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );
});
