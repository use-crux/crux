/**
 * Crash after acknowledgment leaves the envelope accepted; restart claims and normalizes.
 * Crash after Signal publication but before envelope completion must not redeliver.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signal } from "../../src/signal";
import { webhook } from "../../src/signal/transport";
import { signalProvider } from "../../src/signal/provider";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  acceptTransportEnvelope,
  claimTransportEnvelopes,
  createTransportNormalizationRunner,
  normalizeClaimedTransportEnvelope,
  type RuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/transport";

function makeEnvelope(
  eventId = "evt_restart",
): RuntimeAcceptedTransportEnvelope {
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
    eventId,
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

function createProvider(options?: {
  readonly omitIdempotencyKey?: boolean;
  readonly failAfterPublish?: () => boolean;
}) {
  const orderSubmitted = signal({
    id: "order.submitted",
    schema: z.object({ orderId: z.string() }),
  });
  const published: Array<{ orderId: string; occurrenceId: string }> = [];
  orderSubmitted.subscribe((occurrence) => {
    published.push({
      orderId: occurrence.payload.orderId,
      occurrenceId: occurrence.id,
    });
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
      if (options?.omitIdempotencyKey) {
        await signals.orderSubmitted.publish({ orderId: body.orderId });
      } else {
        await signals.orderSubmitted.publish(
          { orderId: body.orderId },
          { idempotencyKey: envelope.eventId },
        );
      }
      if (options?.failAfterPublish?.()) {
        throw new Error("crash after publish");
      }
    },
  });
  return { provider, published };
}

describe("transport restart-safe normalization", () => {
  it("claims accepted envelopes after a crash between ack and normalize", async () => {
    const { provider, published } = createProvider();

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
    expect(published.map((entry) => entry.orderId)).toEqual(["ord_1"]);

    // Idempotent completion: second pass finds nothing to claim.
    const second = await runner.runOnce({
      now: new Date("2026-08-04T12:00:06.000Z"),
    });
    expect(second.claimed).toBe(0);
    expect(published).toHaveLength(1);
  });

  it("does not redeliver when onEvent omits an idempotency key and completion crashes", async () => {
    let failAfterPublish = true;
    const { provider, published } = createProvider({
      omitIdempotencyKey: true,
      failAfterPublish: () => failAfterPublish,
    });
    const store = inMemoryRuntimeStore();
    await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope: makeEnvelope("evt_after_publish"),
      maxAttempts: 4,
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    const firstClaim = await claimTransportEnvelopes({
      store,
      namespace: "app",
      now: new Date("2026-08-04T12:00:01.000Z"),
      leaseToken: "lease-1",
      leaseMs: 1,
    });
    expect(firstClaim).toHaveLength(1);
    const first = await normalizeClaimedTransportEnvelope({
      store,
      provider,
      record: firstClaim[0]!,
      now: new Date("2026-08-04T12:00:01.000Z"),
      rng: () => 0,
    });
    expect(first.kind).toBe("retried");
    expect(published).toHaveLength(1);
    const firstOccurrenceId = published[0]!.occurrenceId;

    // Lease expired after the crash-shaped failure; reclaim and normalize again.
    failAfterPublish = false;
    const reclaimed = await claimTransportEnvelopes({
      store,
      namespace: "app",
      now: new Date("2026-08-04T12:05:00.000Z"),
      leaseToken: "lease-2",
      leaseMs: 30_000,
    });
    expect(reclaimed).toHaveLength(1);
    const second = await normalizeClaimedTransportEnvelope({
      store,
      provider,
      record: reclaimed[0]!,
      now: new Date("2026-08-04T12:05:00.000Z"),
    });
    expect(second.kind).toBe("normalized");
    expect(published).toHaveLength(1);
    expect(published[0]!.occurrenceId).toBe(firstOccurrenceId);
  });
});
