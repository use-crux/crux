/**
 * Process-local Signal acceptance and listener scheduling.
 *
 * @module
 */

import type { JsonValue } from "../storage/types";
import type {
  SignalListener,
  SignalOccurrence,
  SignalPublishOptions,
  SignalPublishReceipt,
  SignalUnsubscribe,
} from "./publication";
import { canonicalSignalJson } from "./canonical-json";
import { SignalError } from "./errors";
import { createSignalOccurrenceId } from "./identity";

interface IdempotentPublication<TId extends string> {
  readonly canonicalPayload: string;
  readonly receipt: SignalPublishReceipt<TId>;
}

/** Definition-scoped process-local publication state. @internal */
export interface ProcessLocalSignalState<
  TId extends string,
  TPayload extends JsonValue,
> {
  replay(
    payload: TPayload,
    options?: SignalPublishOptions,
  ): SignalPublishReceipt<TId> | undefined;
  publish(
    payload: TPayload,
    options?: SignalPublishOptions & {
      readonly occurrenceId?: string;
      readonly acceptedAt?: Date;
    },
  ): SignalPublishReceipt<TId>;
  notify(occurrence: SignalOccurrence<TId, TPayload>): void;
  subscribe(listener: SignalListener<TId, TPayload>): SignalUnsubscribe;
}

/** Create isolated process-local state for one Signal definition. @internal */
export function createProcessLocalSignalState<
  TId extends string,
  TPayload extends JsonValue,
>(signalId: TId): ProcessLocalSignalState<TId, TPayload> {
  const listeners = new Set<SignalListener<TId, TPayload>>();
  const idempotentPublications = new Map<string, IdempotentPublication<TId>>();
  const replay = (
    payload: TPayload,
    options?: SignalPublishOptions,
  ): SignalPublishReceipt<TId> | undefined => {
    const idempotencyKey = options?.idempotencyKey;
    if (idempotencyKey === undefined) return undefined;
    const existing = idempotentPublications.get(idempotencyKey);
    if (existing === undefined) return undefined;
    if (existing.canonicalPayload === canonicalSignalJson(payload)) {
      return existing.receipt;
    }
    throw new SignalError(
      "idempotency_conflict",
      `Signal \`${signalId}\` rejected idempotency reuse with different normalized payload data.`,
    );
  };

  return {
    replay,
    publish(payload, options) {
      const canonicalPayload = canonicalSignalJson(payload);
      const idempotencyKey = options?.idempotencyKey;
      const existing = replay(payload, options);
      if (existing !== undefined) return existing;
      const acceptedAt = options?.acceptedAt ?? new Date();
      const occurrenceId = options?.occurrenceId ?? createSignalOccurrenceId();
      const receipt: SignalPublishReceipt<TId> = Object.freeze({
        occurrenceId,
        signalId,
        acceptedAt,
        guarantee: "process-local",
      });
      const occurrence: SignalOccurrence<TId, TPayload> = Object.freeze({
        id: occurrenceId,
        signalId,
        payload,
        acceptedAt,
      });
      if (idempotencyKey !== undefined) {
        idempotentPublications.set(idempotencyKey, {
          canonicalPayload,
          receipt,
        });
      }
      scheduleListeners([...listeners], occurrence);
      return receipt;
    },
    notify(occurrence) {
      scheduleListeners([...listeners], occurrence);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function scheduleListeners<TId extends string, TPayload extends JsonValue>(
  listeners: readonly SignalListener<TId, TPayload>[],
  occurrence: SignalOccurrence<TId, TPayload>,
): void {
  for (const listener of listeners) {
    queueMicrotask(() => {
      try {
        void Promise.resolve(listener(occurrence)).catch(() => {
          reportListenerFailure(occurrence);
        });
      } catch {
        reportListenerFailure(occurrence);
      }
    });
  }
}

function reportListenerFailure<TId extends string, TPayload extends JsonValue>(
  occurrence: SignalOccurrence<TId, TPayload>,
): void {
  try {
    console.error(
      "[crux] process-local Signal listener failed after publication acceptance.",
      Object.freeze({
        code: "signal_listener_failed",
        signalId: occurrence.signalId,
        occurrenceId: occurrence.id,
      }),
    );
  } catch {
    // Diagnostics are fail-open and cannot change accepted publication.
  }
}
