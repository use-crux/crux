import { afterEach, describe, expect, it, vi } from "vitest";
import { config, effect, flow } from "@use-crux/core";
import { rollback } from "@use-crux/core/effect";
import {
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { resetEffectDefinitionsForTesting } from "../../src/effect/define-effect";
import { resetHooks } from "../../src/runtime/runtime";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetHooks();
});

describe("durable effects", () => {
  it("leaves a Runtime-backed flow without Effects unaffected", async () => {
    const store = inMemoryRuntimeStore();
    const runtime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        autoStartMaintenance: false,
      }),
    });
    const plainFlow = flow("plain-runtime-flow", async () => "completed");

    try {
      await expect(plainFlow.run()).resolves.toMatchObject({
        status: "completed",
        output: "completed",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("preserves Effect execution when no Runtime store is configured", async () => {
    const execute = vi.fn(async () => "updated");
    const update = effect("customer.in-process-update", execute, {
      recover: async () => undefined,
    });

    await expect(update.run()).resolves.toMatchObject({
      output: "updated",
      receipt: {
        kind: "effect.receipt",
        effectId: "customer.in-process-update",
      },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reconstructs and recovers a memory-backed scope after restart", async () => {
    const store = inMemoryRuntimeStore();
    const firstRuntime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        autoStartMaintenance: false,
      }),
    });
    const executions: string[] = [];
    const recoveries: string[] = [];
    const recoveryKeys: string[] = [];
    const recover = vi.fn(async (context: { idempotencyKey: string }) => {
      recoveries.push(context.idempotencyKey);
    });
    const update = effect(
      "customer.durable-update",
      async (input: { readonly revision: number }, context) => {
        const prepared = await store.effects.getReceipt(
          context.receiptId,
          { namespace: "tenant-a" },
        );
        expect(prepared).toMatchObject({
          receipt: {
            id: context.receiptId,
            outcome: "preparing",
          },
          executionIdempotencyKey: context.idempotencyKey,
        });
        executions.push(context.idempotencyKey);
        return { revision: input.revision };
      },
      { recover },
    );
    const updateFlow = flow("durable-update-flow", async () => {
      await update({ revision: 1 });
      await update({ revision: 2 });
      return "updated";
    });

    const completed = await updateFlow.run();
    expect(completed.status).toBe("completed");
    expect(executions).toHaveLength(2);

    const beforeRestart = await store.effects.reconstructScope(
      completed.effects,
      { namespace: "tenant-a" },
    );
    expect(beforeRestart?.plan.map((step) => step.idempotencyKey)).toEqual([
      expect.stringMatching(/^effect-recovery:/),
      expect.stringMatching(/^effect-recovery:/),
    ]);
    recoveryKeys.push(
      ...(beforeRestart?.plan.map((step) => step.idempotencyKey) ?? []),
    );

    firstRuntime.dispose();
    const restartedStore = store.testing.restart();
    const restartedRuntime = config({
      runtime: node({
        namespace: "tenant-a",
        store: restartedStore,
        autoStartMaintenance: false,
      }),
    });
    const reconstructed = await restartedStore.effects.reconstructScope(
      completed.effects,
      { namespace: "tenant-a" },
    );

    expect(reconstructed).toEqual(beforeRestart);
    expect(reconstructed?.plan.map((step) => step.effectId)).toEqual([
      "customer.durable-update",
      "customer.durable-update",
    ]);

    const firstRollback = await rollback(completed.effects);
    expect(firstRollback).toMatchObject({
      status: "completed",
      units: [{ status: "recovered" }, { status: "recovered" }],
    });
    expect(recoveries).toEqual(recoveryKeys);

    const afterRollback = await restartedStore.effects.reconstructScope(
      completed.effects,
      { namespace: "tenant-a" },
    );
    expect(afterRollback?.units.map((record) => record.unit.status)).toEqual([
      "recovered",
      "recovered",
    ]);
    expect(afterRollback?.attempts).toHaveLength(2);

    const repeatedRollback = await rollback(completed.effects);
    expect(repeatedRollback).toMatchObject({
      status: "completed",
      units: [
        { status: "already_recovered" },
        { status: "already_recovered" },
      ],
    });
    expect(recover).toHaveBeenCalledTimes(2);

    restartedRuntime.dispose();
  });
});
