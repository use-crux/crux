/**
 * Shared helpers for Agent Session Signal ingress (queue + settle).
 *
 * @module
 */

import type { StatisticsFact } from "../../../statistics";
import type {
  SignalDeliveryRecord,
} from "../../reactive/records";
import type { RuntimeStoreTransaction } from "../../store";

/** Outcome of applying one Session-subscription delivery to Agent ingress. */
export type SessionSignalIngressOutcome =
  | {
      readonly kind: "accepted";
      readonly inputId: string;
      readonly cursor: number;
    }
  | { readonly kind: "deduplicated"; readonly inputId: string }
  | {
      readonly kind: "dropped";
      readonly reason: "closed" | "invalid" | "unavailable" | "flow";
    }
  | { readonly kind: "queued" };

/** Stable Session input identity for one Session-subscription delivery. */
export function signalIngressInputId(deliveryId: string): string {
  return `input_sig_${deliveryId}`;
}

/**
 * Unconditional delivery terminalization (publish-time closed Session path).
 *
 * @remarks Worker/boundary settlement uses compare-and-set claim instead.
 */
export async function terminalizeDelivery(
  tx: RuntimeStoreTransaction,
  delivery: SignalDeliveryRecord,
  state: "delivered" | "dead-letter",
  now: Date,
): Promise<void> {
  if (!tx.signals) return;
  await tx.signals.putDelivery(
    Object.freeze({
      ...delivery,
      state,
      attempts: delivery.attempts + 1,
      updatedAt: now.toISOString(),
    }),
  );
}

export async function appendIngressFacts(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
    readonly now: Date;
    readonly facts: readonly StatisticsFact[];
  },
): Promise<void> {
  const sessions = tx.sessions;
  if (!sessions?.appendStatistics || input.facts.length === 0) return;
  await sessions.appendStatistics(input);
}
