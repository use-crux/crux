import { describe, expect, it, vi } from "vitest";
import { EmbeddingSpaceMismatchError, embedding } from "../../src/embedding";
import { indexedEmbeddingSpaceKey } from "../../src/indexed-knowledge";
import { indexer } from "../../src/indexing";
import { retriever } from "../../src/retrieval";
import { inMemoryRecordStore, inMemoryVectorStore } from "../../src/storage";

describe("namespace embedding-space guard", () => {
  it("retains the guard for surviving writers and names them in mismatch errors", async () => {
    const records = inMemoryRecordStore();
    const vectors = inMemoryVectorStore();
    const firstSpace = textEmbedding("first-space", 2);
    const a = indexer({
      id: "a",
      namespace: "shared",
      records,
      vectors,
      dense: firstSpace,
    });
    const b = indexer({
      id: "b",
      namespace: "shared",
      records,
      vectors,
      dense: firstSpace,
    });

    await a.indexDocuments([document("a-source")]);
    await b.indexDocuments([document("b-source")]);
    await a.clear();

    await expect(
      records.get(indexedEmbeddingSpaceKey("shared")),
    ).resolves.toMatchObject({
      writers: ["b"],
    });
    await expect(
      retriever({
        id: "b",
        namespace: "shared",
        records,
        vectors,
        dense: firstSpace,
      }).retrieve("query"),
    ).resolves.toHaveLength(1);

    const cProvider = vi.fn(async () => [[1, 0, 0]]);
    const c = indexer({
      id: "c",
      namespace: "shared",
      records,
      vectors,
      dense: textEmbedding("second-space", 3, cProvider),
    });
    const rejected = c.indexDocuments([document("c-source")]);

    await expect(rejected).rejects.toBeInstanceOf(EmbeddingSpaceMismatchError);
    await expect(rejected).rejects.toThrow(
      /written by indexer\(s\) "b"; clear them or index into a new namespace/,
    );
    expect(cProvider).not.toHaveBeenCalled();
    await expect(
      records.list("indexer:c:namespace:shared:source:"),
    ).resolves.toMatchObject({ entries: [] });
  });

  it("deletes the guard with the last writer so another space can claim it", async () => {
    const records = inMemoryRecordStore();
    const vectors = inMemoryVectorStore();
    const firstSpace = textEmbedding("first-space", 2);
    const a = indexer({
      id: "a",
      namespace: "shared",
      records,
      vectors,
      dense: firstSpace,
    });
    const b = indexer({
      id: "b",
      namespace: "shared",
      records,
      vectors,
      dense: firstSpace,
    });

    await a.indexDocuments([document("a-source")]);
    await b.indexDocuments([document("b-source")]);
    await a.clear();
    await b.clear();

    await expect(
      records.get(indexedEmbeddingSpaceKey("shared")),
    ).resolves.toBeNull();
    const c = indexer({
      id: "c",
      namespace: "shared",
      records,
      vectors,
      dense: textEmbedding("second-space", 3),
    });
    await expect(
      c.indexDocuments([document("c-source")]),
    ).resolves.toMatchObject({ chunkCount: 1 });
    await expect(
      records.get(indexedEmbeddingSpaceKey("shared")),
    ).resolves.toMatchObject({
      name: "second-space",
      writers: ["c"],
    });
  });

  it("does not register a same-space writer whose vector write fails", async () => {
    const records = inMemoryRecordStore();
    const vectors = inMemoryVectorStore();
    const firstSpace = textEmbedding("first-space", 2);
    const a = indexer({
      id: "a",
      namespace: "shared",
      records,
      vectors,
      dense: firstSpace,
    });
    const b = indexer({
      id: "b",
      namespace: "shared",
      records,
      vectors,
      dense: firstSpace,
    });

    await a.indexDocuments([document("a-source")]);
    vi.spyOn(vectors, "upsert").mockRejectedValueOnce(
      new Error("vector write failed"),
    );
    await expect(b.indexDocuments([document("b-source")])).rejects.toThrow(
      "vector write failed",
    );
    await expect(
      records.get(indexedEmbeddingSpaceKey("shared")),
    ).resolves.toMatchObject({
      writers: ["a"],
    });

    await a.clear();
    const c = indexer({
      id: "c",
      namespace: "shared",
      records,
      vectors,
      dense: textEmbedding("second-space", 3),
    });
    await expect(
      c.indexDocuments([document("c-source")]),
    ).resolves.toMatchObject({ chunkCount: 1 });
  });

  it("preserves the single-indexer clear and reindex experience", async () => {
    const records = inMemoryRecordStore();
    const vectors = inMemoryVectorStore();
    const first = indexer({
      id: "docs",
      namespace: "docs",
      records,
      vectors,
      dense: textEmbedding("first-space", 2),
    });

    await first.indexDocuments([document("first-source", "docs")]);
    await first.clear();
    await expect(
      records.get(indexedEmbeddingSpaceKey("docs")),
    ).resolves.toBeNull();

    const second = indexer({
      id: "docs",
      namespace: "docs",
      records,
      vectors,
      dense: textEmbedding("second-space", 3),
    });
    await expect(
      second.indexDocuments([document("second-source", "docs")]),
    ).resolves.toMatchObject({ chunkCount: 1 });
  });

  it("rejects mixed legacy hits when premature guard deletion permits another claim", async () => {
    const records = inMemoryRecordStore();
    const vectors = inMemoryVectorStore();
    const firstSpace = textEmbedding("first-space", 2);
    await indexer({
      id: "b",
      namespace: "shared",
      records,
      vectors,
      dense: firstSpace,
    }).indexDocuments([document("b-source")]);

    await records.delete(indexedEmbeddingSpaceKey("shared"));
    const secondSpace = textEmbedding("second-space", 3);
    await indexer({
      id: "c",
      namespace: "shared",
      records,
      vectors,
      dense: secondSpace,
    }).indexDocuments([document("c-source")]);

    const search = retriever({
      id: "c",
      namespace: "shared",
      records,
      vectors,
      dense: secondSpace,
    });
    await expect(search.retrieve("query")).rejects.toBeInstanceOf(
      EmbeddingSpaceMismatchError,
    );
  });
});

function document(sourceId: string, namespace = "shared") {
  return { namespace, sourceId, content: sourceId };
}

function textEmbedding(
  name: string,
  dimensions: number,
  provider = vi.fn(async () => [Array(dimensions).fill(0)]),
) {
  return embedding({
    kind: "dense",
    name,
    dimensions,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: provider,
  });
}
