import {
  describeAssetStoreConformance,
  describeRecordStoreConformance,
} from "@use-crux/core/storage/testing/vitest";
import { workspace } from "@use-crux/core/workspace";
import { describe, expect, it } from "vitest";
import { convexAssetStore, convexRecordStore } from "../src";
import { createInMemoryConvexStoreDocumentComponent } from "../src/store-document-component";

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
