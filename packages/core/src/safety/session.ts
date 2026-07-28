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
  guardSafetySessionFeedback,
  guardSafetySessionInputOperationMedia,
  guardSafetySessionInputOperationText,
  guardSafetySessionLanguageStep,
  guardSafetySessionModelIngress,
  safetySessionModelIngressGuard,
  safetySessionFeedbackGuard,
  safetySessionMemoryWriteGuard,
  safetySessionToolDefinitionGuard,
  safetySessionToolDescriptionGuard,
  guardSafetySessionOutputOperationText,
  guardSafetySessionStreamCompletion,
  openSafetySessionStructuredStream,
  openSafetySessionStreamRaw,
  openSafetySessionStructuredStreamRaw,
  runSafetySessionOneShotOutputConstraints,
  safetyDefersDownstreamOutput,
  safetyDefersReasoning,
  safetyRequiresLanguageStepTransform,
  safetySessionStreamCommitPlan,
} from "./session-bridge";

export {
  guardSafetySessionOutputMedia,
  safetyEnforcesOutputMedia,
} from "./session-media";

export type {
  FeedbackIngress,
  FeedbackIngressGuard,
  StreamCommitPlan,
  StructuredSafetyContext,
  TerminalFinalizeOptions,
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
