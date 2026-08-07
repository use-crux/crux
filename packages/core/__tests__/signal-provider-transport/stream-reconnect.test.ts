/**
 * Managed stream reconnect: clean EOF, transient backoff, exhaustion, abort.
 */

import { describe, expect, it } from "vitest";

import {
  bindingLeaseResource,
  inMemoryRuntimeStore,
  ManagedStreamTerminalError,
} from "../../src/runtime/public";
import { isStreamTransport } from "../../src/signal/provider";
import {
  MAX_STREAM_TRANSIENT_FAILURES,
  runManagedStream,
  TRANSPORT_STREAM_EXHAUSTED,
} from "../../src/runtime/worker/worker-transport-stream";
import {
  createStreamFixture,
  envelopeItem,
  sampleCheckpoint,
} from "./stream-supervision-helpers";

const NOW = new Date("2026-08-07T16:00:00.000Z");

describe("runManagedStream reconnect loop", () => {
  it("reconnects after clean EOF from the durable cursor", async () => {
    const fixture = createStreamFixture();
    const controller = new AbortController();
    let openCount = 0;
    fixture.setItems(async function* (context) {
      openCount += 1;
      if (openCount === 1) {
        expect(context.cursor).toBeNull();
        yield envelopeItem({ eventId: "evt_1", cursor: "cursor:1" });
        return;
      }
      if (openCount === 2) {
        expect(context.cursor).toBe("cursor:1");
        yield envelopeItem({ eventId: "evt_2", cursor: "cursor:2" });
        return;
      }
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-eof-reconnect";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const delays: number[] = [];

    const result = await runManagedStream({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      lease,
      signal: controller.signal,
      now: NOW,
      ownerId: "worker-a",
      clock: {
        now: () => NOW,
        delay: async (ms) => {
          delays.push(ms);
          // After the second connection's EOF, cancel before a third open.
          if (openCount >= 2) {
            controller.abort();
          }
        },
      },
      rng: () => 1, // full jitter upper bound → delay = exponential
    });

    expect(result.outcome).toBe("aborted");
    expect(result.accepted).toBe(2);
    expect(fixture.openCalls.map((call) => call.cursor)).toEqual([
      null,
      "cursor:1",
    ]);
    expect(delays.length).toBeGreaterThanOrEqual(1);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.cursor).toBe("cursor:2");
    expect(checkpoint?.status).toBe("active");
  });

  it("backs off after a transient throw then reopens from the durable cursor", async () => {
    const fixture = createStreamFixture();
    const controller = new AbortController();
    let openCount = 0;
    fixture.setItems(async function* (context) {
      openCount += 1;
      if (openCount === 1) {
        yield envelopeItem({ eventId: "evt_1", cursor: "cursor:1" });
        throw Object.assign(new Error("blip"), { code: "PROVIDER_BLIP" });
      }
      expect(context.cursor).toBe("cursor:1");
      yield envelopeItem({ eventId: "evt_2", cursor: "cursor:2" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-transient-backoff";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const delays: number[] = [];

    const result = await runManagedStream({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      lease,
      signal: controller.signal,
      now: NOW,
      ownerId: "worker-a",
      clock: {
        now: () => NOW,
        delay: async (ms) => {
          delays.push(ms);
          if (openCount >= 2) {
            controller.abort();
          }
        },
      },
      // rng=1 → jitter factor 1.0 → exact exponential base for attempt 1 = 1000
      rng: () => 1,
    });

    expect(result.accepted).toBe(2);
    expect(result.outcome).toBe("aborted");
    expect(delays[0]).toBe(1000);
    expect(fixture.openCalls).toHaveLength(2);
    expect(fixture.openCalls[1]?.cursor).toBe("cursor:1");
  });

  it("faults with TRANSPORT_STREAM_EXHAUSTED after bounded consecutive transient failures", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async function* () {
      throw Object.assign(new Error("down"), { code: "PROVIDER_DOWN" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-exhausted";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const maxFailures = 3;
    const result = await runManagedStream({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      lease,
      signal: new AbortController().signal,
      now: NOW,
      ownerId: "worker-a",
      maxTransientFailures: maxFailures,
      clock: {
        now: () => NOW,
        delay: async () => {},
      },
      rng: () => 0.5,
    });

    expect(result.outcome).toBe("exhausted");
    expect(result.failed).toBe(true);
    expect(result.lastErrorCode).toBe(TRANSPORT_STREAM_EXHAUSTED);
    expect(fixture.openCalls).toHaveLength(maxFailures);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint).toMatchObject({
      status: "faulted",
      lastErrorCode: TRANSPORT_STREAM_EXHAUSTED,
      cursor: null,
      configRef: fixture.binding.configRef,
    });
  });

  it("resets the consecutive failure counter after a successful accept+checkpoint", async () => {
    const fixture = createStreamFixture();
    const controller = new AbortController();
    let openCount = 0;
    fixture.setItems(async function* () {
      openCount += 1;
      if (openCount <= 2) {
        throw Object.assign(new Error("flaky"), { code: "PROVIDER_FLAKY" });
      }
      if (openCount === 3) {
        yield envelopeItem({ eventId: "evt_ok", cursor: "cursor:ok" });
        return;
      }
      // After success, two more failures should not exhaust at max=3
      // because the counter was reset by the successful connection.
      if (openCount <= 5) {
        throw Object.assign(new Error("flaky-again"), {
          code: "PROVIDER_FLAKY",
        });
      }
      yield envelopeItem({ eventId: "evt_done", cursor: "cursor:done" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-reset-failures";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const result = await runManagedStream({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      lease,
      signal: controller.signal,
      now: NOW,
      ownerId: "worker-a",
      maxTransientFailures: 3,
      clock: {
        now: () => NOW,
        delay: async () => {
          if (openCount >= 6) {
            controller.abort();
          }
        },
      },
      rng: () => 0.5,
    });

    expect(result.outcome).toBe("aborted");
    expect(result.failed).toBe(false);
    expect(fixture.openCalls.length).toBe(6);
    expect(result.accepted).toBe(2);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.status).toBe("active");
    expect(checkpoint?.cursor).toBe("cursor:done");
  });

  it("does not count AbortError as a transient failure or reconnect", async () => {
    const fixture = createStreamFixture();
    const controller = new AbortController();
    fixture.setItems(async function* (context) {
      // Abort only after open is underway so the attempt is observed.
      controller.abort();
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) {
          resolve();
          return;
        }
        context.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      throw new DOMException("aborted", "AbortError");
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-abort-no-fail";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);
    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    const delays: number[] = [];

    const result = await runManagedStream({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      lease,
      signal: controller.signal,
      now: NOW,
      ownerId: "worker-a",
      maxTransientFailures: 2,
      clock: {
        now: () => NOW,
        delay: async (ms) => {
          delays.push(ms);
        },
      },
      rng: () => 0.5,
    });

    expect(result.failed).toBe(false);
    expect(result.outcome).toBe("aborted");
    expect(fixture.openCalls).toHaveLength(1);
    expect(delays).toEqual([]);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    // No durable faulted write from abort.
    expect(checkpoint?.status === "faulted").toBe(false);
  });

  it("exports the production exhaustion bound for documentation/tests", () => {
    expect(MAX_STREAM_TRANSIENT_FAILURES).toBe(32);
  });

  it("writes durable faulted on terminal without reconnecting", async () => {
    const fixture = createStreamFixture();
    let opens = 0;
    fixture.setItems(async function* () {
      opens += 1;
      throw new ManagedStreamTerminalError("AUTH_REVOKED");
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-terminal-no-reconnect";
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

    const result = await runManagedStream({
      store,
      namespace,
      binding: fixture.binding,
      provider: fixture.provider,
      transport,
      lease,
      signal: new AbortController().signal,
      now: NOW,
      ownerId: "worker-a",
      clock: {
        now: () => NOW,
        delay: async () => {
          throw new Error("should not backoff after terminal");
        },
      },
      rng: () => 0.5,
    });

    expect(result.outcome).toBe("terminal");
    expect(opens).toBe(1);
    expect(fixture.openCalls).toHaveLength(1);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint).toMatchObject({
      cursor: "cursor:held",
      status: "faulted",
      lastErrorCode: "AUTH_REVOKED",
    });
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
