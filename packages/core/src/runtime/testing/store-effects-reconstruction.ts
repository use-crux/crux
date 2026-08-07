/** Deep durable Effects reconstruction conformance. @module */

import { expect, it } from "vitest";
import type {
  DurableEffectPreparation,
  RuntimeEffectStorePort,
} from "../ports/effects";
import type { RuntimeStoreAdapter } from "../store";
import type { RunStoreAdapterTestsOptions } from "./store-types";

type EffectsStore = RuntimeStoreAdapter & {
  readonly effects: RuntimeEffectStorePort;
};

/** Register nested, native, repeated, and partial-resume reconstruction cases. */
export function runStoreEffectReconstructionTests<TStore extends EffectsStore>(
  options: RunStoreAdapterTestsOptions<TStore>,
): void {
  it("reconstructs recovered child boundaries as parent plan units", async () => {
    const store = await options.createStore();
    const parent = scope("scope-parent", "run-1");
    const child = scope("scope-child", "run-1");
    const childEffect = preparation({
      scope: child,
      parentId: parent.id,
      receiptId: "receipt-child",
      unitId: "unit-child",
      effectId: "customer.child-update",
      executionKey: "effect-execution:child",
      recoveryKey: "effect-recovery:child",
      outcome: "succeeded",
      recovery: "available",
      unitStatus: "active",
      appendOrder: 1,
    });
    const parentBoundary = preparation({
      scope: parent,
      receiptId: "receipt-parent-marker",
      unitId: "effect-boundary-unit:scope-child",
      effectId: "customer.child-update",
      executionKey: "effect-execution:parent-marker",
      recoveryKey: "effect-boundary-recovery:scope-child",
      unitKind: "boundary",
      childScope: child,
      unitStatus: "recovered",
      appendOrder: 1,
    });
    await store.transact(async (tx) => {
      await requireEffects(tx.effects).prepare(childEffect);
      await requireEffects(tx.effects).prepare(parentBoundary);
    });

    const childSnapshot = await store.effects.reconstructScope(child, {
      namespace: "tenant-a",
    });
    const parentSnapshot = await store.effects.reconstructScope(parent, {
      namespace: "tenant-a",
    });

    expect(childSnapshot?.plan).toEqual([
      expect.objectContaining({
        kind: "effect",
        receiptId: "receipt-child",
        idempotencyKey: "effect-recovery:child",
      }),
    ]);
    expect(parentSnapshot?.plan).toEqual([
      expect.objectContaining({
        kind: "boundary",
        unitId: "effect-boundary-unit:scope-child",
        scope: child,
        status: "already_recovered",
      }),
    ]);
  });

  it("keeps native audit-first receipts in the reconstructed plan", async () => {
    const store = await options.createStore();
    const boundary = scope("scope-native", "run-native");
    await store.transact((tx) =>
      requireEffects(tx.effects).prepare(preparation({
        scope: boundary,
        receiptId: "receipt-native",
        effectId: "workspace.native-write",
        executionKey: "effect-execution:native",
        outcome: "succeeded",
        recovery: "irreversible",
        effectKind: "native",
        nativePrimitive: "workspace.commit",
        receiptAppendOrder: 1,
      })),
    );

    const snapshot = await store.effects.reconstructScope(boundary, {
      namespace: "tenant-a",
    });

    expect(snapshot?.plan).toEqual([
      expect.objectContaining({
        kind: "effect",
        receiptId: "receipt-native",
        effectId: "workspace.native-write",
        status: "irreversible",
      }),
    ]);
  });

  it("preserves occurrence-repeat keys in reverse plan order", async () => {
    const store = await options.createStore();
    const boundary = scope("scope-repeat", "run-repeat");
    await store.transact(async (tx) => {
      await requireEffects(tx.effects).prepare(recoverablePreparation({
        boundary,
        suffix: "1",
        appendOrder: 1,
      }));
      await requireEffects(tx.effects).prepare(recoverablePreparation({
        boundary,
        suffix: "2",
        appendOrder: 2,
      }));
    });

    const snapshot = await store.effects.reconstructScope(boundary, {
      namespace: "tenant-a",
    });

    expect(snapshot?.plan.map((step) => step.idempotencyKey)).toEqual([
      "effect-recovery:repeat:2",
      "effect-recovery:repeat:1",
    ]);
    expect(snapshot?.receipts.map(
      (record) => record.executionIdempotencyKey,
    )).toEqual([
      "effect-execution:repeat:1",
      "effect-execution:repeat:2",
    ]);
  });

  it("projects settled units as already recovered on partial resume", async () => {
    const store = await options.createStore();
    const boundary = scope("scope-partial", "run-partial");
    await store.transact(async (tx) => {
      await requireEffects(tx.effects).prepare(recoverablePreparation({
        boundary,
        suffix: "failed",
        appendOrder: 1,
        unitStatus: "failed",
      }));
      await requireEffects(tx.effects).prepare(recoverablePreparation({
        boundary,
        suffix: "recovered",
        appendOrder: 2,
        unitStatus: "recovered",
      }));
    });

    const snapshot = await store.effects.reconstructScope(boundary, {
      namespace: "tenant-a",
    });

    expect(snapshot?.plan.map((step) => step.status)).toEqual([
      "already_recovered",
      "failed",
    ]);
  });
}

function recoverablePreparation(options: {
  readonly boundary: ReturnType<typeof scope>;
  readonly suffix: string;
  readonly appendOrder: number;
  readonly unitStatus?: "active" | "failed" | "recovered";
}): DurableEffectPreparation {
  return preparation({
    scope: options.boundary,
    receiptId: `receipt-repeat-${options.suffix}`,
    unitId: `unit-repeat-${options.suffix}`,
    effectId: "customer.repeated-update",
    executionKey: `effect-execution:repeat:${options.suffix}`,
    recoveryKey: `effect-recovery:repeat:${options.suffix}`,
    outcome: "succeeded",
    recovery: "available",
    unitStatus: options.unitStatus ?? "active",
    appendOrder: options.appendOrder,
  });
}

interface PreparationOptions {
  readonly scope: ReturnType<typeof scope>;
  readonly parentId?: string;
  readonly receiptId: string;
  readonly unitId?: string;
  readonly effectId: string;
  readonly executionKey: string;
  readonly recoveryKey?: string;
  readonly outcome?: "preparing" | "succeeded";
  readonly recovery?: "unavailable" | "available" | "irreversible";
  readonly unitKind?: "effect" | "boundary";
  readonly childScope?: ReturnType<typeof scope>;
  readonly unitStatus?: "prepared" | "active" | "recovered" | "failed";
  readonly appendOrder?: number;
  readonly receiptAppendOrder?: number;
  readonly effectKind?: "custom" | "native";
  readonly nativePrimitive?: string;
}

function preparation(options: PreparationOptions): DurableEffectPreparation {
  const unit = options.unitId
    ? {
        namespace: "tenant-a",
        kind: options.unitKind ?? "effect",
        unit: {
          id: options.unitId,
          boundaryId: options.scope.id,
          receiptIds: options.childScope ? ["receipt-child"] : [options.receiptId],
          effectIds: [options.effectId],
          status: options.unitStatus ?? "prepared",
          idempotencyKey: requireValue(options.recoveryKey),
        },
        ...(options.childScope ? { scope: options.childScope } : {}),
        effectVersion: 1,
        ...(options.appendOrder === undefined
          ? {}
          : { appendOrder: options.appendOrder }),
        revision: 1,
      }
    : undefined;
  return {
    scope: {
      namespace: "tenant-a",
      scope: {
        ref: options.scope,
        ...(options.parentId ? { parentId: options.parentId } : {}),
        status: "open",
        unitIds: unit ? [unit.unit.id] : [],
      },
      revision: 1,
    },
    receipt: {
      namespace: "tenant-a",
      receipt: {
        kind: "effect.receipt",
        schemaVersion: 1,
        id: options.receiptId,
        effectId: options.effectId,
        effectVersion: 1,
        effectKind: options.effectKind ?? "custom",
        ...(options.nativePrimitive
          ? { nativePrimitive: options.nativePrimitive }
          : {}),
        scopeId: options.scope.id,
        boundaryId: options.scope.id,
        runId: options.scope.runId,
        attemptCount: 1,
        outcome: options.outcome ?? "preparing",
        recovery: options.recovery ?? "unavailable",
        ...(options.unitId ? { recoveryUnitId: options.unitId } : {}),
        startedAt: 1,
        ...(options.outcome === "succeeded" ? { completedAt: 2 } : {}),
      },
      executionIdempotencyKey: options.executionKey,
      ...(options.receiptAppendOrder === undefined
        ? {}
        : { appendOrder: options.receiptAppendOrder }),
      revision: 1,
    },
    ...(unit ? { unit } : {}),
  };
}

function scope(id: string, runId: string) {
  return Object.freeze({ kind: "effect.scope" as const, id, runId });
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
