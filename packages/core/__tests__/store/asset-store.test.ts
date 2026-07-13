import { describe, expect, it } from "vitest";
import { inMemoryAssetStore, StorageError } from "../../src/storage";
import type {
  Asset,
  AssetPutOptions,
  DataAsset,
  ProviderFileAsset,
  UrlAsset,
} from "../../src/storage";

describe("inMemoryAssetStore", () => {
  it("round-trips data assets as usable stored assets with isolated bytes", async () => {
    const store = inMemoryAssetStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const asset: DataAsset = {
      type: "data",
      data: bytes,
      mediaType: "image/png",
      size: 3,
    };

    const stored = await store.put(asset);

    bytes[0] = 99;
    expect(stored.type).toBe("data");
    expectMemoryAssetRef(stored.ref);
    expect(stored.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.isFrozen(stored)).toBe(true);

    stored.data[1] = 88;
    const rehydrated = await store.get(stored.ref);

    expect(rehydrated).toMatchObject({
      type: "data",
      mediaType: "image/png",
      size: 3,
      ref: stored.ref,
    });
    expect(rehydrated.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("records URL and provider-file assets as usable locators", async () => {
    const store = inMemoryAssetStore();
    const urlAsset: UrlAsset = {
      type: "url",
      url: new URL("https://example.com/cat.png"),
      mediaType: "image/png; charset=utf-8",
      width: 640,
      height: 480,
    };
    const providerFile: ProviderFileAsset = {
      type: "provider-file",
      provider: "openai",
      fileId: "file_123",
      mediaType: "application/pdf",
      pageCount: 2,
    };

    const storedUrl = await store.put(urlAsset, { key: "remote/cat.png" });
    const storedProviderFile = await store.put(providerFile);

    expect(storedUrl).toMatchObject({
      type: "url",
      url: new URL("https://example.com/cat.png"),
      mediaType: "image/png",
      width: 640,
      height: 480,
    });
    expectMemoryAssetRef(storedUrl.ref, "/key/remote%2Fcat.png");
    expect(storedProviderFile).toMatchObject({
      type: "provider-file",
      provider: "openai",
      fileId: "file_123",
      mediaType: "application/pdf",
      pageCount: 2,
    });
    expectMemoryAssetRef(storedProviderFile.ref);
    await expect(store.get(storedUrl.ref)).resolves.toMatchObject({
      type: "url",
    });
    await expect(store.get(storedProviderFile.ref)).resolves.toMatchObject({
      type: "provider-file",
    });
  });

  it("rejects invalid asset facts before recording a partial asset", async () => {
    const store = inMemoryAssetStore();
    const invalidAssets: readonly Asset[] = [
      {
        type: "data",
        data: new Uint8Array([1]),
        mediaType: "image/png",
        size: Number.NaN,
      },
      {
        type: "data",
        data: new Uint8Array([1]),
        mediaType: "image/png",
        sha256: "ABC",
      },
      {
        type: "data",
        data: new Uint8Array([1]),
        mediaType: "image/png",
        width: 0,
      },
      {
        type: "data",
        data: new Uint8Array([1]),
        mediaType: "image/png",
        durationInSeconds: -1,
      },
      {
        type: "provider-file",
        provider: " ",
        fileId: "file_123",
      },
    ];

    for (const asset of invalidAssets) {
      await expect(store.put(asset)).rejects.toMatchObject({
        name: "StorageError",
        code: "invalid_value",
      });
    }
    await expect(
      store.put({
        type: "url",
        url: new URL("http://example.com/insecure.png"),
        mediaType: "image/png",
      }),
    ).rejects.toMatchObject({ name: "StorageError", code: "invalid_value" });
    await expect(
      store.put({
        type: "stream",
        data: new Uint8Array([1]),
        mediaType: "image/png",
      } as unknown as Asset),
    ).rejects.toMatchObject({ name: "StorageError", code: "invalid_value" });
    await expect(
      store.put(
        {
          type: "data",
          data: new Uint8Array([1]),
          mediaType: "image/png",
        },
        {
          metadata: {
            nested: { ok: true },
          } as unknown as AssetPutOptions["metadata"],
        },
      ),
    ).rejects.toMatchObject({ name: "StorageError", code: "invalid_filter" });

    const stored = await store.put({
      type: "data",
      data: new Uint8Array([2]),
      mediaType: "image/png",
    });

    expectMemoryAssetRef(stored.ref);
    await expect(
      store.get({ uri: `${stored.ref.uri}-missing` }),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "not_found",
    });
  });

  it("rejects Blob type and asset mediaType conflicts", async () => {
    const store = inMemoryAssetStore();

    await expect(
      store.put({
        type: "data",
        data: new Blob(["pdf"], { type: "application/pdf" }),
        mediaType: "image/png",
      }),
    ).rejects.toMatchObject({ name: "StorageError", code: "invalid_value" });

    const stored = await store.put({
      type: "data",
      data: new Blob(["png"], { type: "image/png; charset=utf-8" }),
      mediaType: "image/png",
    });

    expectMemoryAssetRef(stored.ref);
  });

  it("deletes stored assets and reports unknown refs through StorageError", async () => {
    const store = inMemoryAssetStore();
    const stored = await store.put({
      type: "data",
      data: new Uint8Array([1]),
      mediaType: "image/png",
    });

    await store.delete(stored.ref);

    await expect(store.get(stored.ref)).rejects.toBeInstanceOf(StorageError);
    await expect(store.get(stored.ref)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("strips GeneratedImage-shaped convenience fields from stored projections", async () => {
    const store = inMemoryAssetStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const generatedImage = {
      type: "data",
      data: bytes,
      uint8Array: bytes,
      base64: "AQID",
      mediaType: "image/png",
      size: 3,
    } satisfies DataAsset & {
      readonly uint8Array: Uint8Array;
      readonly base64: string;
    };

    const stored = await store.put(generatedImage);
    const rehydrated = await store.get(stored.ref);

    expect("base64" in stored).toBe(false);
    expect("uint8Array" in stored).toBe(false);
    expect("base64" in rehydrated).toBe(false);
    expect("uint8Array" in rehydrated).toBe(false);
  });
});

function expectMemoryAssetRef(
  ref: { readonly uri: string },
  suffix?: string,
): void {
  expect(ref.uri).toMatch(
    /^memory:\/\/asset\/[^/]+\/(?:generated\/\d+|key\/[^/]+)$/,
  );
  if (suffix) expect(ref.uri.endsWith(suffix)).toBe(true);
}
