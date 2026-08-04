/**
 * Crash after acknowledgment leaves the envelope accepted; restart claims and normalizes.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signal } from "../../src/signal";
import { webhook } from "../../src/signal/transport";
import { signalProvider } from "../../src/signal/provider";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  acceptTransportEnvelope,
  createTransportNormalizationRunner,
  type RuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/transport";

function makeEnvelope(): RuntimeAcceptedTransportEnvelope {
  const bytes = new TextEncoder().encode(JSON.stringify({ orderId: "ord_1" }));
  const value = Buffer.from(bytes).toString("base64url");
  const sha256 = require("node:crypto")
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: "binding.orders",
    adapterId: "orders.webhook",
    provider: "orders.webhook",
    accountId: "acct_1",
    eventId: "evt_restart",
    receivedAt: "2026-08-04T12:00:00.000Z",
    authenticatedRouting: { source: "webhook" },
    payload: {
      kind: "inline-base64url",
      value,
      byteLength: bytes.byteLength,
      sha256,
    },
    configRef: { id: "config.orders", revision: "rev.1" },
    target: { kind: "signal", signalId: "order.submitted" },
  };
}

describe("transport restart-safe normalization", () => {
  it("claims accepted envelopes after a crash between ack and normalize", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const published: string[] = [];
    orderSubmitted.subscribe((occurrence) => {
      published.push(occurrence.payload.orderId);
    });

    const provider = signalProvider({
      id: "orders.webhook",
      transport: webhook({
        async handle() {
          throw new Error("edge not used in this tracer");
        },
      }),
      signals: { orderSubmitted },
      async onEvent(envelope, { signals }) {
        const raw =
          envelope.payload.kind === "inline-base64url"
            ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
            : "";
        const body = JSON.parse(raw) as { orderId: string };
        await signals.orderSubmitted.publish(
          { orderId: body.orderId },
          { idempotencyKey: envelope.eventId },
        );
      },
    });

    // Process A: accept and acknowledge, then crash before normalize.
    const store = inMemoryRuntimeStore();
    const accept = await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope: makeEnvelope(),
      now: new Date("2026-08-04T12:00:00.000Z"),
    });
    expect(accept.acknowledge).toBe(true);
    expect(accept.record.state).toBe("accepted");
    expect(published).toEqual([]);

    // Process B: restart-safe host-invoked runner claims and normalizes.
    const runner = createTransportNormalizationRunner({
      store,
      namespace: "app",
      providers: [provider],
    });
    const run = await runner.runOnce({
      now: new Date("2026-08-04T12:00:05.000Z"),
    });

    expect(run).toEqual({
      claimed: 1,
      normalized: 1,
      retried: 0,
      deadLettered: 0,
    });
    expect(published).toEqual(["ord_1"]);

    // Idempotent completion: second pass finds nothing to claim.
    const second = await runner.runOnce({
      now: new Date("2026-08-04T12:00:06.000Z"),
    });
    expect(second.claimed).toBe(0);
    expect(published).toEqual(["ord_1"]);
  });
});
