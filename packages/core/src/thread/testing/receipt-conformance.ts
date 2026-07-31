/**
 * Shared append-receipt recovery behaviors for Storage-backed Threads.
 *
 * Branch navigation depends on immutable original receipts, including when a
 * process stops between control publication and receipt finalization.
 *
 * @module
 */

import { expect, it } from "vitest";
import type {
  RecordStore,
  Storage,
} from "../../storage";
import { thread } from "../thread";

interface ReceiptConformanceOptions {
  readonly prepare: () => Storage | Promise<Storage>;
}

/** Register crash-recovery behaviors for immutable append receipts. */
export function registerThreadReceiptConformance(
  options: ReceiptConformanceOptions,
): void {
  it("repairs an append receipt after finalization fails post-publication", async () => {
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
      id: "receipt-recovery",
      storage: { ...storage, records },
    });
    const input = {
      id: "stable-message",
      role: "user",
      content: "Durable",
    } as const;

    await expect(conversation.append(input)).rejects.toMatchObject({
      code: "commit_failed",
    });
    await expect(conversation.append(input)).resolves.toMatchObject({
      status: "selected",
      messageIds: ["stable-message"],
      selectedHead: "stable-message",
      replayed: true,
    });
    expect((await conversation.read()).head).toBe("stable-message");
  });

  it("replays the atomic receipt while initial finalization is delayed", async () => {
    const storage = await options.prepare();
    const backing = storage.records;
    let releaseReceipt = (): void => {};
    let markReceiptStarted = (): void => {};
    const receiptStarted = new Promise<void>((resolve) => {
      markReceiptStarted = resolve;
    });
    const receiptRelease = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    let blockFirstReceipt = true;
    const records: RecordStore = {
      ...backing,
      async create(key, value, writeOptions) {
        if (blockFirstReceipt && key.includes("/receipt/")) {
          blockFirstReceipt = false;
          markReceiptStarted();
          await receiptRelease;
        }
        return backing.create(key, value, writeOptions);
      },
    };
    const conversation = thread({
      id: "receipt-race",
      storage: { ...storage, records },
    });
    const input = {
      id: "stable-message",
      role: "user",
      content: "Original",
    } as const;
    const originalPromise = conversation.append(input);
    await receiptStarted;
    await conversation.edit("stable-message", {
      id: "edited-message",
      content: "Edited",
    });

    let replay: Awaited<typeof originalPromise>;
    try {
      replay = await conversation.append(input);
    } finally {
      releaseReceipt();
    }
    const original = await originalPromise;
    expect(replay).toEqual({ ...original, replayed: true });
    expect((await conversation.read()).head).toBe("edited-message");
  });
}
