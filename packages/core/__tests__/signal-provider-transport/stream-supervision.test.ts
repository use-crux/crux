/**
 * Single leased stream connection: accept + lease-fenced checkpoint.
 */

import { describe, expect, it } from "vitest";

import {
  bindingLeaseResource,
  inMemoryRuntimeStore,
  ManagedStreamTerminalError,
} from "../../src/runtime/public";
import { isStreamTransport } from "../../src/signal/provider";
import { runStreamConnection } from "../../src/runtime/worker/worker-transport-stream";
import {
  createStreamFixture,
  cursorItem,
  envelopeItem,
  sampleCheckpoint,
} from "./stream-supervision-helpers";

const NOW = new Date("2026-08-07T15:00:00.000Z");

describe("runStreamConnection (single leased connection)", () => {
  it("accepts an envelope with cursor and checkpoints cursor+configRef+active", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([
      envelopeItem({ eventId: "evt_1", cursor: "cursor:1" }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-accept-cursor";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    expect(isStreamTransport(transport)).toBe(true);
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const result = await runStreamConnection({
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
    });

    expect(result).toMatchObject({
      accepted: 1,
      duplicated: 0,
      checkpointed: true,
      failed: false,
      leaseLost: false,
      outcome: "eof",
    });

    const envelope = await store.transports!.get({
      namespace,
      provider: "orders.stream",
      accountId: "acct_1",
      eventId: "evt_1",
    });
    expect(envelope?.state).toBe("accepted");

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint).toMatchObject({
      cursor: "cursor:1",
      configRef: { id: "config.orders.stream", revision: "rev.1" },
      status: "active",
      lastOwnerId: "worker-a",
    });
    expect(fixture.openCalls).toHaveLength(1);
    expect(fixture.openCalls[0]?.cursor).toBeNull();
    expect(fixture.openCalls[0]?.configRef).toEqual(fixture.binding.configRef);
  });

  it("accepts an envelope without cursor and leaves the durable cursor unchanged", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([envelopeItem({ eventId: "evt_2" })]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-accept-no-cursor";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId: fixture.binding.id,
        cursor: "cursor:held",
        lastOwnerId: "worker-a",
        configRef: fixture.binding.configRef,
        status: "active",
      }),
      lease,
    });

    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const prior = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });

    const result = await runStreamConnection({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      checkpoint: prior,
      lease,
      signal: new AbortController().signal,
      now: () => NOW,
      ownerId: "worker-a",
    });

    expect(result.accepted).toBe(1);
    expect(result.checkpointed).toBe(false);
    expect(result.failed).toBe(false);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.cursor).toBe("cursor:held");
  });

  it("checkpoints cursor-only progress without a new envelope", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([cursorItem("cursor:hb-9")]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-cursor-only";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const result = await runStreamConnection({
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
    });

    expect(result).toMatchObject({
      accepted: 0,
      checkpointed: true,
      failed: false,
      outcome: "eof",
    });

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint).toMatchObject({
      cursor: "cursor:hb-9",
      configRef: fixture.binding.configRef,
      status: "active",
    });

    await expect(
      store.transports!.get({
        namespace,
        provider: "orders.stream",
        accountId: "acct_1",
        eventId: "evt_1",
      }),
    ).resolves.toBeNull();
  });

  it("retains a prior checkpoint when a later item fails before its cursor write", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([
      envelopeItem({ eventId: "evt_ok", cursor: "cursor:ok" }),
      // Missing kind → contract invalid after the successful checkpoint.
      { accountId: "acct_1", eventId: "evt_bad" } as never,
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-partial-retain";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const result = await runStreamConnection({
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
    });

    expect(result.accepted).toBe(1);
    expect(result.failed).toBe(true);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.cursor).toBe("cursor:ok");
    expect(checkpoint?.status).toBe("active");

    const ok = await store.transports!.get({
      namespace,
      provider: "orders.stream",
      accountId: "acct_1",
      eventId: "evt_ok",
    });
    expect(ok?.state).toBe("accepted");
  });

  it("does not advance the checkpoint for a leading contract-invalid item", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([
      { kind: "envelope", eventId: "evt_1" } as never,
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-contract-invalid";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId: fixture.binding.id,
        cursor: "cursor:prior",
        lastOwnerId: "worker-a",
        configRef: fixture.binding.configRef,
        status: "active",
      }),
      lease,
    });

    const prior = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const result = await runStreamConnection({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      checkpoint: prior,
      lease,
      signal: new AbortController().signal,
      now: () => NOW,
      ownerId: "worker-a",
    });

    expect(result.accepted).toBe(0);
    expect(result.checkpointed).toBe(false);
    expect(result.failed).toBe(true);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.cursor).toBe("cursor:prior");
  });

  it("writes durable faulted status on terminal error without advancing the cursor", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async function* () {
      yield envelopeItem({ eventId: "evt_before", cursor: "cursor:before" });
      throw new ManagedStreamTerminalError("AUTH_REVOKED", "token revoked");
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-terminal-fault";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const result = await runStreamConnection({
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
    });

    expect(result).toMatchObject({
      accepted: 1,
      failed: true,
      outcome: "terminal",
      lastErrorCode: "AUTH_REVOKED",
    });

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint).toMatchObject({
      cursor: "cursor:before",
      status: "faulted",
      lastErrorCode: "AUTH_REVOKED",
      configRef: fixture.binding.configRef,
    });
  });

  it("evaluates the injected clock immediately before each checkpoint write", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([
      envelopeItem({ eventId: "evt_1", cursor: "cursor:1" }),
      envelopeItem({ eventId: "evt_2", cursor: "cursor:2" }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-clock-per-checkpoint";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    let tick = 0;
    const stamps = [
      new Date("2026-08-07T15:00:00.000Z"),
      new Date("2026-08-07T15:00:10.000Z"),
      new Date("2026-08-07T15:00:20.000Z"),
      new Date("2026-08-07T15:00:30.000Z"),
    ];

    const result = await runStreamConnection({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      checkpoint: null,
      lease,
      signal: new AbortController().signal,
      now: () => stamps[Math.min(tick++, stamps.length - 1)]!,
      ownerId: "worker-a",
    });

    expect(result).toMatchObject({
      accepted: 2,
      checkpointed: true,
      outcome: "eof",
    });
    expect(tick).toBeGreaterThanOrEqual(2);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    // Final checkpoint uses a later stamp than the first accept/checkpoint path.
    expect(checkpoint?.updatedAt).toBe("2026-08-07T15:00:30.000Z");
    expect(checkpoint?.lastPolledAt).toBe("2026-08-07T15:00:30.000Z");
    expect(checkpoint?.cursor).toBe("cursor:2");
  });

  it("does not treat TransportEnvelopeConflictError as duplicate or advance the cursor", async () => {
    const fixture = createStreamFixture();
    const store = inMemoryRuntimeStore();
    const namespace = "stream-conflict-no-advance";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId: fixture.binding.id,
        cursor: "cursor:prior",
        lastOwnerId: "worker-a",
        configRef: fixture.binding.configRef,
        status: "active",
      }),
      lease,
    });

    // Seed a durable envelope, then re-yield a conflicting digest for the same identity.
    const first = envelopeItem({ eventId: "evt_conflict", cursor: "cursor:would-advance" });
    fixture.setItemSequence([first]);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const prior = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });

    await runStreamConnection({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      checkpoint: prior,
      lease,
      signal: new AbortController().signal,
      now: () => NOW,
      ownerId: "worker-a",
    });

    // Conflicting payload (different digest, same identity).
    const conflicting = {
      kind: "envelope" as const,
      accountId: "acct_1",
      eventId: "evt_conflict",
      authenticatedRouting: { source: "stream" },
      payload: {
        kind: "inline-base64url" as const,
        value: "Yg",
        byteLength: 1,
        sha256:
          "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
      },
      cursor: "cursor:conflict",
    };
    fixture.setItemSequence([conflicting]);

    const afterFirst = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });

    const conflictResult = await runStreamConnection({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      checkpoint: afterFirst,
      lease,
      signal: new AbortController().signal,
      now: () => new Date("2026-08-07T15:01:00.000Z"),
      ownerId: "worker-a",
    });

    expect(conflictResult).toMatchObject({
      accepted: 0,
      duplicated: 0,
      checkpointed: false,
      failed: true,
      lastErrorCode: "TRANSPORT_ENVELOPE_CONFLICT",
    });

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.cursor).toBe("cursor:would-advance");
    expect(checkpoint?.status).toBe("active");
    expect(checkpoint?.lastErrorCode).toBe("TRANSPORT_ENVELOPE_CONFLICT");

    const original = await store.transports!.get({
      namespace,
      provider: "orders.stream",
      accountId: "acct_1",
      eventId: "evt_conflict",
    });
    expect(original?.envelope.payload).toEqual(
      (first as { payload: unknown }).payload,
    );
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
