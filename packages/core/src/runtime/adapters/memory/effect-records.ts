/** Memory Effect record cloning and lookup helpers. @internal @module */

import type {
  DurableEffectPreparation,
  DurableEffectReceiptRecord,
} from "../../../effect/internal/durable-records";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

export function preparationForExisting(
  data: MemoryRuntimeData,
  requested: DurableEffectPreparation,
  receipt: DurableEffectReceiptRecord,
): DurableEffectPreparation {
  const scope = data.effectScopes.get(
    scopedKey(requested.scope.namespace, requested.scope.scope.ref.id),
  );
  if (!scope) throw new TypeError("Durable Effect scope is missing.");
  const unit = requested.unit
    ? data.effectUnits.get(
        scopedKey(requested.unit.namespace, requested.unit.unit.id),
      )
    : undefined;
  const envelope = requested.envelope
    ? data.effectEnvelopes.get(
        scopedKey(requested.envelope.namespace, requested.envelope.receiptId),
      )
    : undefined;
  return cloneRecord({ scope, receipt, unit, envelope });
}

export function valuesForNamespace<T extends { readonly namespace: string }>(
  records: Map<string, T>,
  namespace: string,
): T[] {
  return [...records.values()].filter((record) => record.namespace === namespace);
}

export function put<K, V>(
  records: Map<K, V>,
  key: K,
  value: V,
  recordWrite?: MemoryWriteRecorder,
): void {
  recordWrite?.();
  records.set(key, value);
}

export function cloneOptional<T>(value: T | undefined): T | null {
  return value === undefined ? null : cloneRecord(value);
}

export function cloneRecord<T>(value: T): T {
  return Object.freeze(structuredClone(value)) as T;
}
