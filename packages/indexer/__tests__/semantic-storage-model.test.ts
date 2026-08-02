import { describe, expect, it } from "vitest";
import { semanticStorageFactoryDescriptor } from "../src/indexer/semantic/storage-model";

describe("compiler-owned PostgreSQL storage descriptors", () => {
  it("projects literal sparse configuration and keeps dynamic configuration conservative", () => {
    expect(
      semanticStorageFactoryDescriptor("postgresRecordStore"),
    ).toMatchObject({
      kind: "storage.recordStore",
      backend: "postgresRecordStore",
      capabilities: {
        record: { ttl: "lazy", filter: "native", watch: false, batch: true },
      },
    });
    expect(
      semanticStorageFactoryDescriptor("postgresVectorStore"),
    ).toMatchObject({
      capabilities: {
        vector: { dense: true, sparse: false, hybrid: false, fusion: [] },
      },
    });
    expect(
      semanticStorageFactoryDescriptor("postgresVectorStore", true),
    ).toMatchObject({
      capabilities: {
        vector: { dense: true, sparse: true, hybrid: true, fusion: ["rrf"] },
      },
    });
    expect(
      semanticStorageFactoryDescriptor("postgresStorage", true),
    ).toMatchObject({
      capabilities: {
        record: { ttl: "lazy", filter: "native", watch: false, batch: true },
        vector: { dense: true, sparse: true, hybrid: true, fusion: ["rrf"] },
      },
    });
  });
});
