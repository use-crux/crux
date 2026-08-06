/**
 * Shared managed-transport store conformance for memory and durable adapters.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SignalProvider } from "../../../signal/provider";
import { signal } from "../../../signal/definition";
import { webhook } from "../../../signal/transport";
import { signalProvider } from "../../../signal/provider";
import type { RuntimeStoreAdapter } from "../../store";
import {
  acceptTransportEnvelope,
  createTransportNormalizationRunner,
  replayTransportEnvelope,
} from "../index";
import {
  createConformanceTransportProvider,
  sampleConformanceEnvelope,
} from "./conformance-fixtures";

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
        const { provider, published } = createConformanceTransportProvider();
        const accept = await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: sampleConformanceEnvelope("evt_accept"),
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
        const first = sampleConformanceEnvelope("evt_dup");
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
            envelope: sampleConformanceEnvelope("evt_dup", {
              orderId: "ord_other",
            }),
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
        const { provider, published } = createConformanceTransportProvider();
        await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: sampleConformanceEnvelope("evt_crash"),
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
        const published: string[] = [];
        const provider = createPoisonProvider(
          () => fail,
          (orderId) => {
            published.push(orderId);
          },
        );

        await acceptTransportEnvelope({
          store: harness.store,
          namespace: "conformance",
          envelope: sampleConformanceEnvelope("evt_poison"),
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

function createPoisonProvider(
  shouldFail: () => boolean,
  onPublish: (orderId: string) => void,
): SignalProvider {
  const orderSubmitted = signal({
    id: "order.submitted",
    schema: z.object({ orderId: z.string() }),
  });
  orderSubmitted.subscribe((occurrence) => {
    onPublish(occurrence.payload.orderId);
  });
  return signalProvider({
    id: "orders.webhook",
    transport: webhook({
      async handle() {
        throw new Error("unused");
      },
    }),
    signals: { orderSubmitted },
    async onEvent(envelope, { signals }) {
      if (shouldFail()) throw new Error("poison");
      const raw =
        envelope.payload.kind === "inline-base64url"
          ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
          : "";
      const body = JSON.parse(raw) as { orderId: string };
      // Omit explicit keys: runner-scoped defaults must prevent redelivery.
      await signals.orderSubmitted.publish({ orderId: body.orderId });
    },
  });
}
