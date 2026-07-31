/**
 * Typed Signal definitions and process-local or durable publication contracts.
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
export type { SignalOccurrenceFor, StaticSignalSource } from "./source";
export { SignalError, SignalValidationError } from "./errors";
export type { SignalErrorCode } from "./errors";
