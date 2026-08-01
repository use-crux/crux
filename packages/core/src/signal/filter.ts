/**
 * Inert predicate and match views over typed Signals.
 *
 * @module
 */

import type { Signal } from "./definition";
import type { SignalMatch } from "./match";
import type { JsonValue } from "../storage/types";
import {
  canonicalizeSignalJson,
  cloneSignalJson,
  freezeSignalJson,
} from "./canonical-json";
import type {
  InferSignalSchemaOutput,
  SignalSchema,
} from "./schema-types";

/**
 * Predicate over a normalized Signal payload.
 *
 * @remarks Predicate code is deployed with a static Flow target and is never
 * persisted as match data.
 */
export type SignalPredicate<TPayload> = (payload: TPayload) => boolean;

/**
 * An inert Signal view carrying a deployed predicate function.
 *
 * @remarks Predicate views contain identity only and expose no operational
 * Signal methods. Creating a view activates no consumer.
 * @typeParam TId - Literal identity of the base Signal.
 * @typeParam TSchema - Schema retained by the base Signal.
 */
export interface PredicateSignalView<
  TId extends string = string,
  TSchema extends SignalSchema = SignalSchema,
> {
  /** Filtered-view discriminant. */
  readonly _tag: "FilteredSignal";
  /** Identifies this view as deployed predicate code. */
  readonly filterKind: "predicate";
  /** Source Signal definition. */
  readonly signal: Signal<TId, TSchema>;
  /** Predicate evaluated against normalized payload output. */
  readonly predicate: SignalPredicate<InferSignalSchemaOutput<TSchema>>;
}

/**
 * An inert Signal view carrying canonical partial-equality data.
 *
 * @remarks Match data is detached, JSON-safe, and frozen. The view exposes no
 * operational Signal methods and activates no consumer.
 * @typeParam TId - Literal identity of the base Signal.
 * @typeParam TSchema - Schema retained by the base Signal.
 */
export interface MatchSignalView<
  TId extends string = string,
  TSchema extends SignalSchema = SignalSchema,
> {
  /** Filtered-view discriminant. */
  readonly _tag: "FilteredSignal";
  /** Identifies this view as canonical match data. */
  readonly filterKind: "match";
  /** Source Signal definition. */
  readonly signal: Signal<TId, TSchema>;
  /** Recursive partial equality match over normalized payload output. */
  readonly match: SignalMatch<InferSignalSchemaOutput<TSchema>>;
}

/** Create a frozen predicate identity. @internal */
export function predicateSignalView<
  TId extends string,
  TSchema extends SignalSchema,
>(
  signal: Signal<TId, TSchema>,
  predicate: SignalPredicate<InferSignalSchemaOutput<TSchema>>,
): PredicateSignalView<TId, TSchema> {
  return Object.freeze({
    _tag: "FilteredSignal",
    filterKind: "predicate",
    signal,
    predicate,
  });
}

/** Create a frozen match identity. @internal */
export function matchSignalView<
  TId extends string,
  TSchema extends SignalSchema,
>(
  signal: Signal<TId, TSchema>,
  match: SignalMatch<InferSignalSchemaOutput<TSchema>>,
): MatchSignalView<TId, TSchema> {
  const retainedMatch = freezeSignalJson(
    canonicalizeSignalJson(
      cloneSignalJson(match as JsonValue, "match"),
      "match",
    ),
  ) as SignalMatch<InferSignalSchemaOutput<TSchema>>;
  return Object.freeze({
    _tag: "FilteredSignal",
    filterKind: "match",
    signal,
    match: retainedMatch,
  });
}
