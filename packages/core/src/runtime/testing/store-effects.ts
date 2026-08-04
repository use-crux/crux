/** Shared durable Effects store conformance seed. @module */

import { describe, expect, it } from "vitest";
import type {
  DurableEffectPreparation,
  RuntimeEffectStorePort,
} from "../ports/effects";
import type { RuntimeStoreAdapter } from "../store";
import { requireFaultHook } from "./store-composite-case-utils";
import { runStoreEffectCrashTests } from "./store-effects-crash";
import { runStoreEffectReconstructionTests } from "./store-effects-reconstruction";
import { runStoreEffectSettlementTests } from "./store-effects-settlement";
import { runStoreEffectTransitionTests } from "./store-effects-transitions";
import type {
  RunStoreEffectAdapterTestsOptions,
  StoreEffectCapability,
} from "./store-types";

type EffectsStore = RuntimeStoreAdapter & {
  readonly effects: RuntimeEffectStorePort;
};

/**
 * Register durable Effect record and transaction invariants for one adapter.
 *
 * @param options - Adapter factory and optional transaction fault controls.
 * @returns Nothing; tests are registered with the active Vitest suite.
 */
export function runStoreEffectAdapterTests<TStore extends EffectsStore>(
  options: RunStoreEffectAdapterTestsOptions<TStore>,
): void {
  describe(`${options.name} durable Effects conformance`, () => {
    registerCapabilityDeclaration(
      "atomic Effect operations",
      options.effectCapabilities.atomicOperations,
    );
    registerCapabilityDeclaration(
      "multi-operation Effect transactions",
      options.effectCapabilities.multiOperationTransactions,
    );
    registerCapabilityDeclaration(
      "Effect crash fencing",
      options.effectCapabilities.crashFencing,
    );
    registerCapabilityDeclaration(
      "Effect reconstruction",
      options.effectCapabilities.reconstruction,
    );

    it.runIf(isSupported(options.effectCapabilities.atomicOperations))(
      "persists atomic preparation and guarded settlement",
      async () => {
      const store = await options.createStore();
      const prepared = preparation();
      await store.transact(async (tx) => {
        await requireEffects(tx.effects).prepare(prepared);
      });

      await expect(
        store.effects.getReceipt("receipt-1", { namespace: "tenant-a" }),
      ).resolves.toMatchObject({
        receipt: { outcome: "preparing" },
        executionIdempotencyKey: "effect-execution:1",
      });
      await expect(
        store.effects.getReceipt("receipt-1", { namespace: "tenant-b" }),
      ).resolves.toBeNull();

      const conflictingReplay = {
        ...prepared,
        receipt: {
          ...prepared.receipt,
          executionIdempotencyKey: "effect-execution:conflict",
        },
      };
      await expect(
        store.transact((tx) =>
          requireEffects(tx.effects).prepare(conflictingReplay),
        ),
      ).resolves.toMatchObject({
        receipt: { executionIdempotencyKey: "effect-execution:1" },
      });

      const illegalSettlement = {
        ...prepared.receipt,
        receipt: {
          ...prepared.receipt.receipt,
          outcome: "succeeded" as const,
          completedAt: 2,
        },
        revision: 2,
      };
      await expect(
        store.effects.transitionReceipt({ next: illegalSettlement }),
      ).resolves.toBeNull();

      const running = {
        ...prepared.receipt,
        receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
        revision: 2,
      };
      await expect(
        store.transact((tx) =>
          requireEffects(tx.effects).transitionReceipt({ next: running }),
        ),
      ).resolves.toMatchObject({ receipt: { outcome: "running" } });

      const preparedEnvelope = requireValue(
        requireValue(prepared.envelope).envelope,
      );
      const succeeded = {
        receipt: {
          ...running,
          receipt: {
            ...running.receipt,
            outcome: "succeeded" as const,
            recovery: "available" as const,
            recoveryUnitId: "unit-1",
            completedAt: 2,
          },
          revision: 3,
        },
        unit: {
          ...requireValue(prepared.unit),
          unit: { ...requireValue(prepared.unit).unit, status: "active" as const },
          appendOrder: 1,
          revision: 2,
        },
        envelope: {
          ...requireValue(prepared.envelope),
          envelope: {
            ...preparedEnvelope,
            output: { revision: 1 },
          },
          revision: 2,
        },
      };
      await expect(
        store.transact((tx) =>
          requireEffects(tx.effects).settleExecution(succeeded),
        ),
      ).resolves.toMatchObject({ unit: { unit: { status: "active" } } });

      const snapshot = await store.effects.reconstructScope(
        prepared.scope.scope.ref,
        { namespace: "tenant-a" },
      );
      expect(snapshot?.plan).toEqual([
        expect.objectContaining({
          receiptId: "receipt-1",
          idempotencyKey: "effect-recovery:1",
        }),
      ]);
      await expect(
        store.effects.transitionReceipt({ next: succeeded.receipt }),
      ).resolves.toBeNull();
      },
    );

    it.runIf(
      isSupported(options.effectCapabilities.multiOperationTransactions),
    )(
      "rolls back partial Effect preparation",
      async () => {
        const store = await options.createStore();
        requireFaultHook(options.failAfterWrites)(store, 1);
        await expect(
          store.transact(async (tx) => {
            await requireEffects(tx.effects).prepare(preparation());
          }),
        ).rejects.toThrow("Injected transaction failure");
        await expect(
          store.effects.getReceipt("receipt-1", { namespace: "tenant-a" }),
        ).resolves.toBeNull();
      },
    );

    if (isSupported(options.effectCapabilities.crashFencing)) {
      runStoreEffectCrashTests(options, preparation);
    }
    if (isSupported(options.effectCapabilities.atomicOperations)) {
      runStoreEffectSettlementTests(options, preparation);
      runStoreEffectTransitionTests(options, preparation);
    }
    if (isSupported(options.effectCapabilities.reconstruction)) {
      runStoreEffectReconstructionTests(options);
    }
  });
}

function registerCapabilityDeclaration(
  name: string,
  capability: StoreEffectCapability,
): void {
  it(`declares ${name} ${capability.support}`, () => {
    expect(capability.support).toMatch(/^(supported|unsupported)$/);
    if (capability.support === "unsupported") {
      expect(capability.reason.trim().length).toBeGreaterThan(0);
    }
  });
}

function isSupported(capability: StoreEffectCapability): boolean {
  return capability.support === "supported";
}

function preparation(): DurableEffectPreparation {
  const scope = Object.freeze({
    kind: "effect.scope" as const,
    id: "scope-1",
    runId: "run-1",
  });
  return {
    scope: {
      namespace: "tenant-a",
      scope: { ref: scope, status: "open", unitIds: ["unit-1"] },
      revision: 1,
    },
    receipt: {
      namespace: "tenant-a",
      receipt: {
        kind: "effect.receipt",
        schemaVersion: 1,
        id: "receipt-1",
        effectId: "customer.update",
        effectVersion: 1,
        effectKind: "custom",
        scopeId: "scope-1",
        boundaryId: "scope-1",
        runId: "run-1",
        attemptCount: 1,
        outcome: "preparing",
        recovery: "unavailable",
        startedAt: 1,
      },
      executionIdempotencyKey: "effect-execution:1",
      revision: 1,
    },
    unit: {
      namespace: "tenant-a",
      kind: "effect",
      unit: {
        id: "unit-1",
        boundaryId: "scope-1",
        receiptIds: ["receipt-1"],
        effectIds: ["customer.update"],
        status: "prepared",
        idempotencyKey: "effect-recovery:1",
      },
      effectVersion: 1,
      revision: 1,
    },
    envelope: {
      namespace: "tenant-a",
      receiptId: "receipt-1",
      durable: true,
      envelope: {
        schemaVersion: 1,
        receiptId: "receipt-1",
        effectId: "customer.update",
        effectVersion: 1,
        input: { revision: 1 },
        createdAt: 1,
      },
      revision: 1,
    },
  };
}

function requireEffects(
  port: RuntimeEffectStorePort | undefined,
): RuntimeEffectStorePort {
  return requireValue(port);
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Effects store value is missing.");
  return value;
}
