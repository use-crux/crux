/** Durable Effects settlement atomicity conformance. @module */

import { expect, it } from "vitest";
import type {
  DurableEffectPreparation,
  RuntimeEffectStorePort,
} from "../ports/effects";
import type { RuntimeStoreAdapter } from "../store";
import type { RunStoreEffectAdapterTestsOptions } from "./store-types";

type EffectsStore = RuntimeStoreAdapter & {
  readonly effects: RuntimeEffectStorePort;
};

/** Register all-or-nothing execution settlement checks. */
export function runStoreEffectSettlementTests<TStore extends EffectsStore>(
  options: RunStoreEffectAdapterTestsOptions<TStore>,
  preparation: () => DurableEffectPreparation,
): void {
  it("rejects a stale envelope without partially settling execution", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));

    const running = {
      ...prepared.receipt,
      receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
      revision: 2,
    };
    await store.transact((tx) =>
      requireEffects(tx.effects).transitionReceipt({ next: running }),
    );

    const unit = requireValue(prepared.unit);
    const envelope = requireValue(prepared.envelope);
    await expect(store.transact((tx) =>
      requireEffects(tx.effects).settleExecution({
        receipt: {
          ...running,
          receipt: {
            ...running.receipt,
            outcome: "succeeded" as const,
            recovery: "available" as const,
            recoveryUnitId: unit.unit.id,
            completedAt: 2,
          },
          appendOrder: 1,
          revision: 3,
        },
        unit: {
          ...unit,
          unit: { ...unit.unit, status: "active" as const },
          appendOrder: 1,
          revision: 2,
        },
        envelope: { ...envelope, revision: 3 },
      }),
    )).resolves.toBeNull();

    await expect(store.effects.reconstructScope(prepared.scope.scope.ref, {
      namespace: "tenant-a",
    })).resolves.toMatchObject({
      receipts: [{ receipt: { outcome: "unknown" }, revision: 2 }],
      units: [{ unit: { status: "prepared" }, revision: 1 }],
      envelopes: [{ revision: 1 }],
    });
  });
}

function requireEffects(
  port: RuntimeEffectStorePort | undefined,
): RuntimeEffectStorePort {
  return requireValue(port);
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Effects value is missing.");
  return value;
}
