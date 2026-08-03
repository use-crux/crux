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
      semanticStorageFactoryDescriptor("postgresSearchStore"),
    ).toMatchObject({
      capabilities: {
        search: {
          legs: { dense: true, sparse: false, lexical: false },
          fusion: [],
        },
      },
    });
    expect(
      semanticStorageFactoryDescriptor("postgresSearchStore", true),
    ).toMatchObject({
      capabilities: {
        search: {
          legs: { dense: true, sparse: true, lexical: false },
          fusion: ["rrf"],
        },
      },
    });
    expect(
      semanticStorageFactoryDescriptor("postgresSearchStore", false, true),
    ).toMatchObject({
      capabilities: {
        search: {
          legs: { dense: true, sparse: false, lexical: true },
          fusion: ["rrf"],
        },
      },
    });
    expect(
      semanticStorageFactoryDescriptor("postgresStorage", true),
    ).toMatchObject({
      capabilities: {
        record: { ttl: "lazy", filter: "native", watch: false, batch: true },
        search: {
          legs: { dense: true, sparse: true, lexical: false },
          fusion: ["rrf"],
        },
      },
    });
  });
});
