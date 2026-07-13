import { describe, expect, it } from "vitest";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  storage,
} from "../../src/storage";
import type { AssetStore, StoredAsset } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace read round-trips", () => {
  it("reads asset-backed text as text content", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        assets: inMemoryAssetStore(),
      }),
      content: { inlineTextBelowBytes: 10 },
    });
    const content = "x".repeat(100);

    await ws.write("/workspace/big.md", content, { mimeType: "text/markdown" });
    const result = await ws.read("/workspace/big.md");

    expect(result).toMatchObject({
      kind: "text",
      path: "/workspace/big.md",
      mimeType: "text/markdown",
      content,
      size: 100,
    });
  });

  it("reads asset-backed JSON as parsed JSON content", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        assets: inMemoryAssetStore(),
      }),
      content: { inlineTextBelowBytes: 10 },
    });
    const content = {
      title: "Large JSON",
      sections: Array.from({ length: 12 }, (_, index) => ({
        index,
        text: `section ${index}`,
      })),
    };

    await ws.write("/workspace/big.json", content);
    const result = await ws.read("/workspace/big.json");

    expect(result).toMatchObject({
      kind: "json",
      path: "/workspace/big.json",
      mimeType: "application/json",
      content,
    });
  });

  it("windows inline text that exceeds maxInlineBytes instead of throwing", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const content = "abcdefghijklmnopqrstuvwxyzabc";

    await ws.write("/workspace/inline.txt", content);
    const result = await ws.read("/workspace/inline.txt", {
      maxInlineBytes: 5,
    });

    expect(result).toMatchObject({
      kind: "text",
      path: "/workspace/inline.txt",
      truncated: true,
      size: 29,
    });
    if (result.kind !== "text")
      throw new Error(`Expected text, received ${result.kind}.`);
    expect(
      new TextEncoder().encode(result.content).byteLength,
    ).toBeLessThanOrEqual(5);
  });

  it("reads a text window from the requested byte offset", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const content = "0123456789".repeat(10);

    await ws.write("/workspace/window.txt", content);
    const result = await ws.read("/workspace/window.txt", {
      maxInlineBytes: 10,
      offset: 90,
    });

    expect(result).toMatchObject({
      kind: "text",
      content: "0123456789",
      truncated: true,
      offset: 90,
      size: 100,
    });
  });

  it("reports the actual UTF-8 boundary used for offset windows", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/unicode.txt", "aébc");
    const result = await ws.read("/workspace/unicode.txt", {
      maxInlineBytes: 3,
      offset: 2,
    });

    expect(result).toMatchObject({
      kind: "text",
      content: "éb",
      offset: 1,
      truncated: true,
    });
  });

  it("rejects unbounded stream writes before AssetStore.put()", async () => {
    const assets = recordingAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        assets: assets.store,
      }),
    });

    await expect(
      ws.write(
        "/outputs/stream.bin",
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
        { mimeType: "application/octet-stream" },
      ),
    ).rejects.toThrow(/limits\.maxFileBytes/i);
    expect(assets.putCalls).toBe(0);
  });

  it("stores bounded streams through AssetStore and hydrates DataAsset reads", async () => {
    const assets = inMemoryAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        assets,
      }),
      limits: { maxFileBytes: 8 },
    });

    await ws.write(
      "/outputs/stream.bin",
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      }),
      { mimeType: "application/octet-stream" },
    );

    await expect(ws.read("/outputs/stream.bin")).resolves.toMatchObject({
      kind: "binary",
      path: "/outputs/stream.bin",
      mimeType: "application/octet-stream",
      size: 3,
    });
  });

  it("rejects workspace hydration from URL or provider-file AssetStore results", async () => {
    const assets = urlHydratingAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        assets,
      }),
      content: { inlineTextBelowBytes: 2 },
    });

    await ws.write("/workspace/big.txt", "large text");

    await expect(ws.read("/workspace/big.txt")).rejects.toThrow(
      /requires a data asset/i,
    );
  });
});

function recordingAssetStore(): {
  readonly store: AssetStore;
  readonly putCalls: number;
} {
  const inner = inMemoryAssetStore();
  let putCalls = 0;
  return {
    get putCalls() {
      return putCalls;
    },
    store: Object.freeze({
      put: async (asset, options) => {
        putCalls += 1;
        return inner.put(asset, options);
      },
      get: inner.get,
      delete: inner.delete,
    }),
  };
}

function urlHydratingAssetStore(): AssetStore {
  let stored: StoredAsset | undefined;
  return Object.freeze({
    put: async (asset, options) => {
      stored = await inMemoryAssetStore().put(asset, options);
      return stored;
    },
    get: async (ref) => ({
      type: "url",
      url: new URL("https://example.com/private-download"),
      mediaType: stored?.mediaType,
      size: stored?.size,
      ref,
    }),
    delete: async () => undefined,
  });
}
