/** Cross-store checkpoint and replay laws shared by Session adapters. */

import { expect, it, vi } from "vitest";
import type {
  RunSessionConformanceTestsOptions,
  SessionConformanceWorker,
} from "./types";

export function registerSessionRecoveryConformance(
  options: RunSessionConformanceTestsOptions,
): void {
  it("recovers a checkpoint after host reconstruction without re-execution", async () => {
    const harness = await options.createHarness("checkpoint-reconnect");
    let worker: SessionConformanceWorker | undefined;
    try {
      const conversation = await harness.create("reconnect-key");
      const turn = await conversation.send({ message: "reconnect" });
      harness.armFault("after-checkpoint");
      await harness.reconnect();
      worker = await harness.startWorker();

      await expect(turn.result()).resolves.toEqual({
        reply: "Echo: reconnect",
      });
      const reconnected = await harness.get("reconnect-key");
      await expect(reconnected.status()).resolves.toMatchObject({
        state: "parked",
        processedCursor: "1",
      });
      await expect(harness.receiptCount(reconnected.thread.id)).resolves.toBe(
        1,
      );
      expect(harness.executionCounts()).toEqual({
        executor: 1,
        provider: 2,
        tool: 1,
        effect: 1,
      });
    } finally {
      await worker?.stop();
      await harness.dispose();
    }
  });

  it("reuses the sealed Thread basis when replaying prepared publication", async () => {
    const harness = await options.createHarness("sealed-revision-replay");
    let worker: SessionConformanceWorker | undefined;
    try {
      const conversation = await harness.create("sealed-key");
      const turn = await conversation.send({ message: "sealed" });
      harness.armFault("after-thread-publication");
      worker = await harness.startWorker();

      let sealed = (await conversation.inspect()).checkpoint;
      await vi.waitFor(async () => {
        sealed = (await conversation.inspect()).checkpoint;
        expect(sealed).toMatchObject({
          thread: {
            revision: expect.any(String),
            range: expect.any(String),
          },
          requestIds: [expect.any(String), expect.any(String)],
        });
      });
      await expect(turn.result()).resolves.toEqual({ reply: "Echo: sealed" });
      expect((await conversation.inspect()).checkpoint).toEqual(sealed);
      await expect(harness.receiptCount(conversation.thread.id)).resolves.toBe(
        1,
      );
      expect(harness.executionCounts()).toEqual({
        executor: 1,
        provider: 2,
        tool: 1,
        effect: 1,
      });
    } finally {
      await worker?.stop();
      await harness.dispose();
    }
  });
}
