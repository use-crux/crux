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

interface IdempotentPublication<TId extends string> {
  readonly canonicalPayload: string;
  readonly receipt: SignalPublishReceipt<TId>;
}

/** Definition-scoped process-local publication state. @internal */
export interface ProcessLocalSignalState<
  TId extends string,
  TPayload extends JsonValue,
> {
  publish(
    payload: TPayload,
    options?: SignalPublishOptions,
  ): SignalPublishReceipt<TId>;
  subscribe(listener: SignalListener<TId, TPayload>): SignalUnsubscribe;
}

/** Create isolated process-local state for one Signal definition. @internal */
export function createProcessLocalSignalState<
  TId extends string,
  TPayload extends JsonValue,
>(signalId: TId): ProcessLocalSignalState<TId, TPayload> {
  const listeners = new Set<SignalListener<TId, TPayload>>();
  const idempotentPublications = new Map<
    string,
    IdempotentPublication<TId>
  >();

  return {
    publish(payload, options) {
      const canonicalPayload = canonicalSignalJson(payload);
      const idempotencyKey = options?.idempotencyKey;
      const existing =
        idempotencyKey === undefined
          ? undefined
          : idempotentPublications.get(idempotencyKey);
      if (existing !== undefined) {
        if (existing.canonicalPayload === canonicalPayload) {
          return existing.receipt;
        }
        throw new SignalError(
          "idempotency_conflict",
          `Signal \`${signalId}\` rejected idempotency reuse with different normalized payload data.`,
        );
      }
      const acceptedAt = new Date();
      const occurrenceId = createOccurrenceId();
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

function reportListenerFailure<
  TId extends string,
  TPayload extends JsonValue,
>(occurrence: SignalOccurrence<TId, TPayload>): void {
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

let fallbackOccurrenceId = 0;

function createOccurrenceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `signal_occurrence_${uuid}`;
  fallbackOccurrenceId += 1;
  return `signal_occurrence_${Date.now().toString(36)}_${fallbackOccurrenceId.toString(36)}`;
}
