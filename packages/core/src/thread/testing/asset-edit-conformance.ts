/**
 * Shared media-cleanup behavior for immutable Thread edits.
 *
 * @module
 */

import { expect, it } from "vitest";
import type { AssetRef, AssetStore } from "../../asset";
import {
  inMemoryAssetStore,
  type RecordStore,
} from "../../storage";
import { thread } from "../thread";
import type { ErasureConformanceOptions } from "./erasure-conformance";

/** Register staging cleanup for exact edit replay. */
export function registerThreadAssetEditConformance(
  options: ErasureConformanceOptions,
): void {
  it("cleans staged media after an exact edit replay", async () => {
    const prepared = await options.prepare();
    const backingAssets = prepared.assets ?? inMemoryAssetStore();
    const stored: AssetRef[] = [];
    const assets: AssetStore = {
      ...backingAssets,
      async put(asset, putOptions) {
        const result = await backingAssets.put(asset, putOptions);
        stored.push(result.ref);
        return result;
      },
    };
    const conversation = thread({
      id: "media-edit-replay-cleanup",
      storage: { ...prepared, assets },
    });
    await conversation.append({
      id: "original",
      role: "user",
      content: "Original",
    });
    const patch = {
      id: "replacement",
      content: [{
        type: "image",
        source: {
          type: "data",
          data: new Uint8Array([4]),
          mediaType: "image/png",
        },
      }],
    } as const;
    await conversation.edit("original", patch);
    await expect(conversation.edit("original", patch)).resolves.toMatchObject({
      replayed: true,
    });

    expect(stored).toHaveLength(2);
    await expect(backingAssets.get(stored[0]!)).resolves.toBeDefined();
    await expect(backingAssets.get(stored[1]!)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("preserves the winning asset across concurrent identical edits", async () => {
    const prepared = await options.prepare();
    const backingAssets = prepared.assets ?? inMemoryAssetStore();
    const backingRecords = prepared.records;
    const stored: AssetRef[] = [];
    let blockWinningCreate = true;
    let markWinnerCreated = (): void => {};
    let releaseWinner = (): void => {};
    const winnerCreated = new Promise<void>((resolve) => {
      markWinnerCreated = resolve;
    });
    const winnerRelease = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    const assets: AssetStore = {
      ...backingAssets,
      async put(asset, putOptions) {
        const result = await backingAssets.put(asset, putOptions);
        stored.push(result.ref);
        return result;
      },
    };
    const records: RecordStore = {
      ...backingRecords,
      async create(key, value, writeOptions) {
        const created = await backingRecords.create(key, value, writeOptions);
        if (
          created &&
          blockWinningCreate &&
          key.endsWith("/node/replacement")
        ) {
          blockWinningCreate = false;
          markWinnerCreated();
          await winnerRelease;
        }
        return created;
      },
    };
    const conversation = thread({
      id: "concurrent-media-edit",
      storage: { ...prepared, assets, records },
    });
    await conversation.append({
      id: "original",
      role: "user",
      content: "Original",
    });
    const patch = {
      id: "replacement",
      content: [{
        type: "image",
        source: {
          type: "data",
          data: new Uint8Array([6]),
          mediaType: "image/png",
        },
      }],
    } as const;
    const winner = conversation.edit("original", patch);
    await winnerCreated;
    const publisher = await conversation.edit("original", patch);
    releaseWinner();
    const recovered = await winner;

    expect([publisher.replayed, recovered.replayed].sort()).toEqual([
      false,
      true,
    ]);
    expect(stored).toHaveLength(2);
    await expect(backingAssets.get(stored[0]!)).resolves.toBeDefined();
    await expect(backingAssets.get(stored[1]!)).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await conversation.read()).entries.at(-1)).toMatchObject({
      id: "replacement",
      content: [{
        source: { type: "data", data: new Uint8Array([6]) },
      }],
    });
  });
}
