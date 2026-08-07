/**
 * Transport statistics and delivery lineage through the public accept/normalize path.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import { webhook } from "../../src/signal/transport";
import { signalProvider } from "../../src/signal/provider";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  acceptTransportEnvelope,
  createTransportNormalizationRunner,
  projectTransportEnvelope,
  transportStatistics,
  type RuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/transport";

function inlinePayload(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    kind: "inline-base64url" as const,
    value: Buffer.from(bytes).toString("base64url"),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function sampleEnvelope(
  eventId: string,
  orderId = "ord_1",
): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: "binding.orders",
    adapterId: "adapter.orders",
    provider: "orders",
    accountId: "acct_1",
    eventId,
    receivedAt: "2026-08-04T12:00:00.000Z",
    authenticatedRouting: { source: "webhook" },
    payload: inlinePayload(JSON.stringify({ orderId })),
    configRef: { id: "cfg.orders", revision: "1" },
    target: { kind: "signal", signalId: "order.submitted" },
  };
}

describe("transport statistics and lineage", () => {
  it("records bounded lifecycle stats and safe delivery lineage without payloads", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const store = inMemoryRuntimeStore();
    const provider = signalProvider({
      id: "adapter.orders",
      transport: webhook({
        async handle() {
          throw new Error("edge handle is not used in this test");
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

    const first = await acceptTransportEnvelope({
      store,
      namespace: "demo",
      envelope: sampleEnvelope("evt_1"),
      now: new Date("2026-08-04T12:00:00.000Z"),
    });
    expect(first.kind).toBe("accepted");

    const duplicate = await acceptTransportEnvelope({
      store,
      namespace: "demo",
      envelope: sampleEnvelope("evt_1"),
      now: new Date("2026-08-04T12:00:01.000Z"),
    });
    expect(duplicate.kind).toBe("duplicate");

    const runner = createTransportNormalizationRunner({
      store,
      namespace: "demo",
      providers: [provider],
    });
    const run = await runner.runOnce({
      now: new Date("2026-08-04T12:00:02.000Z"),
    });
    expect(run.normalized).toBe(1);

    const stats = await transportStatistics({ store, namespace: "demo" });
    expect(stats.total).toMatchObject({
      accepted: 1,
      deduplicated: 1,
      normalized: 1,
      delivered: 1,
      retried: 0,
      deadLettered: 0,
    });
    expect(
      stats.byIdentity["adapter.orders/binding.orders"]?.accepted,
    ).toBe(1);

    const identity = {
      namespace: "demo",
      provider: "orders",
      accountId: "acct_1",
      eventId: "evt_1",
    };
    const record = await store.transact(async (tx) => {
      if (!tx.transports) throw new Error("missing transports");
      return tx.transports.get(identity);
    });
    expect(record).not.toBeNull();
    const projection = projectTransportEnvelope(record!);
    expect(projection.lineage).toHaveLength(1);
    expect(projection.lineage[0]).toMatchObject({
      signalId: "order.submitted",
      occurrenceId: expect.stringMatching(/.+/),
    });
    expect(JSON.stringify(projection)).not.toMatch(/ord_1|base64|secret|payload/);
    expect(projection).not.toHaveProperty("payload");
    expect(projection).not.toHaveProperty("envelope");
  });

  it("counts retries and dead-letters without exposing failure payloads", async () => {
    const store = inMemoryRuntimeStore();
    const provider = signalProvider({
      id: "adapter.orders",
      transport: webhook({
        async handle() {
          throw new Error("unused");
        },
      }),
      signals: {},
      async onEvent() {
        throw Object.assign(new Error("poison event"), {
          code: "POISON",
        });
      },
    });

    await acceptTransportEnvelope({
      store,
      namespace: "demo",
      envelope: sampleEnvelope("evt_poison"),
      maxAttempts: 2,
      now: new Date("2026-08-04T13:00:00.000Z"),
    });

    const runner = createTransportNormalizationRunner({
      store,
      namespace: "demo",
      providers: [provider],
    });
    await runner.runOnce({
      now: new Date("2026-08-04T13:00:01.000Z"),
      rng: () => 0,
    });
    await runner.runOnce({
      now: new Date("2026-08-04T14:00:00.000Z"),
      rng: () => 0,
    });

    const stats = await transportStatistics({ store, namespace: "demo" });
    expect(stats.total).toMatchObject({
      accepted: 1,
      retried: 1,
      deadLettered: 1,
      normalized: 0,
      delivered: 0,
    });

    const record = await store.transact(async (tx) => {
      if (!tx.transports) throw new Error("missing transports");
      return tx.transports.get({
        namespace: "demo",
        provider: "orders",
        accountId: "acct_1",
        eventId: "evt_poison",
      });
    });
    const projection = projectTransportEnvelope(record!);
    expect(projection.state).toBe("dead-letter");
    expect(projection.lastFailure?.code).toBe("POISON");
    expect(JSON.stringify(projection)).not.toMatch(/ord_1|base64/);
  });

  it("keeps transport statistics restart-safe across ledger restore", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const store = inMemoryRuntimeStore();
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
      envelope: sampleEnvelope("evt_restart"),
      now: new Date("2026-08-04T15:00:00.000Z"),
    });

    await createTransportNormalizationRunner({
      store,
      namespace: "demo",
      providers: [provider],
    }).runOnce({
      now: new Date("2026-08-04T15:00:01.000Z"),
    });

    const before = await transportStatistics({ store, namespace: "demo" });
    expect(before.total).toMatchObject({
      accepted: 1,
      normalized: 1,
      delivered: 1,
    });

    // Simulate process restart by reading the durable ledger export and
    // rewriting it through a fresh store port on the same adapter data.
    const exported = await store.transact(async (tx) => {
      if (!tx.transports) {
        throw new Error("missing transports");
      }

      return tx.transports.getStatistics("demo");
    });
    expect(exported).not.toBeNull();

    await store.transact(async (tx) => {
      if (!tx.transports) {
        throw new Error("missing transports");
      }

      await tx.transports.putStatistics("demo", exported!);
    });

    const after = await transportStatistics({ store, namespace: "demo" });
    expect(after).toEqual(before);
    expect(after.byIdentity["adapter.orders/binding.orders"]?.delivered).toBe(
      1,
    );
  });
});
