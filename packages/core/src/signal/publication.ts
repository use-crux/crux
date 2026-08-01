/**
 * Public Signal occurrence and publication value contracts.
 *
 * @module
 */

import type { JsonValue } from "../storage/types";

/** Optional retry identity supplied when publishing a Signal. */
export interface SignalPublishOptions {
  /**
   * Caller-owned retry key used only for definition-scoped replay comparison.
   * @defaultValue `undefined`
   */
  readonly idempotencyKey?: string;
}

/**
 * Acceptance guarantee actually provided for one Signal occurrence.
 *
 * @remarks Callers cannot select this value; activated bindings determine it.
 */
export type SignalPublishGuarantee = "durable" | "process-local";

/**
 * Receipt returned once a Signal occurrence has been accepted.
 *
 * @remarks A receipt confirms acceptance, never listener or consumer
 * completion.
 */
export interface SignalPublishReceipt<TId extends string = string> {
  /** Stable identity of the accepted occurrence. */
  readonly occurrenceId: string;
  /** Literal identity of the Signal definition. */
  readonly signalId: TId;
  /** Process time at which publication was accepted. */
  readonly acceptedAt: Date;
  /** Actual guarantee accepted for this occurrence. */
  readonly guarantee: SignalPublishGuarantee;
}

/** Normalized payload and identity delivered to a Signal listener. */
export interface SignalOccurrence<
  TId extends string = string,
  TPayload extends JsonValue = JsonValue,
> {
  /** Stable occurrence identity, equal to the publication receipt identity. */
  readonly id: string;
  /** Literal identity of the Signal definition. */
  readonly signalId: TId;
  /** Detached, recursively frozen JSON payload after schema normalization. */
  readonly payload: TPayload;
  /** Process time at which publication was accepted. */
  readonly acceptedAt: Date;
}

/**
 * Callback scheduled after a process-local Signal occurrence is accepted.
 *
 * @remarks Listener latency and failure cannot change the publication receipt.
 */
export type SignalListener<TId extends string, TPayload extends JsonValue> = (
  occurrence: SignalOccurrence<TId, TPayload>,
) => void | Promise<void>;

/** Idempotent function that stops one process-local Signal subscription. */
export type SignalUnsubscribe = () => void;
