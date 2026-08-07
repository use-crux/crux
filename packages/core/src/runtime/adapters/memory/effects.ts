/** In-memory durable Effect record port. @internal @module */

import {
  durableTransitionMatches,
  isDurableReceiptTransition,
  isDurableRecoveryUnavailableReceiptTransition,
  isDurableRecoveryUnavailableUnitTransition,
  isDurableScopeTransition,
  isDurableUnitTransition,
} from "../../../effect/internal/durable-state-machine";
import type { RuntimeEffectStorePort } from "../../ports/effects";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import {
  cloneOptional,
  cloneRecord,
  preparationForExisting,
  put,
  reconcileMemoryEffects,
  synchronizeMemoryEffectScope,
} from "./effect-records";
import { pruneMemoryEffectEnvelopes } from "./effect-retention";
import {
  claimMemoryEffectRecovery,
  reconstructMemoryEffectScope,
  releaseMemoryEffectRecovery,
} from "./effect-claims";

/** Construct the transaction-bound Effects port over one memory data view. */
export function createMemoryEffectStore(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeEffectStorePort {
  return {
    claimRecoveryScopes: (options) =>
      Promise.resolve(claimMemoryEffectRecovery(data, options, recordWrite)),

    releaseRecoveryScope: (release) =>
      Promise.resolve(releaseMemoryEffectRecovery(data, release, recordWrite)),

    async getReceipt(receiptId, options) {
      return cloneOptional(
        data.effectReceipts.get(scopedKey(options.namespace, receiptId)),
      );
    },

    async prepare(preparation) {
      const receiptKey = scopedKey(
        preparation.receipt.namespace,
        preparation.receipt.receipt.id,
      );
      const existingReceipt = data.effectReceipts.get(receiptKey);
      if (existingReceipt) {
        return preparationForExisting(data, preparation, existingReceipt);
      }

      const scopeKey = scopedKey(
        preparation.scope.namespace,
        preparation.scope.scope.ref.id,
      );
      const currentScope = data.effectScopes.get(scopeKey);
      const scope = currentScope
        ? cloneRecord({
            ...currentScope,
            scope: {
              ...currentScope.scope,
              unitIds: preparation.scope.scope.unitIds,
            },
            revision: currentScope.revision + 1,
          })
        : cloneRecord({ ...preparation.scope, revision: 1 });
      const receipt = cloneRecord({ ...preparation.receipt, revision: 1 });
      const unit = preparation.unit
        ? cloneRecord({ ...preparation.unit, revision: 1 })
        : undefined;
      const envelope = preparation.envelope
        ? cloneRecord({ ...preparation.envelope, revision: 1 })
        : undefined;

      put(data.effectScopes, scopeKey, scope, recordWrite);
      put(data.effectReceipts, receiptKey, receipt, recordWrite);
      if (unit) {
        put(
          data.effectUnits,
          scopedKey(unit.namespace, unit.unit.id),
          unit,
          recordWrite,
        );
      }
      if (envelope) {
        put(
          data.effectEnvelopes,
          scopedKey(envelope.namespace, envelope.receiptId),
          envelope,
          recordWrite,
        );
      }
      return cloneRecord({ scope, receipt, unit, envelope });
    },

    async transitionReceipt({ next }) {
      const key = scopedKey(next.namespace, next.receipt.id);
      const current = data.effectReceipts.get(key);
      if (
        !current ||
        !durableTransitionMatches(current, next) ||
        !isDurableReceiptTransition(
          current.receipt.outcome,
          next.receipt.outcome,
        )
      ) {
        return null;
      }
      const stored = cloneRecord(next);
      put(data.effectReceipts, key, stored, recordWrite);
      return cloneRecord(stored);
    },

    async linkReceiptEvidence(link) {
      const key = scopedKey(link.namespace, link.receiptId);
      const current = data.effectReceipts.get(key);
      if (!current) return null;
      if (
        current.receipt.toolOutcomeRef &&
        link.toolOutcomeRef &&
        current.receipt.toolOutcomeRef.id !== link.toolOutcomeRef.id
      ) {
        return null;
      }
      const requestRetryCount = Math.max(
        current.receipt.requestRetryCount ?? 0,
        link.requestRetryCount ?? 0,
      );
      const changed =
        (!current.receipt.toolOutcomeRef && link.toolOutcomeRef !== undefined) ||
        requestRetryCount !== (current.receipt.requestRetryCount ?? 0);
      if (!changed) {
        return cloneRecord(current);
      }
      if (current.revision !== link.revision) return null;
      const stored = cloneRecord({
        ...current,
        receipt: {
          ...current.receipt,
          ...(link.toolOutcomeRef
            ? { toolOutcomeRef: link.toolOutcomeRef }
            : {}),
          ...(link.requestRetryCount === undefined
            ? {}
            : { requestRetryCount }),
        },
        revision: current.revision + 1,
      });
      put(data.effectReceipts, key, stored, recordWrite);
      return cloneRecord(stored);
    },

    async settleExecution(settlement) {
      const receiptKey = scopedKey(
        settlement.receipt.namespace,
        settlement.receipt.receipt.id,
      );
      const currentReceipt = data.effectReceipts.get(receiptKey);
      const currentUnit = settlement.unit
        ? data.effectUnits.get(
            scopedKey(settlement.unit.namespace, settlement.unit.unit.id),
          )
        : undefined;
      const currentEnvelope = settlement.envelope
        ? data.effectEnvelopes.get(scopedKey(
            settlement.envelope.namespace,
            settlement.envelope.receiptId,
          ))
        : undefined;
      if (
        !currentReceipt ||
        !durableTransitionMatches(currentReceipt, settlement.receipt) ||
        !isDurableReceiptTransition(
          currentReceipt.receipt.outcome,
          settlement.receipt.receipt.outcome,
        ) ||
        (settlement.unit &&
          (!currentUnit ||
            !durableTransitionMatches(currentUnit, settlement.unit) ||
            !isDurableUnitTransition(
              currentUnit.unit.status,
              settlement.unit.unit.status,
            ))) ||
        (settlement.envelope &&
          (!currentEnvelope ||
            !durableTransitionMatches(currentEnvelope, settlement.envelope)))
      ) {
        return null;
      }
      const stored = cloneRecord(settlement);
      put(data.effectReceipts, receiptKey, stored.receipt, recordWrite);
      if (stored.unit) {
        put(
          data.effectUnits,
          scopedKey(stored.unit.namespace, stored.unit.unit.id),
          stored.unit,
          recordWrite,
        );
      }
      if (stored.envelope) {
        put(
          data.effectEnvelopes,
          scopedKey(stored.envelope.namespace, stored.envelope.receiptId),
          stored.envelope,
          recordWrite,
        );
      }
      return cloneRecord(stored);
    },

    async transitionScope({ next }) {
      const key = scopedKey(next.namespace, next.scope.ref.id);
      const current = data.effectScopes.get(key);
      if (
        !current ||
        !durableTransitionMatches(current, next) ||
        !isDurableScopeTransition(current.scope.status, next.scope.status)
      ) {
        return null;
      }
      const stored = cloneRecord(next);
      put(data.effectScopes, key, stored, recordWrite);
      return cloneRecord(stored);
    },

    async synchronizeScope(synchronization) {
      return synchronizeMemoryEffectScope(data, synchronization, recordWrite);
    },

    async transitionUnit({ next }) {
      const key = scopedKey(next.namespace, next.unit.id);
      const current = data.effectUnits.get(key);
      if (
        !current ||
        !durableTransitionMatches(current, next) ||
        !isDurableUnitTransition(current.unit.status, next.unit.status)
      ) {
        return null;
      }
      const stored = cloneRecord(next);
      put(data.effectUnits, key, stored, recordWrite);
      return cloneRecord(stored);
    },

    async prepareRecovery(preparation) {
      const unitKey = scopedKey(
        preparation.unit.namespace,
        preparation.unit.unit.id,
      );
      const currentUnit = data.effectUnits.get(unitKey);
      if (
        !currentUnit ||
        !durableTransitionMatches(currentUnit, preparation.unit) ||
        !isDurableUnitTransition(
          currentUnit.unit.status,
          preparation.unit.unit.status,
        )
      ) {
        return null;
      }
      const stored = cloneRecord(preparation);
      put(
        data.effectAttempts,
        scopedKey(stored.attempt.namespace, stored.attempt.attemptReceiptId),
        stored.attempt,
        recordWrite,
      );
      put(
        data.effectReceipts,
        scopedKey(stored.receipt.namespace, stored.receipt.receipt.id),
        stored.receipt,
        recordWrite,
      );
      put(data.effectUnits, unitKey, stored.unit, recordWrite);
      return cloneRecord(stored);
    },

    async settleRecovery(settlement) {
      const attemptKey = scopedKey(
        settlement.attemptReceipt.namespace,
        settlement.attemptReceipt.receipt.id,
      );
      const originalKey = scopedKey(
        settlement.originalReceipt.namespace,
        settlement.originalReceipt.receipt.id,
      );
      const unitKey = scopedKey(
        settlement.unit.namespace,
        settlement.unit.unit.id,
      );
      const attempt = data.effectReceipts.get(attemptKey);
      const original = data.effectReceipts.get(originalKey);
      const unit = data.effectUnits.get(unitKey);
      if (
        !attempt ||
        !original ||
        !unit ||
        !durableTransitionMatches(attempt, settlement.attemptReceipt) ||
        !durableTransitionMatches(original, settlement.originalReceipt) ||
        !durableTransitionMatches(unit, settlement.unit) ||
        !isDurableReceiptTransition(
          attempt.receipt.outcome,
          settlement.attemptReceipt.receipt.outcome,
        ) ||
        !isDurableUnitTransition(unit.unit.status, settlement.unit.unit.status)
      ) {
        return null;
      }
      const stored = cloneRecord(settlement);
      put(data.effectReceipts, attemptKey, stored.attemptReceipt, recordWrite);
      put(data.effectReceipts, originalKey, stored.originalReceipt, recordWrite);
      put(data.effectUnits, unitKey, stored.unit, recordWrite);
      return cloneRecord(stored);
    },

    async settleRecoveryFailure(settlement) {
      const attemptKey = scopedKey(
        settlement.attemptReceipt.namespace,
        settlement.attemptReceipt.receipt.id,
      );
      const unitKey = scopedKey(
        settlement.unit.namespace,
        settlement.unit.unit.id,
      );
      const attempt = data.effectReceipts.get(attemptKey);
      const unit = data.effectUnits.get(unitKey);
      if (
        !attempt ||
        !unit ||
        !durableTransitionMatches(attempt, settlement.attemptReceipt) ||
        !durableTransitionMatches(unit, settlement.unit) ||
        !isDurableReceiptTransition(
          attempt.receipt.outcome,
          settlement.attemptReceipt.receipt.outcome,
        ) ||
        !isDurableUnitTransition(unit.unit.status, settlement.unit.unit.status)
      ) return null;
      const stored = cloneRecord(settlement);
      put(data.effectReceipts, attemptKey, stored.attemptReceipt, recordWrite);
      put(data.effectUnits, unitKey, stored.unit, recordWrite);
      return cloneRecord(stored);
    },

    async settleRecoveryUnavailable(settlement) {
      const receiptKey = scopedKey(
        settlement.receipt.namespace,
        settlement.receipt.receipt.id,
      );
      const unitKey = scopedKey(
        settlement.unit.namespace,
        settlement.unit.unit.id,
      );
      const receipt = data.effectReceipts.get(receiptKey);
      const unit = data.effectUnits.get(unitKey);
      if (
        !receipt ||
        !unit ||
        !durableTransitionMatches(receipt, settlement.receipt) ||
        !durableTransitionMatches(unit, settlement.unit) ||
        !isDurableRecoveryUnavailableReceiptTransition(
          receipt.receipt,
          settlement.receipt.receipt,
        ) ||
        !isDurableRecoveryUnavailableUnitTransition(
          unit.unit.status,
          settlement.unit.unit.status,
        )
      ) return null;
      const stored = cloneRecord(settlement);
      put(data.effectReceipts, receiptKey, stored.receipt, recordWrite);
      put(data.effectUnits, unitKey, stored.unit, recordWrite);
      return stored;
    },

    async reconcile(settlement) {
      return reconcileMemoryEffects(data, settlement, recordWrite);
    },

    async reconstructScope(scope, options) {
      return reconstructMemoryEffectScope(data, scope, options.namespace);
    },

    async prune(options) {
      return pruneMemoryEffectEnvelopes(data, options, recordWrite);
    },
  };
}
