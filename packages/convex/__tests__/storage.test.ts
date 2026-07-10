import {
  describeAssetStoreConformance,
  describeRecordStoreConformance,
  vectorStoreConformanceSuite,
} from "@use-crux/core/storage/testing/vitest";
import { workspace } from "@use-crux/core/workspace";
import { describe, expect, it } from "vitest";
import { convexAssetStore, convexRecordStore, convexVectorStore } from "../src";
import { createInMemoryConvexStoreDocumentComponent } from "../src/store-document-component";
import type {
  StoreDocDenseSearchQuery,
  StoreDocRecord,
} from "../src/store-doc";

describeRecordStoreConformance({
  name: "convexRecordStore",
  prepare: () => {
    const component = createInMemoryConvexStoreDocumentComponent();
    return convexRecordStore({ component, ctx: component.ctx });
  },
});

describe("convexRecordStore workspace transactions", () => {
  it("supports staged multi-file workspace commits through the generic RecordStore contract", async () => {
    const component = createInMemoryConvexStoreDocumentComponent();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: convexRecordStore({ component, ctx: component.ctx }),
    });

    await ws.transaction(async (tx) => {
      await tx.write("/outputs/report.md", "# Report");
      await tx.write("/outputs/data.csv", "name,value\nalpha,1\n");
    });

    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      kind: "text",
      content: "# Report",
    });
    await expect(ws.read("/outputs/data.csv")).resolves.toMatchObject({
      kind: "text",
      content: "name,value\nalpha,1\n",
    });
  });

  it("supports asset-backed workspace files with Convex storage helpers", async () => {
    const component = createInMemoryConvexStoreDocumentComponent();
    const assets = new Map<string, Blob>();
    let counter = 0;
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: {
        records: convexRecordStore({ component, ctx: component.ctx }),
        assets: convexAssetStore({
          ctx: {
            storage: {
              async store(blob) {
                counter += 1;
                const id = `asset-${counter}`;
                assets.set(id, blob);
                return id;
              },
              async get(id) {
                return assets.get(id) ?? null;
              },
              async delete(id) {
                assets.delete(id);
              },
            },
          },
        }),
      },
    });

    await ws.transaction(async (tx) => {
      await tx.write("/outputs/report.bin", new Uint8Array([1, 2, 3]), {
        mimeType: "application/octet-stream",
      });
    });

    const file = await ws.read("/outputs/report.bin");
    expect(file).toMatchObject({
      kind: "binary",
      size: 3,
    });
    if (file.kind !== "binary") throw new Error("expected binary file");
    expect(assets.has(file.uri.slice("convex://".length))).toBe(true);
  });
});

vectorStoreConformanceSuite({
  name: "convexVectorStore",
  create: () => {
    const component = createInMemoryConvexStoreDocumentComponent({
      denseSearch: searchDenseDocs,
    });
    return {
      records: convexRecordStore({ component, ctx: component.ctx }),
      vectors: convexVectorStore({ component, ctx: component.ctx }),
      cleanup: async () => {},
    };
  },
  capabilities: { sparse: false, hybrid: false, delete: true },
});

describeAssetStoreConformance({
  name: "convexAssetStore",
  prepare: () => {
    const assets = new Map<string, Blob>();
    let counter = 0;
    return convexAssetStore({
      ctx: {
        storage: {
          async store(blob) {
            counter += 1;
            const id = `asset-${counter}`;
            assets.set(id, blob);
            return id;
          },
          async get(id) {
            return assets.get(id) ?? null;
          },
          async delete(id) {
            assets.delete(id);
          },
        },
      },
    });
  },
});

function searchDenseDocs(
  query: StoreDocDenseSearchQuery,
  docs: readonly StoreDocRecord[],
): readonly StoreDocRecord[] {
  return docs
    .filter((doc) => matchesQueryFilter(doc, query))
    .flatMap((doc) => {
      const embedding = Array.isArray(doc.embedding)
        ? doc.embedding.filter(isNumber)
        : [];
      const score = cosineSimilarity(query.vector, embedding);
      return score > 0 ? [{ ...doc, _score: score }] : [];
    })
    .sort((left, right) => Number(right._score) - Number(left._score))
    .slice(0, query.limit);
}

function matchesQueryFilter(
  doc: StoreDocRecord,
  query: StoreDocDenseSearchQuery,
): boolean {
  if (!query.filter) return true;
  if (typeof doc.content !== "string") return false;
  const value = JSON.parse(doc.content) as Record<string, unknown>;
  return Object.entries(query.filter).every(
    ([key, expected]) => value[key] === expected,
  );
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * (right[index] ?? 0);
    leftNorm += left[index] * left[index];
    rightNorm += (right[index] ?? 0) * (right[index] ?? 0);
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? 0 : dot / denominator;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
