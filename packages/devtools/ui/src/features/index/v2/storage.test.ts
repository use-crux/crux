import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { kindMeta } from "./kit";
import { storageInventoryForIndex, storageWarningsForDef } from "./storage";

describe("index storage view model", () => {
  const index = {
    prompts: [],
    contexts: [],
    tools: [],
    definitions: [
      {
        id: "storage.recordStore:records",
        kind: "storage.recordStore",
        name: "records",
        fidelity: "resolved",
        status: "active",
        metadata: {
          facts: {
            kind: "storage.recordStore",
            backend: "inMemoryRecordStore",
            capabilities: {
              record: {
                ttl: "lazy",
                filter: "scan",
                watch: true,
                batch: false,
              },
            },
          },
          storage: {
            kind: "storage.recordStore",
            backend: "inMemoryRecordStore",
            capabilities: {
              record: {
                ttl: "lazy",
                filter: "scan",
                watch: true,
                batch: false,
              },
            },
          },
        },
      },
      {
        id: "storage.vectorStore:vectors",
        kind: "storage.vectorStore",
        name: "vectors",
        fidelity: "resolved",
        status: "active",
        metadata: {
          facts: {
            kind: "storage.vectorStore",
            backend: "convexVectorStore",
            capabilities: {
              vector: {
                dense: true,
                sparse: false,
                hybrid: false,
                fusion: [],
                filter: "post",
              },
            },
          },
        },
      },
      {
        id: "storage.bundle:appStorage",
        kind: "storage.bundle",
        name: "appStorage",
        fidelity: "resolved",
        status: "active",
        metadata: {
          facts: {
            kind: "storage.bundle",
            records: "records",
            vectors: "vectors",
          },
          storage: {
            kind: "storage.bundle",
            components: {
              recordStoreId: "storage.recordStore:records",
              vectorStoreId: "storage.vectorStore:vectors",
            },
            capabilities: {
              record: {
                ttl: "lazy",
                filter: "scan",
                watch: true,
                batch: false,
              },
              vector: {
                dense: true,
                sparse: false,
                hybrid: false,
                fusion: [],
                filter: "post",
              },
              asset: { multipart: false, signedUrls: false },
            },
            usedBy: [
              {
                definitionId: "rag.retriever:docs",
                kind: "rag.retriever",
                name: "docs",
                relationType: "rag.retriever.uses_storage",
              },
            ],
            warnings: [
              {
                code: "storage.vector_filter_not_prefiltered",
                severity: "warning",
                message:
                  "Retriever is wired to a vector store that filters after search.",
                primaryDefinitionId: "storage.bundle:appStorage",
                relatedDefinitionIds: [
                  "rag.retriever:docs",
                  "storage.vectorStore:vectors",
                ],
              },
            ],
          },
        },
      },
      {
        id: "rag.retriever:docs",
        kind: "rag.retriever",
        name: "docs",
        fidelity: "resolved",
        status: "active",
        metadata: {
          facts: { kind: "rag.retriever" },
          intelligence: {
            confidence: "static",
            dependencies: {
              storage: ["appStorage"],
              vectorStores: ["vectors"],
            },
          },
        },
      },
    ],
    relations: [
      {
        id: "rel:records",
        type: "storage.bundle.uses_record_store",
        from: "storage.bundle:appStorage",
        to: "storage.recordStore:records",
        fidelity: "resolved",
      },
      {
        id: "rel:vectors",
        type: "storage.bundle.uses_vector_store",
        from: "storage.bundle:appStorage",
        to: "storage.vectorStore:vectors",
        fidelity: "resolved",
      },
      {
        id: "rel:retriever",
        type: "rag.retriever.uses_storage",
        from: "rag.retriever:docs",
        to: "storage.bundle:appStorage",
        fidelity: "resolved",
      },
    ],
    diagnostics: [],
    lintFindings: [],
    sources: [],
  } satisfies ProjectIndexData;

  it("registers storage definitions in the state family", () => {
    expect(kindMeta("storage.bundle")).toMatchObject({
      label: "Storage bundle",
      family: "state",
    });
    expect(kindMeta("storage.vectorStore")).toMatchObject({
      label: "Vector store",
      family: "state",
    });
  });

  it("builds storage inventory with capabilities, relations, and warnings", () => {
    const idx = buildIndex(index);
    const inventory = storageInventoryForIndex(idx);
    expect(inventory.map((item) => item.id)).toEqual([
      "storage.recordStore:records",
      "storage.vectorStore:vectors",
      "storage.bundle:appStorage",
    ]);
    const bundle = inventory.find(
      (item) => item.id === "storage.bundle:appStorage",
    );
    expect(bundle?.components.vectorStoreId).toBe(
      "storage.vectorStore:vectors",
    );
    expect(bundle?.capabilities?.vector?.filter).toBe("post");
    expect(bundle?.capabilities).not.toHaveProperty("asset");
    expect(bundle?.usedBy.map((use) => use.definitionId)).toEqual([
      "rag.retriever:docs",
    ]);
    expect(
      storageWarningsForDef(idx.byId("storage.bundle:appStorage")!),
    ).toEqual([
      expect.objectContaining({
        code: "storage.vector_filter_not_prefiltered",
      }),
    ]);
  });
});
