/**
 * Shared cleanup-edge behaviors for permanent Thread deletion.
 *
 * @module
 */

import { expect, it } from "vitest";
import type { AssetStore } from "../../asset";
import { inMemoryAssetStore } from "../../storage";
import { thread } from "../thread";
import type { ErasureConformanceOptions } from "./erasure-conformance";

/** Register malformed-record and publish-before-cleanup behaviors. */
export function registerThreadDeletionEdgeConformance(
  options: ErasureConformanceOptions,
): void {
  it("deletes opaque malformed child records without blocking later cleanup", async () => {
    const storage = await options.prepare();
    const conversation = thread({ id: "malformed-cleanup", storage });
    await conversation.append({
      id: "message",
      role: "user",
      content: "Corrupt later",
    });
    await storage.records.put("thread/malformed-cleanup/node/message", {
      schema: 999,
      assetRefs: [],
      privatePayload: "must still be erased",
    });

    await conversation.delete();

    expect(await storage.records.list("thread/malformed-cleanup/")).toEqual({
      entries: [],
    });
  });

  it("publishes deletion before physical cleanup completes", async () => {
    const storage = await options.prepare();
    const backingAssets = storage.assets ?? inMemoryAssetStore();
    let releaseCleanup = (): void => {};
    let markCleanupStarted = (): void => {};
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    const cleanupRelease = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const assets: AssetStore = {
      ...backingAssets,
      async delete(ref) {
        markCleanupStarted();
        await cleanupRelease;
        await backingAssets.delete(ref);
      },
    };
    const conversation = thread({
      id: "delete-publication",
      storage: { ...storage, assets },
    });
    await conversation.append({
      id: "asset-message",
      role: "user",
      content: [{
        type: "image",
        source: {
          type: "data",
          data: new Uint8Array([2]),
          mediaType: "image/png",
        },
      }],
    });

    const deletion = conversation.delete();
    await cleanupStarted;
    await expect(conversation.read()).rejects.toMatchObject({ code: "deleted" });
    await expect(conversation.append({
      role: "user",
      content: "Too late",
    })).rejects.toMatchObject({ code: "deleted" });
    releaseCleanup();
    await deletion;
  });
}
