import { describe, expect, it, vi } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";

describe("durable application Work detachment", () => {
  it("changes only durable ownership and remains reconnectable", async () => {
    const execute = vi.fn(async () => "completed-after-detach");
    const review = flow("review-detached", execute);
    const store = inMemoryRuntimeStore();
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const firstHost = createWorkHost({
      runtime: node({
        store,
        namespace: "work-detach-test",
        autoStartMaintenance: false,
      }),
      program,
    });
    const accepted = await firstHost.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );

    await expect(accepted.detach()).resolves.toMatchObject({
      workId: accepted.id,
      outcome: "detached",
      ownership: { state: "detached", reason: "explicit" },
    });
    await expect(accepted.detach()).resolves.toMatchObject({
      outcome: "already-detached",
      ownership: { state: "detached" },
    });
    expect(execute).not.toHaveBeenCalled();
    firstHost.dispose();

    const runtime = node({
      store,
      namespace: "work-detach-test",
      autoStartMaintenance: false,
    });
    const reconstructedHost = createWorkHost({ runtime, program });
    const reconnected = await reconstructedHost.run(() =>
      getWork(review, accepted.id),
    );
    await expect(reconnected.status()).resolves.toMatchObject({
      state: "queued",
      ownership: { state: "detached", reason: "explicit" },
    });

    const worker = createRuntimeWorker({ runtime, program });
    try {
      await expect(reconnected.result()).resolves.toBe(
        "completed-after-detach",
      );
      expect(execute).toHaveBeenCalledOnce();
      await expect(reconnected.status()).resolves.toMatchObject({
        state: "completed",
        ownership: { state: "detached" },
      });
    } finally {
      await worker.stop();
      reconstructedHost.dispose();
    }
  });
});
