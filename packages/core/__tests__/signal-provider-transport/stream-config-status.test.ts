/**
 * Stream checkpoint config identity invalidation and durable skip.
 */

import { describe, expect, it } from "vitest";

import {
  bindingLeaseResource,
  inMemoryRuntimeStore,
} from "../../src/runtime/public";
import { isStreamTransport } from "../../src/signal/provider";
import { resolveStreamCheckpoint } from "../../src/runtime/worker/worker-transport-stream-resolve";
import {
  runManagedStream,
} from "../../src/runtime/worker/worker-transport-stream";
import {
  createStreamFixture,
  envelopeItem,
  sampleCheckpoint,
} from "./stream-supervision-helpers";

const NOW = new Date("2026-08-07T17:00:00.000Z");

describe("resolveStreamCheckpoint", () => {
  it("over-invalidates cursor and non-active status when configRef changes", () => {
    const resolved = resolveStreamCheckpoint(
      sampleCheckpoint({
        namespace: "ns",
        bindingId: "b",
        cursor: "cursor:old",
        configRef: { id: "config.orders.stream", revision: "rev.1" },
        status: "faulted",
        lastErrorCode: "AUTH_REVOKED",
      }),
      { id: "config.orders.stream", revision: "rev.2" },
    );

    expect(resolved).toEqual({
      cursor: null,
      status: "active",
      skipOpen: false,
      configMatched: false,
    });
  });

  it("skips open for durable faulted/disabled under the same config", () => {
    const faulted = resolveStreamCheckpoint(
      sampleCheckpoint({
        namespace: "ns",
        bindingId: "b",
        cursor: "cursor:held",
        configRef: { id: "config.orders.stream", revision: "rev.1" },
        status: "faulted",
      }),
      { id: "config.orders.stream", revision: "rev.1" },
    );
    expect(faulted.skipOpen).toBe(true);
    expect(faulted.cursor).toBe("cursor:held");
    expect(faulted.status).toBe("faulted");

    const disabled = resolveStreamCheckpoint(
      sampleCheckpoint({
        namespace: "ns",
        bindingId: "b",
        cursor: "cursor:held",
        configRef: { id: "config.orders.stream", revision: "rev.1" },
        status: "disabled",
      }),
      { id: "config.orders.stream", revision: "rev.1" },
    );
    expect(disabled.skipOpen).toBe(true);
    expect(disabled.status).toBe("disabled");
  });

  it("resumes an active checkpoint cursor under the same config", () => {
    const resolved = resolveStreamCheckpoint(
      sampleCheckpoint({
        namespace: "ns",
        bindingId: "b",
        cursor: "cursor:resume",
        configRef: { id: "config.orders.stream", revision: "rev.1" },
        status: "active",
      }),
      { id: "config.orders.stream", revision: "rev.1" },
    );
    expect(resolved).toEqual({
      cursor: "cursor:resume",
      status: "active",
      skipOpen: false,
      configMatched: true,
    });
  });
});

describe("runManagedStream config + status", () => {
  it("opens with null cursor after config change and does not inherit faulted", async () => {
    const fixture = createStreamFixture({
      configRef: { id: "config.orders.stream", revision: "rev.2" },
    });
    const controller = new AbortController();
    fixture.setItems(async function* (context) {
      expect(context.cursor).toBeNull();
      expect(context.configRef).toEqual({
        id: "config.orders.stream",
        revision: "rev.2",
      });
      yield envelopeItem({ eventId: "evt_new", cursor: "cursor:new" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-config-invalidate";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    // Prior identity under rev.1 was faulted with a stored cursor.
    await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId: fixture.binding.id,
        cursor: "cursor:old",
        lastOwnerId: "worker-a",
        configRef: { id: "config.orders.stream", revision: "rev.1" },
        status: "faulted",
        lastErrorCode: "AUTH_REVOKED",
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
      signal: controller.signal,
      now: NOW,
      ownerId: "worker-a",
      clock: {
        now: () => NOW,
        delay: async () => {
          controller.abort();
        },
      },
      rng: () => 0.5,
    });

    expect(fixture.openCalls).toHaveLength(1);
    expect(fixture.openCalls[0]?.cursor).toBeNull();
    expect(result.accepted).toBe(1);
    expect(result.failed).toBe(false);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint).toMatchObject({
      cursor: "cursor:new",
      status: "active",
      configRef: { id: "config.orders.stream", revision: "rev.2" },
    });
  });

  it("does not call open when durable status is faulted under the same config", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async function* () {
      throw new Error("open must not run");
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-skip-faulted";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId: fixture.binding.id,
        cursor: "cursor:held",
        lastOwnerId: "worker-a",
        configRef: fixture.binding.configRef,
        status: "faulted",
        lastErrorCode: "AUTH_REVOKED",
      }),
      lease,
    });

    const transport = fixture.provider.transport;
    if (!isStreamTransport(transport)) {
      throw new Error("expected stream transport");
    }

    // Skip decision is pure over the unfenced get — no open, no progress write.
    const resolved = resolveStreamCheckpoint(
      await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      }),
      fixture.binding.configRef,
    );
    expect(resolved.skipOpen).toBe(true);

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
          throw new Error("should not backoff when skipped");
        },
      },
      rng: () => 0.5,
    });

    expect(fixture.openCalls).toHaveLength(0);
    expect(result.opens).toBe(0);
    expect(result.outcome).toBe("terminal");
    expect(result.failed).toBe(true);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.cursor).toBe("cursor:held");
    expect(checkpoint?.status).toBe("faulted");
  });

  it("does not call open when durable status is disabled under the same config", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async function* () {
      throw new Error("open must not run");
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-skip-disabled";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId: fixture.binding.id,
        cursor: "cursor:held",
        lastOwnerId: "worker-a",
        configRef: fixture.binding.configRef,
        status: "disabled",
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
    });

    expect(fixture.openCalls).toHaveLength(0);
    expect(result.opens).toBe(0);
    expect(result.outcome).toBe("skipped");
    expect(result.failed).toBe(false);
  });

  it("resumes open from the stored cursor when status is cleared to active", async () => {
    const fixture = createStreamFixture();
    const controller = new AbortController();
    fixture.setItems(async function* (context) {
      expect(context.cursor).toBe("cursor:resume");
      yield envelopeItem({ eventId: "evt_resume", cursor: "cursor:after" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-resume-active";
    const lease = await claimBindingLease(store, namespace, fixture.binding.id);

    await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId: fixture.binding.id,
        cursor: "cursor:resume",
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
      signal: controller.signal,
      now: NOW,
      ownerId: "worker-a",
      clock: {
        now: () => NOW,
        delay: async () => {
          controller.abort();
        },
      },
      rng: () => 0.5,
    });

    expect(fixture.openCalls).toHaveLength(1);
    expect(fixture.openCalls[0]?.cursor).toBe("cursor:resume");
    expect(result.accepted).toBe(1);

    const checkpoint = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId: fixture.binding.id,
    });
    expect(checkpoint?.cursor).toBe("cursor:after");
    expect(checkpoint?.status).toBe("active");
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
