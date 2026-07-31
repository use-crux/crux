/**
 * Shared asset identity and rollback behaviors for Storage-backed Threads.
 *
 * @module
 */

import { expect, it } from "vitest";
import type { AssetRef, AssetStore } from "../../asset";
import { inMemoryAssetStore } from "../../storage";
import { thread } from "../thread";
import type { ErasureConformanceOptions } from "./erasure-conformance";

/** Register media identity and aborted-write cleanup behaviors. */
export function registerThreadAssetErasureConformance(
  options: ErasureConformanceOptions,
): void {
  it("rejects changed media under a stable id without mutating canonical history", async () => {
    const prepared = await options.prepare();
    const storage = {
      ...prepared,
      assets: prepared.assets ?? inMemoryAssetStore(),
    };
    const conversation = thread({ id: "media-identity", storage });
    const message = (byte: number) => ({
      id: "stable-media",
      role: "user" as const,
      content: [{
        type: "image" as const,
        source: {
          type: "data" as const,
          data: new Uint8Array([byte]),
          mediaType: "image/png",
        },
      }],
    });
    await conversation.append(message(1));

    await expect(conversation.append(message(2))).rejects.toMatchObject({
      code: "identity_conflict",
    });
    expect((await conversation.read()).entries[0]).toMatchObject({
      id: "stable-media",
      content: [{
        source: { type: "data", data: new Uint8Array([1]) },
      }],
    });
  });

  it("does not collapse distinct caller-owned refs with the same claimed digest", async () => {
    const prepared = await options.prepare();
    const assets = prepared.assets ?? inMemoryAssetStore();
    const sha256 = "a".repeat(64);
    const first = await assets.put({
      type: "data",
      data: new Uint8Array([1]),
      mediaType: "image/png",
      sha256,
    });
    const second = await assets.put({
      type: "data",
      data: new Uint8Array([2]),
      mediaType: "image/png",
      sha256,
    });
    const conversation = thread({
      id: "caller-ref-identity",
      storage: { ...prepared, assets },
    });
    const message = (source: typeof first) => ({
      id: "stable-ref",
      role: "user" as const,
      content: [{ type: "image" as const, source }],
    });
    await conversation.append(message(first));

    await expect(conversation.append(message(second))).rejects.toMatchObject({
      code: "identity_conflict",
    });
    expect((await conversation.read()).entries[0]).toMatchObject({
      content: [{
        source: { type: "data", data: new Uint8Array([1]) },
      }],
    });
  });

  it("cleans staged media after an exact replay", async () => {
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
      id: "media-replay-cleanup",
      storage: { ...prepared, assets },
    });
    const message = {
      id: "stable-media",
      role: "user",
      content: [{
        type: "image",
        source: {
          type: "data",
          data: new Uint8Array([3]),
          mediaType: "image/png",
        },
      }],
    } as const;
    await conversation.append(message);
    await expect(conversation.append(message)).resolves.toMatchObject({
      replayed: true,
    });

    expect(stored).toHaveLength(2);
    await expect(backingAssets.get(stored[0]!)).resolves.toBeDefined();
    await expect(backingAssets.get(stored[1]!)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rolls back an asset write that loses a race with redaction", async () => {
    const prepared = await options.prepare();
    const backingAssets = prepared.assets ?? inMemoryAssetStore();
    let blockPut = false;
    let markPutStarted = (): void => {};
    let releasePut = (): void => {};
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    const putRelease = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const stored: AssetRef[] = [];
    const assets: AssetStore = {
      ...backingAssets,
      async put(asset, putOptions) {
        if (blockPut) {
          markPutStarted();
          await putRelease;
        }
        const result = await backingAssets.put(asset, putOptions);
        stored.push(result.ref);
        return result;
      },
    };
    const conversation = thread({
      id: "media-redaction-race",
      storage: { ...prepared, assets },
    });
    const message = {
      id: "stable-media",
      role: "user",
      content: [{
        type: "image",
        source: {
          type: "data",
          data: new Uint8Array([1]),
          mediaType: "image/png",
        },
      }],
    } as const;
    await conversation.append(message);
    blockPut = true;
    const replay = conversation.append(message);
    await putStarted;
    await conversation.redact("stable-media");
    releasePut();

    await expect(replay).rejects.toMatchObject({ code: "redacted" });
    await expect(backingAssets.get(stored.at(-1)!)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rolls back media when later group validation rejects the append", async () => {
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
      id: "invalid-media-group",
      storage: { ...prepared, assets },
    });

    await expect(conversation.append({
      id: "invalid",
      role: "assistant",
      content: [
        {
          type: "image",
          source: {
            type: "data",
            data: new Uint8Array([7]),
            mediaType: "image/png",
          },
        },
        {
          type: "tool-call",
          toolCallId: "unmatched",
          toolName: "lookup",
          input: {},
        },
      ],
    })).rejects.toMatchObject({ code: "invalid_message" });
    expect(stored).toHaveLength(1);
    await expect(backingAssets.get(stored[0]!)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("does not roll back another in-flight append's matching media", async () => {
    const prepared = await options.prepare();
    const backingAssets = prepared.assets ?? inMemoryAssetStore();
    let puts = 0;
    let markValidPut = (): void => {};
    let releaseValidPut = (): void => {};
    const validPut = new Promise<void>((resolve) => {
      markValidPut = resolve;
    });
    const validRelease = new Promise<void>((resolve) => {
      releaseValidPut = resolve;
    });
    const assets: AssetStore = {
      ...backingAssets,
      async put(asset, putOptions) {
        const result = await backingAssets.put(asset, putOptions);
        puts += 1;
        if (puts === 1) {
          markValidPut();
          await validRelease;
        }
        return result;
      },
    };
    const conversation = thread({
      id: "concurrent-media-rollback",
      storage: { ...prepared, assets },
    });
    const media = {
      id: "stable-media",
      role: "user",
      content: [{
        type: "image",
        source: {
          type: "data",
          data: new Uint8Array([9]),
          mediaType: "image/png",
        },
      }],
    } as const;
    const valid = conversation.append(media);
    await validPut;
    await expect(conversation.append([
      media,
      {
        id: "unmatched",
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "missing-result",
          toolName: "lookup",
          input: {},
        }],
      },
    ])).rejects.toMatchObject({ code: "invalid_message" });
    releaseValidPut();
    await valid;

    expect((await conversation.read()).entries[0]).toMatchObject({
      id: "stable-media",
      content: [{
        source: { type: "data", data: new Uint8Array([9]) },
      }],
    });
  });
}
