import { describe, expect, it } from "vitest";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  storage,
} from "../../src/storage";
import type { AssetPutOptions, AssetRef, AssetStore } from "../../src/storage";

describe("storage.scope asset namespacing", () => {
  it("prefixes put keys while preserving underlying bearer refs", async () => {
    const base = recordingAssetStore();
    const scoped = storage.scope(
      storage({
        records: inMemoryRecordStore(),
        assets: base.store,
      }),
      "tenant",
    );

    const stored = await scoped.assets?.put(
      {
        type: "data",
        data: new Uint8Array([1]),
        mediaType: "image/png",
      },
      { key: "photo.png" },
    );

    if (!stored) throw new Error("Expected scoped asset put to return a ref.");
    expect(base.putOptions).toEqual([{ key: "tenant:photo.png" }]);
    expect(stored.ref).toEqual(base.putRefs[0]);
    await expect(scoped.assets?.get(stored.ref)).resolves.toMatchObject({
      ref: stored.ref,
    });
    expect(base.getRefs).toEqual([stored.ref]);
  });
});

function recordingAssetStore(): Readonly<{
  store: AssetStore;
  putOptions: readonly AssetPutOptions[];
  putRefs: readonly AssetRef[];
  getRefs: readonly AssetRef[];
}> {
  const inner = inMemoryAssetStore();
  const putOptions: AssetPutOptions[] = [];
  const putRefs: AssetRef[] = [];
  const getRefs: AssetRef[] = [];
  const store: AssetStore = Object.freeze({
    put: async (asset, options) => {
      if (options) putOptions.push(options);
      const stored = await inner.put(asset, options);
      putRefs.push(stored.ref);
      return stored;
    },
    get: (ref) => {
      getRefs.push(ref);
      return inner.get(ref);
    },
    delete: inner.delete,
  });
  return Object.freeze({ store, putOptions, putRefs, getRefs });
}
