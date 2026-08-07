/** In-memory durable Effect recovery claims and reconstruction. @internal @module */

import type {
  DurableEffectRecoveryClaim,
  DurableEffectScopeSnapshot,
} from "../../../effect/internal/durable-records";
import { reconstructDurableEffectScope } from "../../../effect/internal/durable-state-machine";
import type { EffectScopeRef } from "../../../effect/types";
import type {
  RuntimeEffectRecoveryClaimOptions,
  RuntimeEffectRecoveryRelease,
} from "../../ports/effects";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import { cloneRecord, put, valuesForNamespace } from "./effect-records";

export function claimMemoryEffectRecovery(
  data: MemoryRuntimeData,
  options: RuntimeEffectRecoveryClaimOptions,
  recordWrite?: MemoryWriteRecorder,
): readonly DurableEffectRecoveryClaim[] {
  const expiresAt = options.now.getTime() + options.leaseMs;
  const claimed: DurableEffectRecoveryClaim[] = [];
  const candidates = valuesForNamespace(data.effectScopes, options.namespace)
    .sort((left, right) => left.scope.ref.id.localeCompare(right.scope.ref.id));
  for (const candidate of candidates) {
    if (claimed.length >= options.limit) break;
    if (
      candidate.scope.status !== "rolling_back" ||
      (candidate.recoveryLeaseExpiresAt ?? 0) > options.now.getTime()
    ) continue;
    const snapshot = reconstructMemoryEffectScope(
      data,
      candidate.scope.ref,
      options.namespace,
    );
    if (!snapshot || !hasPendingRecovery(snapshot)) continue;
    const scope = cloneRecord({
      ...candidate,
      fenceToken: options.leaseToken,
      recoveryLeaseExpiresAt: expiresAt,
      ...(options.ownerId ? { recoveryOwnerId: options.ownerId } : {}),
      revision: candidate.revision + 1,
    });
    put(
      data.effectScopes,
      scopedKey(options.namespace, candidate.scope.ref.id),
      scope,
      recordWrite,
    );
    fenceScopeRecords(
      data,
      options.namespace,
      candidate.scope.ref.id,
      options.leaseToken,
      recordWrite,
    );
    fenceNestedRecoveryScopes(
      data,
      snapshot,
      expiresAt,
      options.leaseToken,
      options.ownerId,
      recordWrite,
    );
    const fenced = reconstructMemoryEffectScope(
      data,
      candidate.scope.ref,
      options.namespace,
    );
    if (!fenced) continue;
    claimed.push(Object.freeze({
      scope: candidate.scope.ref,
      leaseToken: options.leaseToken,
      expiresAt,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      snapshot: fenced,
    }));
  }
  return Object.freeze(claimed);
}

export function releaseMemoryEffectRecovery(
  data: MemoryRuntimeData,
  release: RuntimeEffectRecoveryRelease,
  recordWrite?: MemoryWriteRecorder,
): boolean {
  const key = scopedKey(release.namespace, release.scope.id);
  const current = data.effectScopes.get(key);
  if (
    !current ||
    current.scope.ref.runId !== release.scope.runId ||
    current.fenceToken !== release.leaseToken
  ) return false;
  put(data.effectScopes, key, cloneRecord({
    ...current,
    recoveryLeaseExpiresAt: release.now.getTime(),
    revision: current.revision + 1,
  }), recordWrite);
  return true;
}

export function reconstructMemoryEffectScope(
  data: MemoryRuntimeData,
  scope: EffectScopeRef,
  namespace: string,
): DurableEffectScopeSnapshot | null {
  const scopeRecord = data.effectScopes.get(scopedKey(namespace, scope.id));
  if (!scopeRecord || scopeRecord.scope.ref.runId !== scope.runId) return null;
  const receipts = valuesForNamespace(data.effectReceipts, namespace)
    .filter((record) => record.receipt.boundaryId === scope.id);
  const units = valuesForNamespace(data.effectUnits, namespace)
    .filter((record) => record.unit.boundaryId === scope.id);
  const receiptIds = new Set(receipts.map((record) => record.receipt.id));
  const unitIds = new Set(units.map((record) => record.unit.id));
  return reconstructDurableEffectScope(scope, {
    scope: cloneRecord(scopeRecord),
    receipts: receipts.map(cloneRecord),
    units: units.map(cloneRecord),
    envelopes: valuesForNamespace(data.effectEnvelopes, namespace)
      .filter((record) => receiptIds.has(record.receiptId)).map(cloneRecord),
    attempts: valuesForNamespace(data.effectAttempts, namespace)
      .filter((record) => unitIds.has(record.unitId)).map(cloneRecord),
    reconciliations: [...receiptIds].flatMap((receiptId) =>
      (data.effectReconciliations.get(scopedKey(namespace, receiptId)) ?? [])
        .map(cloneRecord)),
  });
}

function hasPendingRecovery(snapshot: DurableEffectScopeSnapshot): boolean {
  return snapshot.plan.some(
    (step) => step.status === "active" || step.status === "failed",
  );
}

function fenceScopeRecords(
  data: MemoryRuntimeData,
  namespace: string,
  scopeId: string,
  fenceToken: string,
  recordWrite?: MemoryWriteRecorder,
): void {
  const unitIds = new Set<string>();
  for (const [key, receipt] of data.effectReceipts) {
    if (receipt.namespace !== namespace || receipt.receipt.boundaryId !== scopeId) continue;
    put(data.effectReceipts, key, cloneRecord({
      ...receipt, fenceToken, revision: receipt.revision + 1,
    }), recordWrite);
  }
  for (const [key, unit] of data.effectUnits) {
    if (unit.namespace !== namespace || unit.unit.boundaryId !== scopeId) continue;
    unitIds.add(unit.unit.id);
    put(data.effectUnits, key, cloneRecord({
      ...unit, fenceToken, revision: unit.revision + 1,
    }), recordWrite);
  }
  for (const [key, attempt] of data.effectAttempts) {
    if (attempt.namespace !== namespace || !unitIds.has(attempt.unitId)) continue;
    put(data.effectAttempts, key, cloneRecord({
      ...attempt, fenceToken, revision: attempt.revision + 1,
    }), recordWrite);
  }
}

function fenceNestedRecoveryScopes(
  data: MemoryRuntimeData,
  snapshot: DurableEffectScopeSnapshot,
  expiresAt: number,
  fenceToken: string,
  ownerId: string | undefined,
  recordWrite: MemoryWriteRecorder | undefined,
): void {
  for (const step of snapshot.plan) {
    if (step.kind !== "boundary") continue;
    const key = scopedKey(snapshot.scopeRecord.namespace, step.scope.id);
    const current = data.effectScopes.get(key);
    if (!current || current.scope.ref.runId !== step.scope.runId) continue;
    put(data.effectScopes, key, cloneRecord({
      ...current,
      fenceToken,
      recoveryLeaseExpiresAt: expiresAt,
      ...(ownerId ? { recoveryOwnerId: ownerId } : {}),
      revision: current.revision + 1,
    }), recordWrite);
    fenceScopeRecords(
      data,
      snapshot.scopeRecord.namespace,
      step.scope.id,
      fenceToken,
      recordWrite,
    );
    const child = reconstructMemoryEffectScope(
      data,
      step.scope,
      snapshot.scopeRecord.namespace,
    );
    if (child) {
      fenceNestedRecoveryScopes(
        data, child, expiresAt, fenceToken, ownerId, recordWrite,
      );
    }
  }
}
