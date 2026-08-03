/**
 * Shared permanent-deletion behaviors for Storage-backed Threads.
 *
 * @module
 */

import { expect, it } from "vitest";
import { inMemoryAssetStore, type RecordStore } from "../../storage";
import { thread } from "../thread";
import { registerThreadDeletionEdgeConformance } from "./deletion-edge-conformance";
import type { ErasureConformanceOptions } from "./erasure-conformance";
import { registerThreadOwnerConformance } from "./owner-conformance";

/** Register owner gating, complete cleanup, and writer-fence behaviors. */
export function registerThreadDeletionConformance(
  options: ErasureConformanceOptions,
): void {
  it("blocks owned deletion and permanently erases unowned Thread records", async () => {
    const storage = await options.prepare();
    const backing = storage.records;
    let failReceipt = true;
    const records: RecordStore = {
      ...backing,
      async create(key, value, writeOptions) {
        if (failReceipt && key.includes("/receipt/")) {
          failReceipt = false;
          throw new Error("receipt write interrupted");
        }
        return backing.create(key, value, writeOptions);
      },
    };
    const conversation = thread({
      id: "permanent-deletion",
      storage: { ...storage, records },
    });
    await expect(conversation.append({
      id: "pending-message",
      role: "user",
      content: "Erase me",
    })).rejects.toMatchObject({ code: "commit_failed" });
    const before = await backing.get("thread/permanent-deletion");
    expect(before?.pendingReceipts).not.toEqual({});

    await conversation.delete();
    await expect(conversation.delete()).resolves.toBeUndefined();
    expect(await backing.list("thread/permanent-deletion/")).toEqual({
      entries: [],
    });
    expect(await backing.get("thread/permanent-deletion")).toMatchObject({
      state: "deleted",
      heads: {},
      leaves: {},
      pendingReceipts: {},
    });
    await expect(conversation.read()).rejects.toMatchObject({ code: "deleted" });
    await expect(conversation.append({
      role: "user",
      content: "No",
    })).rejects.toMatchObject({ code: "deleted" });
    await expect(conversation.edit("pending-message", {
      content: "No",
    })).rejects.toMatchObject({ code: "deleted" });
    await expect(conversation.select("pending-message"))
      .rejects.toMatchObject({ code: "deleted" });
    await expect(conversation.redact("pending-message"))
      .rejects.toMatchObject({ code: "deleted" });
  });

  it("fences nodes and receipts created by appends racing with deletion", async () => {
    const nodeStorage = await options.prepare();
    const nodeBacking = nodeStorage.records;
    let releaseNode = (): void => {};
    let markNodeStarted = (): void => {};
    const nodeStarted = new Promise<void>((resolve) => {
      markNodeStarted = resolve;
    });
    const nodeRelease = new Promise<void>((resolve) => {
      releaseNode = resolve;
    });
    const nodeRecords: RecordStore = {
      ...nodeBacking,
      async create(key, value, writeOptions) {
        if (key.endsWith("/node/late")) {
          markNodeStarted();
          await nodeRelease;
        }
        return nodeBacking.create(key, value, writeOptions);
      },
    };
    const nodeRace = thread({
      id: "node-delete-race",
      storage: { ...nodeStorage, records: nodeRecords },
    });
    const lateAppend = nodeRace.append({
      id: "late",
      role: "user",
      content: "Late",
    });
    await nodeStarted;
    await nodeRace.delete();
    releaseNode();
    await expect(lateAppend).rejects.toMatchObject({ code: "deleted" });
    expect(await nodeBacking.list("thread/node-delete-race/")).toEqual({
      entries: [],
    });

    const receiptStorage = await options.prepare();
    const receiptBacking = receiptStorage.records;
    let releaseReceipt = (): void => {};
    let markReceiptStarted = (): void => {};
    const receiptStarted = new Promise<void>((resolve) => {
      markReceiptStarted = resolve;
    });
    const receiptRelease = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const receiptRecords: RecordStore = {
      ...receiptBacking,
      async create(key, value, writeOptions) {
        if (key.includes("/receipt/")) {
          markReceiptStarted();
          await receiptRelease;
        }
        return receiptBacking.create(key, value, writeOptions);
      },
    };
    const receiptRace = thread({
      id: "receipt-delete-race",
      storage: { ...receiptStorage, records: receiptRecords },
    });
    const finalizing = receiptRace.append({
      id: "message",
      role: "user",
      content: "Finalizing",
    });
    await receiptStarted;
    await receiptRace.delete();
    releaseReceipt();
    await expect(finalizing).rejects.toMatchObject({ code: "deleted" });
    expect(await receiptBacking.list("thread/receipt-delete-race/")).toEqual({
      entries: [],
    });
  });

  it("rejects asset cleanup without the owning AssetStore and supports repair", async () => {
    const prepared = await options.prepare();
    const assets = prepared.assets ?? inMemoryAssetStore();
    const storage = { ...prepared, assets };
    const redacted = thread({ id: "missing-redact-assets", storage });
    await redacted.append(mediaMessage(3));
    const redactedWithoutAssets = thread({
      id: redacted.id,
      storage: { records: storage.records },
    });

    await expect(redactedWithoutAssets.redact("media"))
      .rejects.toMatchObject({ code: "unsupported_capability" });
    expect(await storage.records.get(
      "thread/missing-redact-assets/node/media",
    )).toHaveProperty("message");
    await redacted.redact("media");
    expect(await storage.records.get(
      "thread/missing-redact-assets/node/media",
    )).not.toHaveProperty("message");

    const deleted = thread({ id: "missing-delete-assets", storage });
    await deleted.append(mediaMessage(4));
    const deletedWithoutAssets = thread({
      id: deleted.id,
      storage: { records: storage.records },
    });
    await expect(deletedWithoutAssets.delete()).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    expect(await storage.records.get(
      "thread/missing-delete-assets/node/media",
    )).not.toBeNull();
    await deleted.delete();
    expect(await storage.records.list("thread/missing-delete-assets/"))
      .toEqual({ entries: [] });
  });

  registerThreadDeletionEdgeConformance(options);
  registerThreadOwnerConformance(options);
}

function mediaMessage(byte: number) {
  return {
    id: "media",
    role: "user" as const,
    content: [{
      type: "image" as const,
      source: {
        type: "data" as const,
        data: new Uint8Array([byte]),
        mediaType: "image/png",
      },
    }],
  };
}
