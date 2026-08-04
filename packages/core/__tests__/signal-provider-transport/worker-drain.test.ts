/**
 * Existing Runtime worker drains accepted Signal-provider envelopes.
 *
 * Vertical: createRuntimeProgram(providers + inert binding) → accept → worker
 * claims/normalizes through provider.onEvent → restart does not duplicate →
 * shutdown leaves claims under the existing lease/fence contract.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createHash } from "node:crypto";

import { signal } from "../../src/signal";
import { webhook } from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import {
  acceptTransportEnvelope,
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type RuntimeAcceptedTransportEnvelope,
} from "../../src/runtime/public";

function inlinePayload(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    kind: "inline-base64url" as const,
    value: Buffer.from(bytes).toString("base64url"),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function makeEnvelope(
  binding: ReturnType<typeof managedTransportBinding>,
  eventId: string,
  orderId = "ord_1",
): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: binding.id,
    adapterId: binding.adapter.id,
    provider: binding.adapter.provider,
    accountId: "acct_1",
    eventId,
    receivedAt: "2026-08-04T12:00:00.000Z",
    authenticatedRouting: { source: "webhook" },
    payload: inlinePayload(JSON.stringify({ orderId })),
    configRef: binding.configRef,
    target: binding.target,
  };
}

function createOrdersFixture(options?: {
  readonly failAfterPublish?: () => boolean;
  readonly failAlways?: boolean;
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
        throw new Error("edge not used in worker drain tests");
      },
    }),
    signals: { orderSubmitted },
    async onEvent(envelope, { signals }) {
      if (options?.failAlways) {
        throw Object.assign(new Error("normalization failed"), {
          code: "TEST_NORMALIZE_FAIL",
        });
      }
      const raw =
        envelope.payload.kind === "inline-base64url"
          ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
          : "";
      const body = JSON.parse(raw) as { orderId: string };
      await signals.orderSubmitted.publish({ orderId: body.orderId });
      if (options?.failAfterPublish?.()) {
        throw new Error("crash after publish");
      }
    },
  });
  const binding = managedTransportBinding(provider, {
    id: "binding.orders",
    configRef: { id: "config.orders", revision: "rev.1" },
    signalId: "order.submitted",
  });
  const program = createRuntimeProgram({
    targets: [],
    providers: [provider],
    transports: [binding],
  });
  return { binding, program, published };
}

async function envelopeState(
  store: ReturnType<typeof inMemoryRuntimeStore>,
  namespace: string,
  eventId: string,
) {
  return store.transports!.get({
    namespace,
    provider: "orders.webhook",
    accountId: "acct_1",
    eventId,
  });
}

describe("Runtime worker transport drain", () => {
  it("claims and normalizes an accepted envelope through program providers", async () => {
    const { binding, program, published } = createOrdersFixture();
    const store = inMemoryRuntimeStore();
    const accept = await acceptTransportEnvelope({
      store,
      namespace: "worker-drain",
      envelope: makeEnvelope(binding, "evt_worker_1"),
      now: new Date("2026-08-04T12:00:00.000Z"),
    });
    expect(accept.acknowledge).toBe(true);
    expect(published).toEqual([]);

    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "worker-drain",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });

    try {
      await expect
        .poll(() => published.map((entry) => entry.orderId))
        .toEqual(["ord_1"]);
      await expect
        .poll(async () => (await envelopeState(store, "worker-drain", "evt_worker_1"))?.state)
        .toBe("normalized");
    } finally {
      await worker.stop();
    }
    await expect(worker.closed).resolves.toBeUndefined();
  });

  it("does not redeliver after crash-after-publish when a replacement worker restarts", async () => {
    let failAfterPublish = true;
    const { binding, program, published } = createOrdersFixture({
      failAfterPublish: () => failAfterPublish,
    });
    const store = inMemoryRuntimeStore();
    await acceptTransportEnvelope({
      store,
      namespace: "worker-restart",
      envelope: makeEnvelope(binding, "evt_worker_restart"),
      maxAttempts: 4,
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    const first = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "worker-restart",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });
    try {
      await expect.poll(() => published.length).toBe(1);
      await first.stop();
    } finally {
      await first.stop().catch(() => undefined);
    }

    const firstOccurrenceId = published[0]!.occurrenceId;
    failAfterPublish = false;

    const afterCrash = await envelopeState(
      store,
      "worker-restart",
      "evt_worker_restart",
    );
    expect(afterCrash?.state).toBe("accepted");
    expect(afterCrash?.attempts).toBeGreaterThanOrEqual(1);

    const replacement = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "worker-restart",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });
    try {
      // Retry backoff is ~0.5–1s on the first failure; poll past it.
      await expect
        .poll(
          async () =>
            (await envelopeState(store, "worker-restart", "evt_worker_restart"))
              ?.state,
          { timeout: 10_000, interval: 50 },
        )
        .toBe("normalized");
      expect(published).toHaveLength(1);
      expect(published[0]!.occurrenceId).toBe(firstOccurrenceId);
    } finally {
      await replacement.stop();
    }
  });

  it("records retry metadata after normalization failure without publishing", async () => {
    const { binding, program, published } = createOrdersFixture({
      failAlways: true,
    });
    const store = inMemoryRuntimeStore();
    await acceptTransportEnvelope({
      store,
      namespace: "worker-retry",
      envelope: makeEnvelope(binding, "evt_worker_retry"),
      maxAttempts: 2,
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "worker-retry",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });
    try {
      await expect
        .poll(async () => {
          const record = await envelopeState(
            store,
            "worker-retry",
            "evt_worker_retry",
          );
          return record?.attempts ?? 0;
        })
        .toBeGreaterThanOrEqual(1);
      expect(published).toEqual([]);
      const afterFirst = await envelopeState(
        store,
        "worker-retry",
        "evt_worker_retry",
      );
      expect(["accepted", "dead-letter", "claimed"]).toContain(afterFirst?.state);
      expect(afterFirst?.lastFailure?.code).toBe("TEST_NORMALIZE_FAIL");
    } finally {
      await worker.stop();
    }
  });

  it("stops without duplicating a completed normalization", async () => {
    const { binding, program, published } = createOrdersFixture();
    const store = inMemoryRuntimeStore();
    await acceptTransportEnvelope({
      store,
      namespace: "worker-stop",
      envelope: makeEnvelope(binding, "evt_worker_stop"),
    });
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "worker-stop",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });
    await expect.poll(() => published.length).toBe(1);
    await worker.stop();
    await worker.stop();
    expect(published).toHaveLength(1);
    await expect(
      envelopeState(store, "worker-stop", "evt_worker_stop"),
    ).resolves.toMatchObject({ state: "normalized" });
  });
});
