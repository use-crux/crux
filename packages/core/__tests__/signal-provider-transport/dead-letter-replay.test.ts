/**
 * Bounded retry becomes dead-letter; explicit replay returns the envelope to accepted.
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
  replayTransportEnvelope,
  type RuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/transport";

function makeEnvelope(): RuntimeAcceptedTransportEnvelope {
  const bytes = new TextEncoder().encode(JSON.stringify({ orderId: "ord_poison" }));
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
    eventId: "evt_poison",
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

describe("transport dead-letter and replay", () => {
  it("dead-letters after bounded retries and replays on explicit operator action", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const published: string[] = [];
    orderSubmitted.subscribe((occurrence) => {
      published.push(occurrence.payload.orderId);
    });

    let fail = true;
    const provider = signalProvider({
      id: "orders.webhook",
      transport: webhook({
        async handle() {
          throw new Error("edge not used");
        },
      }),
      signals: { orderSubmitted },
      async onEvent(envelope, { signals }) {
        if (fail) {
          throw Object.assign(new Error("poison payload"), {
            code: "POISON",
          });
        }
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

    const store = inMemoryRuntimeStore();
    await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope: makeEnvelope(),
      maxAttempts: 2,
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    const runner = createTransportNormalizationRunner({
      store,
      namespace: "app",
      providers: [provider],
    });

    const first = await runner.runOnce({
      now: new Date("2026-08-04T12:00:01.000Z"),
      rng: () => 0,
    });
    expect(first).toEqual({
      claimed: 1,
      normalized: 0,
      retried: 1,
      deadLettered: 0,
    });

    const retried = await store.transports!.get({
      namespace: "app",
      provider: "orders.webhook",
      accountId: "acct_1",
      eventId: "evt_poison",
    });
    expect(retried?.state).toBe("accepted");
    expect(retried?.attempts).toBe(1);
    expect(retried?.lastFailure).toMatchObject({
      message: "poison payload",
      code: "POISON",
    });

    // Advance past nextAttemptAt for the second attempt.
    const second = await runner.runOnce({
      now: new Date(Date.parse(retried!.nextAttemptAt) + 1),
      rng: () => 0,
    });
    expect(second).toEqual({
      claimed: 1,
      normalized: 0,
      retried: 0,
      deadLettered: 1,
    });

    const dead = await store.transports!.get({
      namespace: "app",
      provider: "orders.webhook",
      accountId: "acct_1",
      eventId: "evt_poison",
    });
    expect(dead?.state).toBe("dead-letter");
    expect(dead?.attempts).toBe(2);

    // Explicit operator replay returns the envelope to accepted.
    fail = false;
    const replayed = await replayTransportEnvelope({
      store,
      namespace: "app",
      provider: "orders.webhook",
      accountId: "acct_1",
      eventId: "evt_poison",
      now: new Date("2026-08-04T13:00:00.000Z"),
    });
    expect(replayed.state).toBe("accepted");
    expect(replayed.attempts).toBe(0);

    const recovered = await runner.runOnce({
      now: new Date("2026-08-04T13:00:01.000Z"),
    });
    expect(recovered).toEqual({
      claimed: 1,
      normalized: 1,
      retried: 0,
      deadLettered: 0,
    });
    expect(published).toEqual(["ord_poison"]);
  });
});
