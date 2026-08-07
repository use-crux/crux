import { afterEach, describe, expect, it, vi } from "vitest";
import { config, effect } from "@use-crux/core";
import { recover } from "@use-crux/core/effect";
import type {
  RuntimeEffectStorePort,
  RuntimeStoreAdapter,
  RuntimeStoreTransaction,
} from "@use-crux/core/runtime";
import {
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";
import { resetHooks } from "../src/runtime/runtime";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetHooks();
});

describe("durable Effect retention races", () => {
  it.each(["transitionReceipt", "settleExecution"] as const)(
    "preserves expiry when pruning races with %s",
    async (operation) => {
      const base = inMemoryRuntimeStore();
      const store = withExpiryRace(base, operation);
      const recovery = vi.fn(async () => undefined);
      const update = effect(
        `customer.expiry-${operation}`,
        async () => "updated",
        { recover: recovery },
      );
      const runtime = config({
        runtime: node({
          namespace: "tenant-a",
          store,
          program: createRuntimeProgram({
            targets: [],
            transports: [],
            effectTargets: [update],
          }),
          autoStartMaintenance: false,
        }),
      });

      try {
        const result = await update.run();
        const receipt = await base.effects.getReceipt(result.receipt.id, {
          namespace: "tenant-a",
        });
        expect(receipt?.receipt).toMatchObject({
          outcome: "succeeded",
          recovery: "expired",
        });
        const snapshot = await base.effects.reconstructScope(
          {
            kind: "effect.scope",
            id: receipt!.receipt.boundaryId,
            runId: receipt!.receipt.runId!,
          },
          { namespace: "tenant-a" },
        );
        expect(snapshot?.envelopes).toEqual([]);
        expect(snapshot?.units).toEqual([
          expect.objectContaining({
            unit: expect.objectContaining({ status: "failed" }),
          }),
        ]);
        await expect(recover(result.receipt)).resolves.toMatchObject({
          status: "unavailable",
        });
        expect(recovery).not.toHaveBeenCalled();
      } finally {
        runtime.dispose();
      }
    },
  );

  it("preserves a marked process-local envelope during durable refresh", async () => {
    const store = inMemoryRuntimeStore();
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.process-local-envelope",
      async (input: Map<string, string>) => input.size,
      { recover: recovery },
    );
    const runtime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [update],
        }),
        autoStartMaintenance: false,
      }),
    });

    try {
      const result = await update.run(new Map([["customer", "active"]]));
      await expect(recover(result.receipt)).resolves.toMatchObject({
        status: "recovered",
      });
      expect(recovery).toHaveBeenCalledOnce();
    } finally {
      runtime.dispose();
    }
  });
});

function withExpiryRace(
  base: RuntimeStoreAdapter & { readonly effects: RuntimeEffectStorePort },
  operation: "transitionReceipt" | "settleExecution",
): RuntimeStoreAdapter {
  let pending = true;
  const expire = async (): Promise<void> => {
    if (!pending) return;
    pending = false;
    await base.effects.prune({
      namespace: "tenant-a",
      before: new Date(Date.now() + 60_000),
      now: new Date(),
      limit: 1,
    });
  };
  const effects: RuntimeEffectStorePort = {
    ...base.effects,
    async transitionReceipt(value) {
      if (operation === "transitionReceipt") await expire();
      return base.effects.transitionReceipt(value);
    },
    async settleExecution(value) {
      if (operation === "settleExecution") await expire();
      return base.effects.settleExecution(value);
    },
  };
  const transaction: RuntimeStoreTransaction = { ...base, effects };
  return {
    ...base,
    effects,
    transact: async <T>(
      run: (tx: RuntimeStoreTransaction) => Promise<T>,
    ): Promise<T> => run(transaction),
  };
}
