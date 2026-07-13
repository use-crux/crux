import { afterEach, describe, expect, it, vi } from "vitest";
import { inMemoryAssetStore } from "../../src/storage";

describe("inMemoryAssetStore ref ownership", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not hydrate refs created by another in-memory store", async () => {
    const first = inMemoryAssetStore();
    const second = inMemoryAssetStore();

    const firstGenerated = await first.put({
      type: "data",
      data: new Uint8Array([1]),
      mediaType: "image/png",
    });
    const secondGenerated = await second.put({
      type: "data",
      data: new Uint8Array([2]),
      mediaType: "image/png",
    });
    const firstKeyed = await first.put(
      {
        type: "data",
        data: new Uint8Array([3]),
        mediaType: "image/png",
      },
      { key: "shared-key" },
    );
    const secondKeyed = await second.put(
      {
        type: "data",
        data: new Uint8Array([4]),
        mediaType: "image/png",
      },
      { key: "shared-key" },
    );

    expect(firstGenerated.ref.uri).not.toBe(secondGenerated.ref.uri);
    expect(firstKeyed.ref.uri).not.toBe(secondKeyed.ref.uri);

    const wrongStoreError = await captureError(() =>
      second.get(firstGenerated.ref),
    );
    expect(wrongStoreError).toMatchObject({
      name: "StorageError",
      code: "not_found",
    });
    expect(
      wrongStoreError instanceof Error ? wrongStoreError.message : "",
    ).not.toContain(firstGenerated.ref.uri);

    await expect(second.get(firstKeyed.ref)).rejects.toMatchObject({
      name: "StorageError",
      code: "not_found",
    });
  });

  it("keeps refs store-scoped without crypto.randomUUID", async () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(1);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const first = inMemoryAssetStore();
    const second = inMemoryAssetStore();

    const firstGenerated = await first.put({
      type: "data",
      data: new Uint8Array([1]),
      mediaType: "image/png",
    });
    const secondGenerated = await second.put({
      type: "data",
      data: new Uint8Array([2]),
      mediaType: "image/png",
    });
    const firstKeyed = await first.put(
      {
        type: "data",
        data: new Uint8Array([3]),
        mediaType: "image/png",
      },
      { key: "shared-key" },
    );
    const secondKeyed = await second.put(
      {
        type: "data",
        data: new Uint8Array([4]),
        mediaType: "image/png",
      },
      { key: "shared-key" },
    );

    expect(firstGenerated.ref.uri).not.toBe(secondGenerated.ref.uri);
    expect(firstKeyed.ref.uri).not.toBe(secondKeyed.ref.uri);
    await expect(second.get(firstGenerated.ref)).rejects.toMatchObject({
      name: "StorageError",
      code: "not_found",
    });
    await expect(second.get(firstKeyed.ref)).rejects.toMatchObject({
      name: "StorageError",
      code: "not_found",
    });
  });
});

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
    return undefined;
  } catch (error) {
    return error;
  }
}
