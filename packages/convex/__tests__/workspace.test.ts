import { describe, expect, it, vi } from "vitest";
import { convexAssetStore } from "../src/workspace";

describe("convexAssetStore", () => {
  it("stores and reads data assets through ctx.storage", async () => {
    const stored = new Map<string, Blob>();
    const storage = {
      store: vi.fn(async (blob: Blob) => {
        stored.set("asset-1", blob);
        return "asset-1";
      }),
      get: vi.fn(async (id: string) => stored.get(id) ?? null),
      delete: vi.fn(async (id: string) => {
        stored.delete(id);
      }),
    };

    const assets = convexAssetStore({ ctx: { storage } });
    const asset = await assets.put(
      {
        type: "data",
        data: new Uint8Array([1, 2, 3]),
        mediaType: "application/pdf",
        size: 3,
      },
      {
        key: "research/thread:1/outputs/report.pdf",
        metadata: { workspaceId: "research" },
      },
    );

    expect(asset).toMatchObject({
      type: "data",
      mediaType: "application/pdf",
      size: 3,
      ref: { uri: "convex://asset-1" },
    });
    expect(storage.store).toHaveBeenCalledWith(expect.any(Blob));
    await expect(stored.get("asset-1")?.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
    await expect(assets.get(asset.ref)).resolves.toMatchObject({
      type: "data",
      mediaType: "application/pdf",
      size: 3,
    });

    await assets.delete(asset.ref);
    expect(storage.delete).toHaveBeenCalledWith("asset-1");
  });

  it("throws clearly when get is unavailable in the current Convex runtime", async () => {
    const assets = convexAssetStore({
      ctx: {
        storage: {
          store: vi.fn(async () => "asset-1"),
        },
      },
    });

    await expect(assets.get({ uri: "convex://asset-1" })).rejects.toThrow(
      /requires ctx.storage.get/i,
    );
  });

  it("rejects invalid data asset facts before storing", async () => {
    const storage = {
      store: vi.fn(async () => "asset-1"),
    };
    const assets = convexAssetStore({ ctx: { storage } });

    await expect(
      assets.put({
        type: "data",
        data: new Uint8Array([1]),
        mediaType: "text/plain",
        size: -1,
      }),
    ).rejects.toMatchObject({ code: "invalid_value" });
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("rejects Blob mediaType mismatches before storing", async () => {
    const storage = {
      store: vi.fn(async () => "asset-1"),
    };
    const assets = convexAssetStore({ ctx: { storage } });

    await expect(
      assets.put({
        type: "data",
        data: new Blob(["hello"], { type: "text/html" }),
        mediaType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "invalid_value" });
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("returns only allowlisted StoredAsset fields", async () => {
    const storage = {
      store: vi.fn(async () => "asset-1"),
    };
    const assets = convexAssetStore({ ctx: { storage } });
    const stored = await assets.put({
      type: "data",
      data: new Uint8Array([1]),
      mediaType: "text/plain; charset=utf-8",
      size: 1,
      extraProviderField: "secret",
    } as never);

    expect(stored).toEqual({
      type: "data",
      data: expect.any(Blob),
      mediaType: "text/plain",
      size: 1,
      ref: { uri: "convex://asset-1" },
    });
  });
});
