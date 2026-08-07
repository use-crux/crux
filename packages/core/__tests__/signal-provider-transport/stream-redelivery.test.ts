/**
 * Crash between durable accept and cursor checkpoint: redelivery + dedupe.
 *
 * Proves at-least-once ingress with #337 envelope identity: the envelope stays
 * durable when checkpoint write fails, reconnect yields the same eventId,
 * accept returns duplicate, and Signal occurrence identity stays stable after
 * normalize. Cursor advances only after a successful post-accept checkpoint.
 */

import { describe, expect, it } from "vitest";

import {
  bindingLeaseResource,
  createTransportNormalizationRunner,
  inMemoryRuntimeStore,
} from "../../src/runtime/public";
import { isStreamTransport } from "../../src/signal/provider";
import { runStreamConnection } from "../../src/runtime/worker/worker-transport-stream";
import {
  createStreamFixture,
  envelopeItem,
} from "./stream-supervision-helpers";

const NOW = new Date("2026-08-07T18:00:00.000Z");

describe("stream accept/checkpoint redelivery", () => {
  it("redelivers the same envelope identity when checkpoint fails after accept", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([
      envelopeItem({ eventId: "evt_crash", cursor: "cursor:crash" }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-redelivery";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    // Test-only fault injection: fail the first post-accept checkpoint write.
    const transports = store.transports!;
    const originalPut = transports.putBindingCheckpoint!.bind(transports);
    let putAttempts = 0;
    transports.putBindingCheckpoint = async (input) => {
      putAttempts += 1;
      if (putAttempts === 1) {
        throw new Error("injected crash after accept before checkpoint");
      }
      return originalPut(input);
    };

    const transport = fixture.provider.transport;
    expect(isStreamTransport(transport)).toBe(true);
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    await expect(
      runStreamConnection({
        store,
        namespace,
        binding: fixture.binding,
        provider: fixture.provider,
        transport,
        checkpoint: null,
        lease,
        signal: new AbortController().signal,
        now: () => NOW,
        ownerId: "worker-a",
      }),
    ).rejects.toThrow(/injected crash after accept before checkpoint/);

    // Envelope is durable; cursor must not have advanced.
    const durable = await store.transports!.get({
      namespace,
      provider: "orders.stream",
      accountId: "acct_1",
      eventId: "evt_crash",
    });
    expect(durable?.state).toBe("accepted");
    expect(durable?.envelope.eventId).toBe("evt_crash");

    const checkpointAfterCrash =
      await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
    expect(checkpointAfterCrash).toBeNull();

    // Normalize once from the durable accept — establishes Signal occurrence.
    const drain = createTransportNormalizationRunner({
      store,
      namespace,
      providers: fixture.program.providers,
    });
    await drain.runOnce({ now: NOW });
    expect(fixture.published.map((entry) => entry.orderId)).toEqual([
      "ord_crash",
    ]);
    const occurrenceId = fixture.published[0]!.occurrenceId;

    // Reconnect / redelivery of the same logical event under a new connection.
    fixture.setItemSequence([
      envelopeItem({ eventId: "evt_crash", cursor: "cursor:crash" }),
    ]);

    const redelivery = await runStreamConnection({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      checkpoint: null,
      lease,
      signal: new AbortController().signal,
      now: () => new Date("2026-08-07T18:00:01.000Z"),
      ownerId: "worker-a",
    });

    expect(redelivery).toMatchObject({
      accepted: 0,
      duplicated: 1,
      checkpointed: true,
      failed: false,
      outcome: "eof",
    });

    const checkpointAfterReplay =
      await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
    expect(checkpointAfterReplay).toMatchObject({
      cursor: "cursor:crash",
      configRef: fixture.binding.configRef,
      status: "active",
    });

    // Drain again: no second logical Signal delivery for the same event.
    await drain.runOnce({ now: new Date("2026-08-07T18:00:02.000Z") });
    expect(fixture.published).toHaveLength(1);
    expect(fixture.published[0]!.occurrenceId).toBe(occurrenceId);

    // Same durable envelope identity (digest) remains the single row.
    const afterReplay = await store.transports!.get({
      namespace,
      provider: "orders.stream",
      accountId: "acct_1",
      eventId: "evt_crash",
    });
    expect(afterReplay?.envelopeDigest).toBe(durable?.envelopeDigest);
    expect(afterReplay?.state).toBe("normalized");
  });
});

async function claimBindingLease(
  store: ReturnType<typeof inMemoryRuntimeStore>,
  namespace: string,
  bindingId: string,
) {
  const lease = await store.leases.claim(
    bindingLeaseResource(namespace, bindingId),
    {
      ttlMs: 60_000,
      ownerId: "worker-a",
    },
  );
  expect(lease).not.toBeNull();
  return lease!;
}
