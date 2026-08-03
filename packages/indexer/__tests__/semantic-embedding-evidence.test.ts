import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../src/indexer/semantic/service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic embedding evidence", () => {
  it("resolves embedding consumers, callsites, and conclusive invalid combinations", async () => {
    const root = await fixtureRoot();
    const file = join(root, "src/index.ts");
    await writeFile(
      file,
      [
        `import { embedding } from '@use-crux/core/embedding'`,
        `import { indexer } from '@use-crux/core/indexing'`,
        `import { retriever, knowledgeBase } from '@use-crux/core/retrieval'`,
        `import { inMemoryRecordStore } from '@use-crux/core/storage'`,
        `declare const bytes: Uint8Array`,
        `const records = inMemoryRecordStore()`,
        `declare const search: never`,
        `export const text = embedding({ kind: 'dense', name: 'text', dimensions: 3, maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `export const vision = embedding({ kind: 'dense', name: 'vision', dimensions: 4, maxInputTokens: 32, modalities: ['text', 'image'], batch: { maxSize: 1 }, embed: async () => [] })`,
        `export const sparse = embedding({ kind: 'sparse', name: 'sparse', maxInputTokens: 32, modalities: ['text'], batch: { maxSize: 1 }, embed: async () => [] })`,
        `export const writer = indexer({ id: 'writer', namespace: 'shared', records, search, dense: text })`,
        `export const sparseWriter = indexer({ id: 'sparse-writer', namespace: 'sparse', records, search, sparse })`,
        `export const reader = retriever({ id: 'reader', indexerId: 'writer', namespace: 'shared', records, search, dense: vision })`,
        `export const kb = knowledgeBase({ id: 'kb', records, search, embeddings: vision, sparseEmbeddings: sparse })`,
        `export async function run() {`,
        `  await text.embed({ type: 'image', source: bytes, mediaType: 'image/png' })`,
        `  await sparse.embed({ type: 'image', source: bytes, mediaType: 'image/png' } as never)`,
        `  await sparseWriter.indexDocuments([{ id: 'dog', parts: [{ type: 'image', asset: { type: 'data', mediaType: 'image/png', data: bytes } }] }])`,
        `}`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    const facts = patch.facts;

    expect(facts.definitions?.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["embedding.call"]),
    );
    expect(facts.relations?.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "embedding.call.uses_embedding",
        "rag.indexer.uses_dense_embedding",
        "rag.indexer.uses_sparse_embedding",
        "rag.retriever.uses_dense_embedding",
        "rag.knowledgeBase.uses_dense_embedding",
        "rag.knowledgeBase.uses_sparse_embedding",
      ]),
    );
    expect(
      facts.definitions?.find((item) => item.id === "rag.retriever:reader")
        ?.metadata?.facts,
    ).toMatchObject({
      kind: "rag.retriever",
      retrieverId: "reader",
      indexerId: "writer",
      namespace: "shared",
    });
    expect(facts.lintFindings?.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining([
        "embedding.unsupported-modality",
        "embedding.namespace-identity-mismatch",
        "embedding.sparse-media",
      ]),
    );
    expect(
      new Set(
        facts.lintFindings
          ?.filter((item) => item.ruleId.startsWith("embedding."))
          .map((item) => item.category),
      ),
    ).toEqual(new Set(["contracts"]));
    expect(JSON.stringify(facts)).not.toContain("bytes");
  });

  it("omits findings for dynamic evidence and permits hybrid media queries", async () => {
    const root = await fixtureRoot();
    const file = join(root, "src/index.ts");
    await writeFile(
      file,
      [
        `import { embedding } from '@use-crux/core/embedding'`,
        `import { retriever } from '@use-crux/core/retrieval'`,
        `declare const records: never`,
        `declare const searchStore: never`,
        `declare const dynamicModalities: readonly ['text']`,
        `declare const bytes: Uint8Array`,
        `declare const query: unknown`,
        `const dense = embedding({ kind: 'dense', name: 'dense', dimensions: 3, maxInputTokens: 32, modalities: dynamicModalities, batch: { maxSize: 1 }, embed: async () => [] })`,
        `const sparse = embedding({ kind: 'sparse', name: 'sparse', maxInputTokens: 32, modalities: dynamicModalities, batch: { maxSize: 1 }, embed: async () => [] })`,
        `const search = retriever({ id: 'search', namespace: 'shared', records, search: searchStore, dense, sparse, plan: { dense: true, sparse: true } })`,
        `void dense.embed({ type: 'image', source: bytes, mediaType: 'image/png' } as never)`,
        `void search.retrieve(query as never)`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(patch.facts.lintFindings ?? []).toEqual([]);
  });

  it("does not treat nested document metadata as media evidence", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { embedding } from '@use-crux/core/embedding'`,
        `import { indexer } from '@use-crux/core/indexing'`,
        `declare const records: never`,
        `declare const search: never`,
        `const sparse = embedding({ kind: 'sparse', name: 'sparse', maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `const writer = indexer({ id: 'writer', namespace: 'shared', records, search, sparse })`,
        `void writer.indexDocuments([{ sourceId: 'text', content: 'hello', metadata: { type: 'image', mediaType: 'image/png' } }])`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(patch.facts.lintFindings ?? []).toEqual([]);
  });

  it("retains byte-safe partial evidence for dynamic embedding references", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import type { DenseEmbedding } from '@use-crux/core/embedding'`,
        `import { indexer } from '@use-crux/core/indexing'`,
        `declare const records: never`,
        `declare const search: never`,
        `declare const dynamicEmbedding: DenseEmbedding<'image'>`,
        `const writer = indexer({ id: 'writer', namespace: 'shared', records, search, dense: dynamicEmbedding })`,
        `void dynamicEmbedding.embed('PHASE7_PRIVATE_SENTINEL')`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(patch.facts.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definitionId: "rag.indexer:writer",
          ref: expect.objectContaining({
            property: "dense",
            fidelity: "partial",
          }),
        }),
        expect.objectContaining({
          ref: expect.objectContaining({
            property: "receiver",
            fidelity: "partial",
          }),
        }),
      ]),
    );
    expect(patch.facts.relations ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: expect.stringContaining("dynamicEmbedding"),
        }),
      ]),
    );
    expect(JSON.stringify(patch.facts)).not.toContain(
      "PHASE7_PRIVATE_SENTINEL",
    );
  });

  it("checks sparse per-request overrides on hybrid retrievers", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { embedding } from '@use-crux/core/embedding'`,
        `import { retriever } from '@use-crux/core/retrieval'`,
        `declare const records: never`,
        `declare const searchStore: never`,
        `declare const bytes: Uint8Array`,
        `const dense = embedding({ kind: 'dense', name: 'dense', dimensions: 3, maxInputTokens: 32, modalities: ['text', 'image'], batch: { maxSize: 1 }, embed: async () => [] })`,
        `const sparse = embedding({ kind: 'sparse', name: 'sparse', maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `const search = retriever({ id: 'search', namespace: 'shared', records, search: searchStore, dense, sparse, plan: { dense: true, sparse: true } })`,
        `const image = { type: 'data', mediaType: 'image/png', data: bytes } as const`,
        `void search.retrieve(image, { search: { sparse: true } })`,
        `void search.retrieve({ input: image, search: { sparse: true } })`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(
      patch.facts.lintFindings?.filter(
        (item) => item.ruleId === "embedding.sparse-media",
      ),
    ).toHaveLength(2);
  });

  it("resolves imported and local aliases without widening same-name calls", async () => {
    const root = await fixtureRoot();
    const file = join(root, "src/index.ts");
    await writeFile(
      file,
      [
        `import { embedding as defineEmbedding } from '@use-crux/core/embedding'`,
        `import { indexer as defineIndexer } from '@use-crux/core/indexing'`,
        `declare const records: never`,
        `declare const search: never`,
        `const dense = defineEmbedding({ kind: 'dense', name: 'dense', dimensions: 3, maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `const writer = defineIndexer({ id: 'writer', namespace: 'shared', records, search, dense })`,
        `void dense.embed('query')`,
        `function embedding(config: unknown) { return config }`,
        `void embedding({ kind: 'dense' })`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(
      patch.facts.definitions?.filter((item) => item.kind === "embedding.call"),
    ).toHaveLength(1);
    expect(patch.facts.relations?.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "embedding.call.uses_embedding",
        "rag.indexer.uses_dense_embedding",
      ]),
    );
  });

  it("compares exact provider identities when defaults are statically proven", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { embedding } from '@use-crux/openai'`,
        `import { indexer } from '@use-crux/core/indexing'`,
        `import { retriever } from '@use-crux/core/retrieval'`,
        `declare const client: never`,
        `declare const records: never`,
        `declare const search: never`,
        `const small = embedding(client, { name: 'shared', model: 'text-embedding-3-small' })`,
        `const large = embedding(client, { name: 'shared', model: 'text-embedding-3-large' })`,
        `export const writer = indexer({ id: 'writer', namespace: 'shared', records, search, dense: small })`,
        `export const reader = retriever({ id: 'reader', namespace: 'shared', records, search, dense: large })`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(patch.facts.lintFindings?.map((item) => item.ruleId)).toContain(
      "embedding.namespace-identity-mismatch",
    );
  });

  it("compares exact sparse identities for a shared namespace", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { embedding } from '@use-crux/core/embedding'`,
        `import { indexer } from '@use-crux/core/indexing'`,
        `import { retriever } from '@use-crux/core/retrieval'`,
        `declare const records: never`,
        `declare const search: never`,
        `const first = embedding({ kind: 'sparse', name: 'first', maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `const second = embedding({ kind: 'sparse', name: 'second', maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `export const writer = indexer({ id: 'writer', namespace: 'shared', records, search, sparse: first })`,
        `export const reader = retriever({ id: 'reader', namespace: 'shared', records, search, sparse: second, plan: { sparse: true } })`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(patch.facts.lintFindings?.map((item) => item.ruleId)).toContain(
      "embedding.namespace-identity-mismatch",
    );
  });

  it("projects knowledge-base defaults and checks its indexing and retrieval calls", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { embedding } from '@use-crux/core/embedding'`,
        `import { knowledgeBase } from '@use-crux/core/retrieval'`,
        `declare const records: never`,
        `declare const search: never`,
        `declare const bytes: Uint8Array`,
        `const text = embedding({ kind: 'dense', name: 'text', dimensions: 3, maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `const sparse = embedding({ kind: 'sparse', name: 'sparse', maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `export const kb = knowledgeBase({ id: 'docs', records, search, embeddings: text, sparseEmbeddings: sparse })`,
        `const documents = [{ id: 'dog', parts: [{ type: 'image', asset: { type: 'data', mediaType: 'image/png', data: bytes } }] }]`,
        `export async function run() {`,
        `  await kb.index(documents)`,
        `  await kb.retriever({ search: { sparse: true } }).retrieve({ type: 'data', mediaType: 'image/png', data: bytes } as never)`,
        `}`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(
      patch.facts.definitions?.find(
        (item) => item.id === "rag.knowledgeBase:docs",
      )?.metadata?.facts,
    ).toMatchObject({
      kind: "rag.knowledgeBase",
      knowledgeBaseId: "docs",
      indexerId: "docs",
      namespace: "docs",
    });
    expect(patch.facts.lintFindings?.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining([
        "embedding.unsupported-modality",
        "embedding.sparse-media",
      ]),
    );
  });

  it("infers bare non-media MIME assets as document inputs", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { embedding } from '@use-crux/core/embedding'`,
        `declare const bytes: Uint8Array`,
        `const text = embedding({ kind: 'dense', name: 'text', dimensions: 3, maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] })`,
        `void text.embed({ type: 'data', mediaType: 'text/plain; charset=utf-8', data: bytes } as never)`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    expect(patch.facts.lintFindings?.map((item) => item.ruleId)).toContain(
      "embedding.unsupported-modality",
    );
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-semantic-embedding-"));
  roots.push(root);
  const scope = join(root, "node_modules/@use-crux");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(scope, { recursive: true });
  await symlink(join(process.cwd(), "../core"), join(scope, "core"), "dir");
  await symlink(join(process.cwd(), "../openai"), join(scope, "openai"), "dir");
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  return root;
}
