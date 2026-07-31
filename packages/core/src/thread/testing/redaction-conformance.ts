/**
 * Shared irreversible-redaction behaviors for Storage-backed Threads.
 *
 * @module
 */

import { expect, it } from "vitest";
import type { AssetRef, AssetStore } from "../../asset";
import { inMemoryAssetStore, type RecordStore } from "../../storage";
import { thread } from "../thread";
import type { ErasureConformanceOptions } from "./erasure-conformance";

/** Register redaction, poisoning, and boundary behaviors. */
export function registerThreadRedactionConformance(
  options: ErasureConformanceOptions,
): void {
  it("redacts normalized message sets atomically and erases owned assets", async () => {
    const storage = await options.prepare();
    const backingAssets = storage.assets ?? inMemoryAssetStore();
    const deleted: AssetRef[] = [];
    const stored: AssetRef[] = [];
    const assetKeys: (string | undefined)[] = [];
    const assets: AssetStore = {
      ...backingAssets,
      async put(asset, putOptions) {
        const result = await backingAssets.put(asset, putOptions);
        stored.push(result.ref);
        assetKeys.push(putOptions?.key);
        return result;
      },
      async delete(ref) {
        deleted.push(ref);
        await backingAssets.delete(ref);
      },
    };
    const conversation = thread({
      id: "atomic-redaction",
      storage: { ...storage, assets },
    });
    const mediaMessage = {
      id: "first",
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "data",
            data: new Uint8Array([1]),
            mediaType: "image/png",
          },
        },
      ],
      metadata: { private: true },
    } as const;
    await conversation.append(mediaMessage);
    expect(assetKeys).toEqual([
      expect.stringMatching(/^thread\/atomic-redaction\/asset\/first\//u),
    ]);
    await conversation.append({
      id: "second",
      role: "assistant",
      content: "Second",
      metadata: { private: true },
    });
    await conversation.append({
      id: "third",
      role: "user",
      content: "Third",
    });

    await conversation.redact("first");
    await conversation.redact("first");
    expect((await conversation.read()).entries[0]).toEqual({
      kind: "redacted",
      id: "first",
    });
    expect(deleted).toHaveLength(1);
    await expect(conversation.append(mediaMessage)).rejects.toMatchObject({
      code: "redacted",
    });
    expect(stored).toHaveLength(1);
    await expect(backingAssets.get(stored[0]!)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      conversation.redact(["second", "missing", "third"]),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await conversation.read()).entries.slice(1)).toMatchObject([
      { kind: "message", id: "second", content: "Second" },
      { kind: "message", id: "third", content: "Third" },
    ]);

    await conversation.redact(["third", "second", "third"]);
    expect((await conversation.read()).entries).toEqual([
      { kind: "redacted", id: "first" },
      { kind: "redacted", id: "second", parentId: "first" },
      { kind: "redacted", id: "third", parentId: "second" },
    ]);
  });

  it("poisons replay and edit while preserving proven append boundaries", async () => {
    const conversation = thread({
      id: "redacted-boundaries",
      storage: await options.prepare(),
    });
    const stable = {
      id: "stable-user",
      role: "user",
      content: "Secret",
    } as const;
    await conversation.append(stable);
    await conversation.redact("stable-user");
    await expect(conversation.append(stable)).rejects.toMatchObject({
      code: "redacted",
    });
    await expect(
      conversation.edit("stable-user", {
        content: "Replacement",
      }),
    ).rejects.toMatchObject({ code: "redacted" });

    await conversation.append(
      [
        { id: "group-start", role: "user", content: "Question" },
        { id: "group-end", role: "assistant", content: "Answer" },
      ],
      { after: "stable-user" },
    );
    await conversation.redact(["group-start", "group-end"]);
    await expect(
      conversation.append(
        { id: "split", role: "user", content: "Invalid" },
        { after: "group-start" },
      ),
    ).rejects.toMatchObject({ code: "invalid_group" });
    await expect(
      conversation.append(
        { id: "continuation", role: "user", content: "Allowed" },
        { after: "group-end" },
      ),
    ).resolves.toMatchObject({
      status: "selected",
      parentId: "group-end",
    });
  });

  it("requires a physical tombstone to prove a redacted append boundary", async () => {
    const prepared = await options.prepare();
    const backingAssets = prepared.assets ?? inMemoryAssetStore();
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
      id: "redacted-boundary-proof",
      storage: { ...prepared, assets },
    });
    await conversation.append({
      id: "boundary",
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "data",
            data: new Uint8Array([5]),
            mediaType: "image/png",
          },
        },
      ],
    });

    const redaction = conversation.redact("boundary");
    await cleanupStarted;
    await expect(
      conversation.append(
        { id: "premature", role: "user", content: "Too soon" },
        { after: "boundary" },
      ),
    ).rejects.toMatchObject({ code: "redacted" });
    releaseCleanup();
    await redaction;
    await expect(
      conversation.append(
        { id: "allowed-after-cleanup", role: "user", content: "Allowed" },
        { after: "boundary" },
      ),
    ).resolves.toMatchObject({ parentId: "boundary" });
  });

  it("rejects and cleans an edit that loses a race with redaction", async () => {
    const storage = await options.prepare();
    const backing = storage.records;
    let releaseReplacement = (): void => {};
    let markReplacementCreated = (): void => {};
    const replacementCreated = new Promise<void>((resolve) => {
      markReplacementCreated = resolve;
    });
    const replacementRelease = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    const records: RecordStore = {
      ...backing,
      async create(key, value, writeOptions) {
        const created = await backing.create(key, value, writeOptions);
        if (key.endsWith("/node/replacement")) {
          markReplacementCreated();
          await replacementRelease;
        }
        return created;
      },
    };
    const conversation = thread({
      id: "edit-redaction-race",
      storage: { ...storage, records },
    });
    await conversation.append({
      id: "target",
      role: "user",
      content: "Original",
    });

    const edit = conversation.edit("target", {
      id: "replacement",
      content: "Replacement",
    });
    await replacementCreated;
    await conversation.redact("target");
    releaseReplacement();

    await expect(edit).rejects.toMatchObject({ code: "redacted" });
    expect(
      await backing.get("thread/edit-redaction-race/node/replacement"),
    ).toBeNull();
  });
}
