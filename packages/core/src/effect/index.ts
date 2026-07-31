/**
 * `@use-crux/core/effect` — custom effects, receipts, and recovery.
 *
 * @module
 */

export { effect } from "./define-effect";
export { reconcileEffect, recover } from "./recover";
export { rollback } from "./rollback";
export { rollbackOnError } from "./rollback-on-error";
export {
  CruxEffectError,
  EFFECT_ERROR_CODES,
  EffectOutcomeUnknownError,
  RollbackError,
} from "./errors";
export type {
  CruxEffectErrorCode,
  EffectErrorInput,
  EffectOutcomeUnknownDetails,
  RollbackErrorInput,
} from "./errors";
export type {
  EffectOutcome,
  EffectReceipt,
  EffectScopeLifecycle,
  RecoveryAvailability,
  RecoveryEnvelope,
  RecoveryUnitLifecycle,
} from "./receipt-types";
export type {
  Awaitable,
  CapturedEffectRecoveryContext,
  CapturedRecoverableEffectOptions,
  EffectCallArgs,
  EffectCaptureContext,
  EffectDefinition,
  EffectExecutionContext,
  EffectExecutionResult,
  EffectExecutor,
  EffectOptions,
  EffectReceiptRef,
  EffectReconciliation,
  EffectRecoveryContext,
  EffectResource,
  EffectScopeRef,
  RecoverableEffectDefinition,
  RecoverableEffectOptions,
  ReconcileEffect,
  RecoverOptions,
  RecoveryUnitResult,
  RecoveryUnitStatus,
  RollbackBoundaryController,
  RollbackOnErrorOptions,
  RollbackOptions,
  RollbackResult,
} from "./types";
