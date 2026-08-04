/**
 * Shared managed-transport store conformance for memory and durable adapters.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { sha256Hex } from "../../../content/sha256";
import type { SignalProvider } from "../../../signal/provider";
import { signal } from "../../../signal/definition";
import { webhook } from "../../../signal/transport";
import { signalProvider } from "../../../signal/provider";
import type { RuntimeStoreAdapter } from "../../store";
import {
  acceptTransportEnvelope,
  createTransportNormalizationRunner,
  replayTransportEnvelope,
  type RuntimeAcceptedTransportEnvelope,
} from "../index";

/** Adapter harness required by transport store conformance. */
export interface TransportStoreConformanceHarness {
  readonly store: RuntimeStoreAdapter;
  dispose(): Promise<void> | void;
}

/** Options for {@link runTransportStoreConformanceTests}. */
export interface RunTransportStoreConformanceTestsOptions {
  readonly name: string;
  createHarness(
    law: string,
  ): Promise<TransportStoreConformanceHarness> | TransportStoreConformanceHarness;
}

/**
 * Register provider-neutral transport envelope lifecycle laws.
 *
 * @remarks Covers accept-before-ack, duplicate/conflict, crash-after-ack,
 * bounded retry/dead-letter, and explicit replay. Normalization uses the
 * restart-safe runner; the Runtime worker invokes the same kernel on its
 * maintenance cadence.
 */
export function runTransportStoreConformanceTests(
  options: RunTransportStoreConformanceTestsOptions,
): void {
  describe(`${options.name} transport store conformance`, () => {
    it("accepts before acknowledgment and normalizes into one Signal", async () => {
      const harness = await options.createHarness("accept-normalize");
      try {
        const { provider, published } = createProvider();
        const accept = await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: sampleEnvelope("evt_accept"),
          now: new Date("2026-08-04T12:00:00.000Z"),
        });
        expect(accept.acknowledge).toBe(true);
        expect(published).toEqual([]);

        const runner = createTransportNormalizationRunner({
          store: harness.store,
          namespace: "conformance",
          providers: [provider],
        });
        const run = await runner.runOnce({
          now: new Date("2026-08-04T12:00:01.000Z"),
        });
        expect(run).toEqual({
          claimed: 1,
          normalized: 1,
          retried: 0,
          deadLettered: 0,
        });
        expect(published).toEqual(["ord_1"]);
      } finally {
        await harness.dispose();
      }
    });

    it("treats same-digest retries as duplicates and conflicts on digest change", async () => {
      const harness = await options.createHarness("duplicate-conflict");
      try {
        const first = sampleEnvelope("evt_dup");
        await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: first,
          now: new Date("2026-08-04T12:00:00.000Z"),
        });
        const duplicate = await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: first,
          now: new Date("2026-08-04T12:00:01.000Z"),
        });
        expect(duplicate.kind).toBe("duplicate");
        expect(duplicate.acknowledge).toBe(true);

        await expect(
          acceptTransportEnvelope({
            store: harness.store,
            namespace: "conformance",
            envelope: sampleEnvelope("evt_dup", { orderId: "ord_other" }),
            now: new Date("2026-08-04T12:00:02.000Z"),
          }),
        ).rejects.toMatchObject({ code: "TRANSPORT_ENVELOPE_CONFLICT" });
      } finally {
        await harness.dispose();
      }
    });

    it("recovers accepted envelopes after a crash between ack and normalize", async () => {
      const harness = await options.createHarness("crash-after-ack");
      try {
        const { provider, published } = createProvider();
        await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: sampleEnvelope("evt_crash"),
          now: new Date("2026-08-04T12:00:00.000Z"),
        });
        expect(published).toEqual([]);

        const runner = createTransportNormalizationRunner({
          store: harness.store,
          namespace: "conformance",
          providers: [provider],
        });
        await expect(
          runner.runOnce({ now: new Date("2026-08-04T12:00:05.000Z") }),
        ).resolves.toMatchObject({ claimed: 1, normalized: 1 });
        expect(published).toEqual(["ord_1"]);
      } finally {
        await harness.dispose();
      }
    });

    it("dead-letters after bounded retries and accepts explicit replay", async () => {
      const harness = await options.createHarness("dead-letter-replay");
      try {
        let fail = true;
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
              throw new Error("unused");
            },
          }),
          signals: { orderSubmitted },
          async onEvent(envelope, { signals }) {
            if (fail) throw new Error("poison");
            const raw =
              envelope.payload.kind === "inline-base64url"
                ? Buffer.from(envelope.payload.value, "base64url").toString(
                    "utf8",
                  )
                : "";
            const body = JSON.parse(raw) as { orderId: string };
            // Omit explicit keys: runner-scoped defaults must prevent redelivery.
            await signals.orderSubmitted.publish({ orderId: body.orderId });
          },
        });

        await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: sampleEnvelope("evt_poison"),
          maxAttempts: 2,
          now: new Date("2026-08-04T12:00:00.000Z"),
        });

        const runner = createTransportNormalizationRunner({
          store: harness.store,
          namespace: "conformance",
          providers: [provider],
        });
        await runner.runOnce({
          now: new Date("2026-08-04T12:00:01.000Z"),
          rng: () => 0,
        });
        const afterRetry = await harness.store.transports!.get({
          namespace: "conformance",
          provider: "orders.webhook",
          accountId: "acct_1",
          eventId: "evt_poison",
        });
        expect(afterRetry?.state).toBe("accepted");
        expect(afterRetry?.attempts).toBe(1);
        const retryAt = new Date(
          Math.max(
            Date.parse(afterRetry!.nextAttemptAt) + 1,
            Date.parse("2026-08-04T12:00:01.000Z") + 60_000,
          ),
        );
        await runner.runOnce({
          now: retryAt,
          rng: () => 0,
        });
        const dead = await harness.store.transports!.get({
          namespace: "conformance",
          provider: "orders.webhook",
          accountId: "acct_1",
          eventId: "evt_poison",
        });
        expect(dead?.state).toBe("dead-letter");

        fail = false;
        await replayTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          provider: "orders.webhook",
          accountId: "acct_1",
          eventId: "evt_poison",
          now: new Date("2026-08-04T13:00:00.000Z"),
        });
        await runner.runOnce({
          now: new Date("2026-08-04T13:00:01.000Z"),
        });
        expect(published).toEqual(["ord_1"]);
      } finally {
        await harness.dispose();
      }
    });
  });
}

function createProvider(): {
  readonly provider: SignalProvider;
  readonly published: string[];
} {
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
      // Omit explicit keys so crash-safe default scoping is exercised.
      await signals.orderSubmitted.publish({ orderId: body.orderId });
    },
  });
  return { provider, published };
}

function sampleEnvelope(
  eventId: string,
  body: { orderId: string } = { orderId: "ord_1" },
): RuntimeAcceptedTransportEnvelope {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const value = encodeBase64Url(bytes);
  const sha256 = sha256Hex(bytes);
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

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
