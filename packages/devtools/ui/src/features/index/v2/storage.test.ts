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
        id: "storage.searchStore:search",
        kind: "storage.searchStore",
        name: "search",
        fidelity: "resolved",
        status: "active",
        metadata: {
          facts: {
            kind: "storage.searchStore",
            backend: "convexSearchStore",
            capabilities: {
              search: {
                legs: { dense: true, sparse: false, lexical: false },
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
            search: "search",
          },
          storage: {
            kind: "storage.bundle",
            components: {
              recordStoreId: "storage.recordStore:records",
              searchStoreId: "storage.searchStore:search",
            },
            capabilities: {
              record: {
                ttl: "lazy",
                filter: "scan",
                watch: true,
                batch: false,
              },
              search: {
                legs: { dense: true, sparse: false, lexical: false },
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
                code: "storage.search_filter_not_prefiltered",
                severity: "warning",
                message:
                  "Retriever is wired to a search store that filters after search.",
                primaryDefinitionId: "storage.bundle:appStorage",
                relatedDefinitionIds: [
                  "rag.retriever:docs",
                  "storage.searchStore:search",
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
              searchStores: ["search"],
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
        id: "rel:search",
        type: "storage.bundle.uses_search_store",
        from: "storage.bundle:appStorage",
        to: "storage.searchStore:search",
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
    expect(kindMeta("storage.searchStore")).toMatchObject({
      label: "Search store",
      family: "state",
    });
  });

  it("builds storage inventory with capabilities, relations, and warnings", () => {
    const idx = buildIndex(index);
    const inventory = storageInventoryForIndex(idx);
    expect(inventory.map((item) => item.id)).toEqual([
      "storage.recordStore:records",
      "storage.searchStore:search",
      "storage.bundle:appStorage",
    ]);
    const bundle = inventory.find(
      (item) => item.id === "storage.bundle:appStorage",
    );
    expect(bundle?.components.searchStoreId).toBe(
      "storage.searchStore:search",
    );
    expect(bundle?.capabilities?.search?.filter).toBe("post");
    expect(bundle?.capabilities).not.toHaveProperty("asset");
    expect(bundle?.usedBy.map((use) => use.definitionId)).toEqual([
      "rag.retriever:docs",
    ]);
    expect(
      storageWarningsForDef(idx.byId("storage.bundle:appStorage")!),
    ).toEqual([
      expect.objectContaining({
        code: "storage.search_filter_not_prefiltered",
      }),
    ]);
  });
});
