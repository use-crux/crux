import { afterEach, describe, expect, it } from "vitest";
import { corpus, indexer } from "../../src/indexing";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { inMemoryRecordStore, inMemoryVectorStore } from "../../src/storage";

describe("indexing result correlation", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("correlates an indexDocuments summary with its exact indexing.pipeline span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const docs = indexer({
      id: "docs",
      namespace: "kb",
      records: inMemoryRecordStore(),
      vectors: inMemoryVectorStore(),
    });

    const result = await docs.indexDocuments([
      { namespace: "kb", sourceId: "intro", content: "Hello indexing." },
    ]);
    await observe.flush();
    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "indexing.pipeline" &&
        record.attributes.operation === "indexDocuments",
    );

    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it("correlates an indexDocuments dry-run summary with its exact span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const docs = indexer({
      id: "docs",
      namespace: "kb",
      records: inMemoryRecordStore(),
      vectors: inMemoryVectorStore(),
    });

    const result = await docs.indexDocuments(
      [{ namespace: "kb", sourceId: "intro", content: "Hello dry run." }],
      { dryRun: true },
    );
    await observe.flush();
    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "indexing.pipeline" &&
        record.attributes.operation === "indexDocuments",
    );

    expect(result.dryRun).toBe(true);
    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it.each([false, true] as const)(
    "correlates an indexChunks summary when dryRun is %s",
    async (dryRun) => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport);
      const docs = indexer({
        id: "docs",
        namespace: "kb",
        records: inMemoryRecordStore(),
        vectors: inMemoryVectorStore(),
      });
      const chunk = {
        namespace: "kb",
        sourceId: "intro",
        chunkId: "intro-1",
        ordinal: 0,
        content: "An existing chunk.",
        metadata: {},
      };

      const result = dryRun
        ? await docs.indexChunks([chunk], { dryRun: true })
        : await docs.indexChunks([chunk]);
      await observe.flush();
      const span = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "indexing.pipeline" &&
          record.attributes.operation === "indexChunks",
      );

      expect(result._meta).toEqual({
        traceId: span?.traceId,
        spanId: span?.spanId,
      });
    },
  );

  it("correlates only the corpus sync summary and leaves progress and source records unchanged", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const records = inMemoryRecordStore();
    const vectors = inMemoryVectorStore();
    const docsIndexer = indexer({
      id: "docs",
      namespace: "kb",
      records,
      vectors,
    });
    const progress: object[] = [];
    const docs = corpus({
      id: "docs",
      namespace: "kb",
      records,
      indexer: docsIndexer,
    });
    const parserResult = {
      ok: true as const,
      document: {
        namespace: "kb",
        sourceId: "intro",
        content: "Hello corpus.",
      },
    };

    const result = await docs.sync([parserResult], {
      onProgress: (event) => progress.push(event),
    });
    const source = await docs.getSource("intro");
    await observe.flush();
    const span = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "corpus.sync",
    );

    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
    expect(result.sources.every((item) => !("_meta" in item))).toBe(true);
    expect(progress.every((item) => !("_meta" in item))).toBe(true);
    expect(source && "_meta" in source).toBe(false);
    expect("_meta" in parserResult).toBe(false);
  });

  it("leaves chunk arrays and numeric delete and clear results unchanged", async () => {
    const docs = indexer({
      id: "docs",
      namespace: "kb",
      records: inMemoryRecordStore(),
      vectors: inMemoryVectorStore(),
    });

    const chunks = await docs.chunk([
      { namespace: "kb", sourceId: "intro", content: "Hello indexing." },
    ]);
    const deleted = await docs.deleteSource("intro");
    const cleared = await docs.clear();

    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.every((chunk) => !("_meta" in chunk))).toBe(true);
    expect(typeof deleted).toBe("number");
    expect(typeof cleared).toBe("number");
  });
});
