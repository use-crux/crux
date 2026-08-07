import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkHost,
  flow,
  getWork,
  spawn,
} from "@use-crux/core";
import {
  EffectOutcomeUnknownError,
  effect,
  reconcileEffect,
  rollback,
  type EffectReceiptRef,
} from "@use-crux/core/effect";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type WorkId,
} from "@use-crux/core/runtime";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";
import { projectProcessLocalWork } from "../../src/work/internal/public-projection";
import { createInternalWorkOwnerPort } from "../../src/work/internal/owner-retained-work";
import { resetEffectDefinitionsForTesting } from "../../src/effect/define-effect";

afterEach(() => {
  resetEffectDefinitionsForTesting();
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("Work and Session lifecycle Effect guarantees", () => {
  it("cancels process-local Work without rolling back completed Effects", async () => {
    const recover = vi.fn(async () => undefined);
    let receipt!: EffectReceiptRef;
    const record = effect(
      "work.lifecycle.cancel-local",
      async (_input: void, context) => {
        receipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "work.lifecycle.cancel-local",
        };
      },
      { recover },
    );
    const effectDone = deferred();
    let start: (() => void) | undefined;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_lifecycle_cancel_local",
      schedule(run) {
        start = run;
      },
    });
    const handle = await kernel.spawn({
      async run(context) {
        await record.run();
        effectDone.resolve();
        return new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal.reason),
            { once: true },
          );
        });
      },
    });
    const effects = handle.effects;
    start?.();
    await effectDone.promise;
    expect(handle.cancel()).toBe(true);
    await expect(handle.result()).rejects.toBeDefined();
    await expect(handle.status()).resolves.toMatchObject({
      state: "cancelled",
    });
    expect(recover).not.toHaveBeenCalled();
    expect(handle.effects).toEqual(effects);
    await expect(rollback(handle.effects)).resolves.toMatchObject({
      status: "completed",
      units: [
        expect.objectContaining({
          effectIds: ["work.lifecycle.cancel-local"],
          status: "recovered",
        }),
      ],
    });
    expect(recover).toHaveBeenCalledOnce();
    expect(receipt.kind).toBe("effect.receipt");
  });

  it("cancels durable Work without rolling back completed Effects", async () => {
    const recover = vi.fn(async () => undefined);
    let receipt!: EffectReceiptRef;
    let observedScope!: { readonly id: string; readonly runId: string };
    const record = effect(
      "work.lifecycle.cancel-durable",
      async (_input: void, context) => {
        receipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "work.lifecycle.cancel-durable",
        };
        observedScope = context.scope;
      },
      { recover },
    );
    const review = flow("work-lifecycle-cancel-durable", async () => {
      await record.run();
      return "completed-result";
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-lifecycle-cancel-durable",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({
      targets: [review],
      effectTargets: [record],
      transports: [],
    });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "cancel-durable-1" }),
    );
    const effects = accepted.effects;
    const worker = createRuntimeWorker({ runtime, program, pollIntervalMs: 5 });

    try {
      await expect(accepted.result()).resolves.toBe("completed-result");
      expect(observedScope).toEqual(effects);
      await expect(
        accepted.cancel({ reason: "No longer needed" }),
      ).resolves.toMatchObject({
        outcome: "already-terminal",
        status: { state: "completed" },
      });
      expect(recover).not.toHaveBeenCalled();
      expect(accepted.effects).toEqual(effects);
      await expect(rollback(accepted.effects)).resolves.toMatchObject({
        status: "completed",
        units: [
          expect.objectContaining({
            effectIds: ["work.lifecycle.cancel-durable"],
            status: "recovered",
          }),
        ],
      });
      expect(recover).toHaveBeenCalledOnce();
      expect(receipt.kind).toBe("effect.receipt");
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("detaches Work without reparenting Effects and keeps recovery access", async () => {
    const recover = vi.fn(async () => undefined);
    let observedScope!: { readonly id: string; readonly runId: string };
    const record = effect(
      "work.lifecycle.detach",
      async (_input: void, context) => {
        observedScope = context.scope;
      },
      { recover },
    );
    const review = flow("work-lifecycle-detach", async () => {
      await record.run();
      return "detached-complete";
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-lifecycle-detach",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({
      targets: [review],
      effectTargets: [record],
      transports: [],
    });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "detach-1" }),
    );
    const effects = accepted.effects;
    await expect(accepted.detach()).resolves.toMatchObject({
      outcome: "detached",
      ownership: { state: "detached", reason: "explicit" },
    });
    expect(accepted.effects).toEqual(effects);
    const worker = createRuntimeWorker({ runtime, program, pollIntervalMs: 5 });

    try {
      await expect(accepted.result()).resolves.toBe("detached-complete");
      expect(observedScope).toEqual(effects);
      const reconnected = await host.run(() => getWork(review, accepted.id));
      expect(reconnected.effects).toEqual(effects);
      await expect(reconnected.status()).resolves.toMatchObject({
        state: "completed",
        ownership: { state: "detached", reason: "explicit" },
      });
      expect(recover).not.toHaveBeenCalled();
      await expect(rollback(reconnected.effects)).resolves.toMatchObject({
        status: "completed",
        units: [
          expect.objectContaining({
            effectIds: ["work.lifecycle.detach"],
            status: "recovered",
          }),
        ],
      });
      expect(recover).toHaveBeenCalledOnce();
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("preserves Effects and recovery under detached owner-ended ownership", async () => {
    const recover = vi.fn(async () => undefined);
    const record = effect(
      "work.lifecycle.owner-ended",
      async () => undefined,
      { recover },
    );
    const review = flow("work-lifecycle-owner-ended", async () => {
      await record.run();
      return "owner-ended-complete";
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-lifecycle-owner-ended",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({
      targets: [review],
      effectTargets: [record],
      transports: [],
    });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "owner-ended-1" }),
    );
    const effects = accepted.effects;
    const queued = await store.state.getWork(accepted.id as WorkId, {
      namespace: "work-lifecycle-owner-ended",
    });
    if (!queued?.application) throw new Error("Expected accepted Work.");
    await store.state.putWork({
      ...queued,
      application: {
        ...queued.application,
        ownership: {
          state: "detached",
          reason: "owner-ended",
          detachedAt: new Date().toISOString(),
        },
      },
    });

    const reconnected = await host.run(() => getWork(review, accepted.id));
    expect(reconnected.effects).toEqual(effects);
    await expect(reconnected.status()).resolves.toMatchObject({
      ownership: { state: "detached", reason: "owner-ended" },
    });
    const worker = createRuntimeWorker({ runtime, program, pollIntervalMs: 5 });

    try {
      await expect(reconnected.result()).resolves.toBe("owner-ended-complete");
      expect(reconnected.effects).toEqual(effects);
      expect(recover).not.toHaveBeenCalled();
      await expect(rollback(reconnected.effects)).resolves.toMatchObject({
        status: "completed",
        units: [
          expect.objectContaining({
            effectIds: ["work.lifecycle.owner-ended"],
            status: "recovered",
          }),
        ],
      });
      expect(recover).toHaveBeenCalledOnce();
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("keeps ambiguous Outcomes reconcilable after Work termination", async () => {
    const recover = vi.fn(async () => undefined);
    let receipt!: EffectReceiptRef;
    const charge = effect(
      "work.lifecycle.ambiguous-cancel",
      async (_input: void, context) => {
        receipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "work.lifecycle.ambiguous-cancel",
        };
        throw new EffectOutcomeUnknownError(
          "Provider accepted the charge with no confirmed outcome.",
        );
      },
      { recover },
    );
    let start: (() => void) | undefined;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_lifecycle_ambiguous",
      schedule(run) {
        start = run;
      },
    });
    const handle = await kernel.spawn({
      async run() {
        await charge.run();
        return "unreachable";
      },
    });
    const effects = handle.effects;
    start?.();
    await expect(handle.result()).rejects.toBeInstanceOf(
      EffectOutcomeUnknownError,
    );
    await expect(handle.status()).resolves.toMatchObject({ state: "failed" });
    expect(handle.cancel()).toBe(false);
    expect(recover).not.toHaveBeenCalled();
    expect(handle.effects).toEqual(effects);
    await expect(rollback(handle.effects)).resolves.toMatchObject({
      status: "not_possible",
      units: [
        expect.objectContaining({
          effectIds: ["work.lifecycle.ambiguous-cancel"],
          status: "ambiguous",
        }),
      ],
    });
    expect(recover).not.toHaveBeenCalled();
    await expect(
      reconcileEffect(receipt, {
        outcome: "succeeded",
        output: { chargeId: "ch_1" },
        reason: "Provider later confirmed the charge.",
      }),
    ).resolves.toMatchObject({
      id: receipt.id,
      outcome: "succeeded",
      recovery: "available",
    });
    await expect(rollback(handle.effects)).resolves.toMatchObject({
      status: "completed",
      units: [
        expect.objectContaining({
          effectIds: ["work.lifecycle.ambiguous-cancel"],
          status: "recovered",
        }),
      ],
    });
    expect(recover).toHaveBeenCalledOnce();
  });

  it("detaches process-local owner Work without reparenting Effects", async () => {
    const recover = vi.fn(async () => undefined);
    const record = effect(
      "work.lifecycle.detach-local",
      async () => undefined,
      { recover },
    );
    const effectDone = deferred();
    const release = deferred();
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_lifecycle_detach_local",
      schedule: (start) => start(),
    });
    const owner = createInternalWorkOwnerPort(kernel);
    const reference = await owner.spawnAndRetain(
      {
        async run() {
          await record.run();
          effectDone.resolve();
          await release.promise;
          return "finished";
        },
      },
      {
        kind: "cancellation-only",
        targetId: "agent:lifecycle-detach",
        targetLabel: "lifecycle-detach",
      },
    );
    const work = projectProcessLocalWork(owner, reference);
    if (!work) throw new Error("Expected process-local Work projection.");
    const effects = work.effects;
    await effectDone.promise;

    await expect(work.detach()).resolves.toMatchObject({
      outcome: "detached",
      ownership: { state: "detached", reason: "explicit" },
    });
    expect(work.effects).toEqual(effects);
    expect(owner.lookup(work.id)).toBeUndefined();
    release.resolve();
    await expect(work.result()).resolves.toBe("finished");
    expect(recover).not.toHaveBeenCalled();
    await expect(rollback(work.effects)).resolves.toMatchObject({
      status: "completed",
      units: [
        expect.objectContaining({
          effectIds: ["work.lifecycle.detach-local"],
          status: "recovered",
        }),
      ],
    });
    expect(recover).toHaveBeenCalledOnce();
  });
});
