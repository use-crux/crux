import { afterEach, describe, expect, it, vi } from "vitest";
import { config, effect, flow } from "@use-crux/core";
import { reconcileEffect, rollback } from "@use-crux/core/effect";
import type { EffectReceiptRef } from "@use-crux/core/effect";
import {
  createRuntimeProgram,
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
    const program = createRuntimeProgram({
      targets: [],
      transports: [],
      effectTargets: [update],
    });
    const firstRuntime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        program,
        autoStartMaintenance: false,
      }),
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
        program,
        autoStartMaintenance: false,
      }),
    });
    const reconstructed = await restartedStore.effects.reconstructScope(
      completed.effects,
      { namespace: "tenant-a" },
    );

    expect(reconstructed).toEqual(beforeRestart);
    expect(reconstructed?.plan.flatMap((step) =>
      step.kind === "effect" ? [step.effectId] : [])).toEqual([
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

  it("reconciles recovery success after settlement is interrupted", async () => {
    const store = inMemoryRuntimeStore();
    const receiptIds: string[] = [];
    const recover = vi.fn(async () => {
      store.testing.failAfter(0);
    });
    const update = effect(
      "customer.interrupted-recovery",
      async (_input: undefined, context) => {
        receiptIds.push(context.receiptId);
        return "done";
      },
      { recover },
    );
    const updateFlow = flow("interrupted-recovery-flow", async () => {
      await update();
    });
    const program = createRuntimeProgram({
      targets: [],
      transports: [],
      effectTargets: [update],
    });
    const firstRuntime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        program,
        autoStartMaintenance: false,
      }),
    });

    const completed = await updateFlow.run();
    const receipt: EffectReceiptRef = {
      kind: "effect.receipt",
      id: requireValue(receiptIds[0]),
      effectId: "customer.interrupted-recovery",
    };
    await expect(rollback(completed.effects)).rejects.toThrow();
    firstRuntime.dispose();

    const restartedStore = store.testing.restart();
    const restartedRuntime = config({
      runtime: node({
        namespace: "tenant-a",
        store: restartedStore,
        program,
        autoStartMaintenance: false,
      }),
    });
    const interrupted = await restartedStore.effects.reconstructScope(
      completed.effects,
      { namespace: "tenant-a" },
    );
    const attempt = interrupted?.receipts.find(
      (record) => record.receipt.parentReceiptId === receipt.id,
    );

    expect(attempt?.receipt.outcome).toBe("unknown");
    expect(
      interrupted?.receipts.find(
        (record) => record.receipt.id === receipt.id,
      )?.receipt.recovery,
    ).toBe("ambiguous");
    expect(interrupted?.reconciliationRequired).toEqual([
      expect.objectContaining({
        kind: "recovery",
        receiptId: attempt?.receipt.id,
        originalReceiptId: receipt.id,
        state: "unknown",
      }),
    ]);
    await expect(rollback(completed.effects)).resolves.toMatchObject({
      status: "not_possible",
      units: [{ status: "ambiguous" }],
    });
    expect(recover).toHaveBeenCalledOnce();

    await expect(
      reconcileEffect(receipt, {
        outcome: "succeeded",
        output: null,
        reason: "The provider confirms compensation completed",
      }),
    ).resolves.toMatchObject({ recovery: "recovered" });

    const reconciled = await restartedStore.effects.reconstructScope(
      completed.effects,
      { namespace: "tenant-a" },
    );
    expect(reconciled).toMatchObject({
      attempts: [expect.objectContaining({ attemptReceiptId: attempt?.receipt.id })],
      reconciliations: [
        expect.objectContaining({
          receiptId: attempt?.receipt.id,
          outcome: "succeeded",
        }),
      ],
    });
    expect(reconciled?.units[0]?.unit.status).toBe("recovered");
    await expect(rollback(completed.effects)).resolves.toMatchObject({
      units: [{ status: "already_recovered" }],
    });
    expect(recover).toHaveBeenCalledOnce();
    restartedRuntime.dispose();
  });
});

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Expected value is unavailable.");
  return value;
}
