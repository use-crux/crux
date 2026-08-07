/**
 * Terminal transport envelope retention through the Runtime maintenance path.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import { resolveRuntimeRetentionConfig } from "../../src/runtime/engine/retention";
import { pruneRetainedRecords } from "../../src/runtime/engine/maintenance-retention";
import {
  acceptTransportEnvelope,
  createTransportNormalizationRunner,
  type RuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/transport";
import { signalProvider } from "../../src/signal/provider";
import { webhook } from "../../src/signal/transport";
import { signal } from "../../src/signal";
import { z } from "zod";

function inlinePayload(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    kind: "inline-base64url" as const,
    value: Buffer.from(bytes).toString("base64url"),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function sampleEnvelope(eventId: string): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: "binding.orders",
    adapterId: "adapter.orders",
    provider: "orders",
    accountId: "acct_1",
    eventId,
    receivedAt: "2026-08-01T00:00:00.000Z",
    authenticatedRouting: { source: "webhook" },
    payload: inlinePayload(JSON.stringify({ orderId: "ord_1" })),
    configRef: { id: "cfg.orders", revision: "1" },
    target: { kind: "signal", signalId: "order.submitted" },
  };
}

describe("transport envelope retention", () => {
  it("prunes normalized envelopes via Runtime maintenance retention", async () => {
    const store = inMemoryRuntimeStore();
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const provider = signalProvider({
      id: "adapter.orders",
      transport: webhook({
        async handle() {
          throw new Error("unused");
        },
      }),
      signals: { orderSubmitted },
      async onEvent(envelope, { signals }) {
        const raw =
          envelope.payload.kind === "inline-base64url"
            ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
            : "";
        const body = JSON.parse(raw) as { orderId: string };
        await signals.orderSubmitted.publish({ orderId: body.orderId });
      },
    });

    await acceptTransportEnvelope({
      store,
      namespace: "demo",
      envelope: sampleEnvelope("evt_old"),
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    await acceptTransportEnvelope({
      store,
      namespace: "demo",
      envelope: sampleEnvelope("evt_fresh"),
      now: new Date("2026-08-07T00:00:00.000Z"),
    });

    const runner = createTransportNormalizationRunner({
      store,
      namespace: "demo",
      providers: [provider],
    });
    await runner.runOnce({ now: new Date("2026-08-01T00:00:01.000Z") });
    await runner.runOnce({ now: new Date("2026-08-07T00:00:01.000Z") });

    const retention = resolveRuntimeRetentionConfig({
      transportEnvelopes: "3d",
      sweepLimit: 100,
    });
    const pruned = await pruneRetainedRecords(
      { store, retention },
      { namespace: "demo", now: new Date("2026-08-07T12:00:00.000Z") },
    );
    expect(pruned.removed).toBeGreaterThanOrEqual(1);

    const old = await store.transact(async (tx) =>
      tx.transports!.get({
        namespace: "demo",
        provider: "orders",
        accountId: "acct_1",
        eventId: "evt_old",
      }),
    );
    const fresh = await store.transact(async (tx) =>
      tx.transports!.get({
        namespace: "demo",
        provider: "orders",
        accountId: "acct_1",
        eventId: "evt_fresh",
      }),
    );
    expect(old).toBeNull();
    expect(fresh?.state).toBe("normalized");
  });
});
