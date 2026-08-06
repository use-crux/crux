/**
 * Vertical tracer: authenticated request → durable accept → ack → normalize →
 * one Signal publication.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import { webhook } from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  acceptTransportEnvelope,
  createTransportNormalizationRunner,
  validateRuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/transport";
import type { RuntimeAcceptedTransportEnvelope } from "../../src/runtime/transport";

function inlinePayload(text: string) {
  const bytes = new TextEncoder().encode(text);
  const value = Buffer.from(bytes).toString("base64url");
  const sha256 = require("node:crypto")
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  return {
    kind: "inline-base64url" as const,
    value,
    byteLength: bytes.byteLength,
    sha256,
  };
}

describe("signal provider transport vertical", () => {
  it("accepts after edge auth, acknowledges only after commit, then normalizes into one Signal", async () => {
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

    const transport = webhook({
      async handle(request) {
        const authorization = request.headers.get("authorization");
        if (authorization !== "Bearer secret") {
          throw new Error("unauthenticated");
        }
        const body = (await request.json()) as {
          accountId: string;
          eventId: string;
          orderId: string;
        };
        return {
          accountId: body.accountId,
          eventId: body.eventId,
          authenticatedRouting: { source: "webhook" },
          payload: inlinePayload(JSON.stringify({ orderId: body.orderId })),
        };
      },
    });

    const provider = signalProvider({
      id: "orders.webhook",
      transport,
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

    const binding = managedTransportBinding(provider, {
      id: "binding.orders",
      configRef: { id: "config.orders", revision: "rev.1" },
      signalId: "order.submitted",
    });
    expect(binding).toEqual({
      _tag: "RuntimeManagedTransportBinding",
      id: "binding.orders",
      adapter: {
        _tag: "RuntimeManagedTransportAdapter",
        id: "orders.webhook",
        provider: "orders.webhook",
        acceptedEnvelopeVersion: 1,
      },
      configRef: { id: "config.orders", revision: "rev.1" },
      target: { kind: "signal", signalId: "order.submitted" },
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(
      Object.getOwnPropertyNames(binding).includes("handle") ||
        Object.getOwnPropertyNames(binding).includes("onEvent"),
    ).toBe(false);

    const request = new Request("https://example.test/webhooks/orders", {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId: "acct_1",
        eventId: "evt_1",
        orderId: "ord_1",
      }),
    });

    const handled = await provider.transport.handle(request);
    const envelope = validateRuntimeAcceptedTransportEnvelope({
      _tag: "RuntimeAcceptedTransportEnvelope",
      schemaVersion: 1,
      bindingId: binding.id,
      adapterId: binding.adapter.id,
      provider: binding.adapter.provider,
      accountId: handled.accountId,
      eventId: handled.eventId,
      receivedAt: new Date("2026-08-04T12:00:00.000Z").toISOString(),
      authenticatedRouting: handled.authenticatedRouting,
      payload: handled.payload,
      configRef: binding.configRef,
      target: binding.target,
    } satisfies RuntimeAcceptedTransportEnvelope);

    const store = inMemoryRuntimeStore();
    const acceptedAt = new Date("2026-08-04T12:00:00.000Z");
    const accept = await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope,
      now: acceptedAt,
    });

    expect(accept.kind).toBe("accepted");
    expect(accept.acknowledge).toBe(true);
    expect(accept.record.state).toBe("accepted");
    expect(published).toEqual([]);

    const runner = createTransportNormalizationRunner({
      store,
      namespace: "app",
      providers: [provider],
    });
    const run = await runner.runOnce({
      now: new Date("2026-08-04T12:00:01.000Z"),
      limit: 10,
    });

    expect(run).toEqual({
      claimed: 1,
      normalized: 1,
      retried: 0,
      deadLettered: 0,
    });
    expect(published).toEqual([
      { orderId: "ord_1", occurrenceId: expect.any(String) },
    ]);

    const again = await acceptTransportEnvelope({
      store,
      namespace: "app",
      envelope,
    });
    expect(again.kind).toBe("duplicate");
    expect(again.acknowledge).toBe(true);
    expect(published).toHaveLength(1);
  });
});
