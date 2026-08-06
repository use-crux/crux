/**
 * Canonical digests for accepted transport envelopes.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";
import { canonicalSignalJson } from "../../signal/canonical-json";
import type { JsonValue } from "../../storage/types";
import type { RuntimeAcceptedTransportEnvelope } from "./contracts";

const encoder = new TextEncoder();

/**
 * Compute the conflict digest for one authenticated accepted envelope.
 *
 * @remarks Digests cover the detached authenticated fields that must remain
 * stable for a provider/account/event identity. They never include credentials.
 */
export function transportEnvelopeDigest(
  envelope: RuntimeAcceptedTransportEnvelope,
): string {
  const material: JsonValue = {
    schemaVersion: envelope.schemaVersion,
    bindingId: envelope.bindingId,
    adapterId: envelope.adapterId,
    provider: envelope.provider,
    accountId: envelope.accountId,
    eventId: envelope.eventId,
    authenticatedRouting: envelope.authenticatedRouting as JsonValue,
    payload: envelope.payload as JsonValue,
    configRef: {
      id: envelope.configRef.id,
      revision: envelope.configRef.revision,
    },
    target: {
      kind: envelope.target.kind,
      signalId: envelope.target.signalId,
    },
  };
  return sha256Hex(encoder.encode(canonicalSignalJson(material)));
}
