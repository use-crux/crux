/**
 * Duplicate accept with the same identity is idempotent; a different digest conflicts.
 */

import { describe, expect, it } from "vitest";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  acceptTransportEnvelope,
  TransportEnvelopeConflictError,
  type RuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/transport";

function envelope(
  eventId: string,
  payloadValue: string,
  byteLength: number,
  sha256: string,
): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: "binding.orders",
    adapterId: "orders.webhook",
    provider: "orders.webhook",
    accountId: "acct_1",
    eventId,
    receivedAt: "2026-08-04T12:00:00.000Z",
    authenticatedRouting: { source: "webhook" },
    payload: {
      kind: "inline-base64url",
      value: payloadValue,
      byteLength,
      sha256,
    },
    configRef: { id: "config.orders", revision: "rev.1" },
    target: { kind: "signal", signalId: "order.submitted" },
  };
}

describe("transport envelope idempotency", () => {
  it("replays the same identity and digest as a durable duplicate", async () => {
    const store = inMemoryRuntimeStore();
    const first = envelope(
      "evt_1",
      "YQ",
      1,
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
    const accepted = await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope: first,
      now: new Date("2026-08-04T12:00:00.000Z"),
    });
    const duplicate = await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope: first,
      now: new Date("2026-08-04T12:00:01.000Z"),
    });

    expect(accepted.kind).toBe("accepted");
    expect(duplicate).toMatchObject({
      kind: "duplicate",
      acknowledge: true,
      record: {
        eventId: "evt_1",
        acceptedAt: accepted.record.acceptedAt,
      },
    });
  });

  it("rejects the same identity with a different authenticated payload digest", async () => {
    const store = inMemoryRuntimeStore();
    const first = envelope(
      "evt_2",
      "YQ",
      1,
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
    await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope: first,
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    const conflicting = envelope(
      "evt_2",
      "Yg",
      1,
      "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
    );
    await expect(
      acceptTransportEnvelope({
        store,
        namespace: "app",
        envelope: conflicting,
        now: new Date("2026-08-04T12:00:02.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "TRANSPORT_ENVELOPE_CONFLICT",
      name: "TransportEnvelopeConflictError",
    });
    await expect(
      acceptTransportEnvelope({
        store,
        namespace: "app",
        envelope: conflicting,
        now: new Date("2026-08-04T12:00:02.000Z"),
      }),
    ).rejects.toBeInstanceOf(TransportEnvelopeConflictError);

    const stillOriginal = await store.transports!.get({
      namespace: "app",
      provider: "orders.webhook",
      accountId: "acct_1",
      eventId: "evt_2",
    });
    expect(stillOriginal?.envelope.payload).toEqual(first.payload);
  });
});
