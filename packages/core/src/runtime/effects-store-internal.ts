/** Shared guards for first-party durable Effects store adapters. @internal @module */

export {
  durableTransitionMatches,
  isDurableReceiptTransition,
  isDurableReconciliationReceiptTransition,
  isDurableReconciliationUnitTransition,
  isDurableRecoveryUnavailableReceiptTransition,
  isDurableRecoveryUnavailableUnitTransition,
  isDurableScopeSynchronization,
  isDurableScopeTransition,
  isDurableUnitRegistration,
  isDurableUnitTransition,
  reconstructDurableEffectScope,
  type DurableEffectScopeRecords,
} from "../effect/internal/durable-state-machine";
