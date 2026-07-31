/**
 * Typed Signal definitions and process-local publication contracts.
 *
 * @module
 */

export { signal } from "./definition";
export type { Signal, SignalOptions } from "./definition";
export type {
  InferSignalSchemaInput,
  InferSignalSchemaOutput,
  SignalSchema,
} from "./schema-types";
export type { SignalMatch } from "./match";
export type {
  MatchSignalView,
  PredicateSignalView,
  SignalPredicate,
} from "./filter";
export type {
  SignalListener,
  SignalOccurrence,
  SignalPublishGuarantee,
  SignalPublishOptions,
  SignalPublishReceipt,
  SignalUnsubscribe,
} from "./publication";
export { SignalError, SignalValidationError } from "./errors";
export type { SignalErrorCode } from "./errors";
