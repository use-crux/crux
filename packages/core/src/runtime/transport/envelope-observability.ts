/**
 * Payload-safe observability emission for accepted transport envelopes.
 *
 * @remarks Uses the existing observability transport when sinks are active.
 * Emits under `custom.operation` so schema version 5 servers accept records
 * without a taxonomy bump, while Devtools recognizes the `kind:
 * "transport.envelope"` attribute shape and lineage projection.
 *
 * @module
 */

import type { CruxAttributes } from "../../observability/contract";
import {
  hasActiveObservabilitySinks,
  observe,
} from "../../observability/observe";
import type { RuntimeTransportEnvelopeRecord } from "./records";
import {
  projectTransportEnvelope,
  type RuntimeTransportEnvelopeProjection,
} from "./projection";

/**
 * Attribute bag carried on transport envelope observability runs.
 *
 * @remarks Closed JSON-safe projection only — no payloads or credentials.
 */
export interface TransportEnvelopeObservabilityAttributes {
  readonly kind: "transport.envelope";
  readonly outcome:
    | "normalized"
    | "retried"
    | "dead-lettered"
    | "accepted"
    | "duplicate";
  readonly envelope: RuntimeTransportEnvelopeProjection;
}

/**
 * Emit one secret-free envelope lineage run when observability sinks are active.
 *
 * @param record - Durable envelope after a lifecycle transition.
 * @param outcome - Operator-visible settlement outcome.
 */
export function emitTransportEnvelopeObservability(
  record: RuntimeTransportEnvelopeRecord,
  outcome: TransportEnvelopeObservabilityAttributes["outcome"],
): void {
  // Observability is best-effort: never let sink/registry failures change the
  // accept/normalize return path after durable commit.
  try {
    if (!hasActiveObservabilitySinks()) {
      return;
    }

    const envelope = projectTransportEnvelope(record);
    const attributes = Object.freeze({
      kind: "transport.envelope",
      outcome,
      envelope,
    }) satisfies TransportEnvelopeObservabilityAttributes;

    const run = observe.openRun({
      name: "transport envelope",
      rootPrimitive: "custom.operation",
      attributes: attributes as CruxAttributes,
    });

    run.end({
      status: outcome === "dead-lettered" ? "error" : "ok",
      attributes: attributes as CruxAttributes,
    });
  } catch {
    // Intentionally empty: durable envelope lifecycle already committed.
  }
}
