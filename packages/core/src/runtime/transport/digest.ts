/**
 * Canonical digests for accepted transport envelopes.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";
import { canonicalSignalJson } from "../../signal/canonical-json";
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
  return sha256Hex(
    encoder.encode(
      canonicalSignalJson({
        schemaVersion: envelope.schemaVersion,
        bindingId: envelope.bindingId,
        adapterId: envelope.adapterId,
        provider: envelope.provider,
        accountId: envelope.accountId,
        eventId: envelope.eventId,
        authenticatedRouting: envelope.authenticatedRouting,
        payload: envelope.payload,
        configRef: envelope.configRef,
        target: envelope.target,
      }),
    ),
  );
}
