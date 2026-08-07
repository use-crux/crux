/** In-memory durable Effect envelope retention. @internal @module */

import type { RuntimeEffectPruneOptions } from "../../ports/effects";
import type { RuntimePruneResult } from "../../ports/retention";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { cloneRecord, put, valuesForNamespace } from "./effect-records";
import { scopedKey } from "./data";

/** Prune expired envelopes and retain their receipts with expired availability. */
export function pruneMemoryEffectEnvelopes(
  data: MemoryRuntimeData,
  options: RuntimeEffectPruneOptions,
  recordWrite?: MemoryWriteRecorder,
): RuntimePruneResult {
  const envelopes = options.namespace
    ? valuesForNamespace(data.effectEnvelopes, options.namespace)
    : [...data.effectEnvelopes.values()];
  const eligible = envelopes
    .filter((record) => {
      const explicitExpiry = record.envelope?.expiresAt;
      if (explicitExpiry !== undefined) {
        return explicitExpiry <= options.now.getTime();
      }
      const createdAt = record.envelope?.createdAt;
      return createdAt !== undefined && createdAt < options.before.getTime();
    })
    .sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  const selected = eligible.slice(0, options.limit);
  for (const envelope of selected) {
    const key = scopedKey(envelope.namespace, envelope.receiptId);
    const receipt = data.effectReceipts.get(key);
    if (receipt && receipt.receipt.recovery !== "recovered") {
      put(
        data.effectReceipts,
        key,
        cloneRecord({
          ...receipt,
          receipt: { ...receipt.receipt, recovery: "expired" as const },
          revision: receipt.revision + 1,
        }),
        recordWrite,
      );
    }
    recordWrite?.();
    data.effectEnvelopes.delete(key);
  }
  return {
    removed: selected.length,
    truncated: eligible.length > selected.length,
  };
}
