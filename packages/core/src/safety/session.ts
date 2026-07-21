/**
 * Public facade for the per-call Safety session.
 *
 * Contracts and orchestration live in focused modules so adapters depend on
 * one stable entry point without concentrating every concern in this file.
 *
 * @module
 */

export {
  createSafety,
  createSafetyWithBindingApplicability,
  defaultConstraintFeedbackFormatter,
} from "./session-runtime";

export {
  createSafetyLanguageStepTransformer,
  finalizeSafetySessionLanguageOutput,
  guardSafetySessionInputOperationMedia,
  guardSafetySessionInputOperationText,
  guardSafetySessionLanguageStep,
  guardSafetySessionModelIngress,
  safetySessionModelIngressGuard,
  guardSafetySessionOutputMedia,
  guardSafetySessionOutputOperationText,
  guardSafetySessionStreamCompletion,
  runSafetySessionOneShotOutputConstraints,
  safetyRequiresLanguageStepTransform,
} from "./session-bridge";

export {
  guardSafetySessionIngressCarrier,
  guardSafetySessionResolvedInput,
} from "./session-resolved-input";

export type {
  ConstraintFeedbackFormatter,
  Safety,
  SafetyCallOptions,
  SafetyContext,
  SafetyOutput,
  SafetyProtocolEvent,
  SafetyStream,
  SafetyStreamDirective,
  SafetyStreamSeal,
} from "./session-contract";
