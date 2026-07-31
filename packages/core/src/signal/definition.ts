/**
 * Inert typed Signal definitions.
 *
 * @module
 */

import type {
  InferSignalSchemaInput,
  InferSignalSchemaOutput,
  SignalSchema,
} from "./schema-types";
import {
  matchSignalView,
  predicateSignalView,
  type MatchSignalView,
  type PredicateSignalView,
  type SignalPredicate,
} from "./filter";
import type { SignalMatch } from "./match";
import { createProcessLocalSignalState } from "./local-subscriptions";
import type {
  SignalListener,
  SignalPublishOptions,
  SignalPublishReceipt,
  SignalUnsubscribe,
} from "./publication";
import { validateSignalPayload } from "./validation";

/** Options for declaring an inert {@link Signal}. */
export interface SignalOptions<
  TId extends string,
  TSchema extends SignalSchema,
> {
  /** Stable application-authored Signal identity. */
  readonly id: TId;
  /** Standard Schema used when payloads are published. */
  readonly schema: TSchema;
}

/**
 * A typed Signal definition that publishes normalized occurrences.
 *
 * @remarks Definitions are frozen and inert. Process-local publication
 * resolves at acceptance and never waits for listener completion.
 */
export interface Signal<
  TId extends string,
  TSchema extends SignalSchema,
> {
  /** Stable definition discriminant. */
  readonly _tag: "Signal";
  /** Literal application-authored Signal identity. */
  readonly id: TId;
  /** Authored Standard Schema retained for publication validation. */
  readonly schema: TSchema;
  /**
   * Validate and accept one occurrence for process-local delivery.
   *
   * @remarks The Promise resolves at acceptance, not listener completion.
   * @param payload - Authored schema input to validate and normalize.
   * @param options - Optional retry identity for idempotent publication.
   * @returns A receipt describing the actual acceptance guarantee.
   * @throws {@link SignalValidationError} for schema-invalid payloads,
   * `CruxRuntimeError` with `PAYLOAD_NOT_JSON` for unsafe normalized output,
   * or {@link SignalError} when publication is rejected.
   */
  publish(
    payload: InferSignalSchemaInput<TSchema>,
    options?: SignalPublishOptions,
  ): Promise<SignalPublishReceipt<TId>>;
  /**
   * Create an inert predicate view over normalized payloads.
   *
   * @remarks Predicate code is retained as deployed code. The returned view
   * has no publication, subscription, or chaining methods.
   * @param predicate - Function evaluated against normalized schema output.
   * @returns A frozen predicate identity over this Signal.
   */
  when(
    predicate: SignalPredicate<InferSignalSchemaOutput<TSchema>>,
  ): PredicateSignalView<TId, TSchema>;
  /**
   * Create an inert partial-equality view over normalized payloads.
   *
   * @remarks Objects match recursively by included fields; arrays and scalars
   * are exact values. The returned view has no operational methods.
   * @param match - Canonical JSON match data.
   * @returns A frozen match identity over this Signal.
   */
  when(
    match: SignalMatch<InferSignalSchemaOutput<TSchema>>,
  ): MatchSignalView<TId, TSchema>;
  /**
   * Subscribe to future occurrences in this process.
   *
   * @remarks No historical occurrences are replayed. Listener completion and
   * failures cannot change an accepted publication.
   * @param listener - Callback receiving normalized accepted occurrences.
   * @returns An idempotent unsubscribe function.
   */
  subscribe(
    listener: SignalListener<TId, InferSignalSchemaOutput<TSchema>>,
  ): SignalUnsubscribe;
}

/**
 * Declare a typed Signal without performing I/O or starting workers.
 *
 * @remarks The returned definition is frozen and inert. Use
 * {@link Signal.publish} to accept an occurrence and {@link Signal.subscribe}
 * for future callbacks in this process. Durable Session subscriptions are a
 * separate lifecycle and are never implied by `subscribe()`.
 *
 * @param options - Stable Signal identity and its Standard Schema.
 * @returns A frozen typed Signal definition.
 *
 * @example
 * ```ts
 * import { signal } from "@use-crux/core";
 * import { z } from "zod";
 *
 * const orderSubmitted = signal({
 *   id: "order.submitted",
 *   schema: z.object({ orderId: z.string() }),
 * });
 * ```
 */
export function signal<
  const TId extends string,
  const TSchema extends SignalSchema,
>(options: SignalOptions<TId, TSchema>): Signal<TId, TSchema> {
  const local = createProcessLocalSignalState<
    TId,
    InferSignalSchemaOutput<TSchema>
  >(options.id);
  const definition: Signal<TId, TSchema> = {
    _tag: "Signal",
    id: options.id,
    schema: options.schema,
    publish,
    when,
    subscribe: local.subscribe,
  };
  return Object.freeze(definition);

  async function publish(
    payload: InferSignalSchemaInput<TSchema>,
    publishOptions?: SignalPublishOptions,
  ): Promise<SignalPublishReceipt<TId>> {
    const normalizedPayload = await validateSignalPayload(
      options.id,
      options.schema,
      payload,
    );
    return local.publish(normalizedPayload, publishOptions);
  }

  function when(
    predicate: SignalPredicate<InferSignalSchemaOutput<TSchema>>,
  ): PredicateSignalView<TId, TSchema>;
  function when(
    match: SignalMatch<InferSignalSchemaOutput<TSchema>>,
  ): MatchSignalView<TId, TSchema>;
  function when(
    filter:
      | SignalPredicate<InferSignalSchemaOutput<TSchema>>
      | SignalMatch<InferSignalSchemaOutput<TSchema>>,
  ): PredicateSignalView<TId, TSchema> | MatchSignalView<TId, TSchema> {
    return typeof filter === "function"
      ? predicateSignalView(definition, filter)
      : matchSignalView(definition, filter);
  }
}
