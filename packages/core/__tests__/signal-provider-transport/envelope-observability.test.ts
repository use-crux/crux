/**
 * Accept/normalize must stay correct when observability sinks misbehave.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { observe } from "../../src/observability/observe";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  acceptTransportEnvelope,
  emitTransportEnvelopeObservability,
} from "../../src/runtime/public";
import { createPollingFixture, inlinePayload } from "./polling-supervision-helpers";

afterEach(() => {
  resetObservabilityRuntime();
  vi.restoreAllMocks();
});

describe("transport envelope observability isolation", () => {
  it("keeps accept durable and successful when openRun throws", async () => {
    const fixture = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const now = new Date("2026-08-08T12:00:00.000Z");

    setObservabilityTransport({
      exportBatch: async () => undefined,
    });
    vi.spyOn(observe, "openRun").mockImplementation(() => {
      throw new Error("observability sink exploded");
    });

    const result = await acceptTransportEnvelope({
      store,
      namespace: "obs",
      envelope: {
        _tag: "RuntimeAcceptedTransportEnvelope",
        schemaVersion: 1,
        bindingId: fixture.binding.id,
        adapterId: fixture.binding.adapter.id,
        provider: fixture.binding.adapter.provider,
        accountId: "acct_obs",
        eventId: "evt_obs_1",
        receivedAt: now.toISOString(),
        authenticatedRouting: { source: "test" },
        payload: inlinePayload(JSON.stringify({ orderId: "ord_obs" })),
        configRef: fixture.binding.configRef,
        target: fixture.binding.target,
      },
      now,
    });

    expect(result.kind).toBe("accepted");
    expect(result.acknowledge).toBe(true);

    const stored = await store.transact(async (tx) =>
      tx.transports!.get({
        namespace: "obs",
        provider: fixture.binding.adapter.provider,
        accountId: "acct_obs",
        eventId: "evt_obs_1",
      }),
    );
    expect(stored?.state).toBe("accepted");
  });

  it("swallows projection-time failures without rethrowing", () => {
    setObservabilityTransport({
      exportBatch: async () => undefined,
    });
    expect(() =>
      emitTransportEnvelopeObservability(
        {
          schemaVersion: 1,
          namespace: "obs",
          provider: "orders",
          accountId: "acct",
          eventId: "evt",
          bindingId: "binding",
          envelope: null as never,
          envelopeDigest: "digest",
          state: "accepted",
          attempts: 0,
          maxAttempts: 5,
          acceptedAt: "2026-08-08T12:00:00.000Z",
          updatedAt: "2026-08-08T12:00:00.000Z",
          nextAttemptAt: "2026-08-08T12:00:00.000Z",
        },
        "accepted",
      ),
    ).not.toThrow();
  });
});
