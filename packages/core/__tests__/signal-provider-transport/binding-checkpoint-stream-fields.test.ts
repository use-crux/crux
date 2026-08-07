/**
 * Additive binding checkpoint fields for managed stream supervision:
 * configRef identity and active|faulted|disabled status.
 */

import { describe, expect, it } from "vitest";

import {
  bindingLeaseResource,
  inMemoryRuntimeStore,
  type Lease,
  type LeaseToken,
  type RuntimeTransportBindingCheckpoint,
} from "../../src/runtime/public";

function baseCheckpoint(
  options: Partial<RuntimeTransportBindingCheckpoint> & {
    readonly namespace: string;
    readonly bindingId: string;
  },
): RuntimeTransportBindingCheckpoint {
  return Object.freeze({
    schemaVersion: 1 as const,
    namespace: options.namespace,
    bindingId: options.bindingId,
    cursor: options.cursor ?? "cursor:1",
    updatedAt: options.updatedAt ?? "2026-08-07T12:00:00.000Z",
    ...(options.lastPolledAt !== undefined
      ? { lastPolledAt: options.lastPolledAt }
      : { lastPolledAt: "2026-08-07T12:00:00.000Z" }),
    ...(options.lastOwnerId !== undefined
      ? { lastOwnerId: options.lastOwnerId }
      : {}),
    ...(options.lastErrorCode !== undefined
      ? { lastErrorCode: options.lastErrorCode }
      : {}),
    ...(options.morePending === true ? { morePending: true as const } : {}),
    ...(options.configRef !== undefined
      ? { configRef: options.configRef }
      : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  });
}

describe("Memory binding checkpoint stream fields", () => {
  it("round-trips configRef and status on put/get", async () => {
    const store = inMemoryRuntimeStore();
    const namespace = "checkpoint-stream-fields";
    const bindingId = "binding.orders.stream";
    const resource = bindingLeaseResource(namespace, bindingId);
    const lease = await store.leases.claim(resource, {
      ttlMs: 30_000,
      ownerId: "worker-a",
    });
    expect(lease).not.toBeNull();

    const written = baseCheckpoint({
      namespace,
      bindingId,
      cursor: "cursor:stream-1",
      lastOwnerId: "worker-a",
      configRef: { id: "config.orders", revision: "rev.2" },
      status: "active",
    });

    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: written,
        lease: lease!,
      }),
    ).toEqual({ kind: "accepted" });

    const read = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId,
    });
    expect(read).toEqual(written);
    expect(read?.configRef).toEqual({
      id: "config.orders",
      revision: "rev.2",
    });
    expect(read?.status).toBe("active");
  });

  it("round-trips faulted and disabled status values", async () => {
    const store = inMemoryRuntimeStore();
    const namespace = "checkpoint-stream-status";
    const bindingId = "binding.orders.stream.status";
    const resource = bindingLeaseResource(namespace, bindingId);
    const lease = await store.leases.claim(resource, {
      ttlMs: 30_000,
      ownerId: "worker-a",
    });
    expect(lease).not.toBeNull();

    for (const status of ["faulted", "disabled"] as const) {
      const written = baseCheckpoint({
        namespace,
        bindingId,
        cursor: "cursor:held",
        lastOwnerId: "worker-a",
        lastErrorCode:
          status === "faulted" ? "TRANSPORT_STREAM_TERMINAL" : undefined,
        configRef: { id: "config.orders", revision: "rev.1" },
        status,
      });

      expect(
        await store.transports!.putBindingCheckpoint!({
          checkpoint: written,
          lease: lease!,
        }),
      ).toEqual({ kind: "accepted" });

      await expect(
        store.transports!.getBindingCheckpoint!({ namespace, bindingId }),
      ).resolves.toMatchObject({
        cursor: "cursor:held",
        status,
        configRef: { id: "config.orders", revision: "rev.1" },
      });
    }
  });

  it("decodes omitted configRef and status as today (absent fields)", async () => {
    const store = inMemoryRuntimeStore();
    const namespace = "checkpoint-stream-omitted";
    const bindingId = "binding.orders.poll.legacy";
    const resource = bindingLeaseResource(namespace, bindingId);
    const lease = await store.leases.claim(resource, {
      ttlMs: 30_000,
      ownerId: "worker-a",
    });
    expect(lease).not.toBeNull();

    const legacy = baseCheckpoint({
      namespace,
      bindingId,
      cursor: "cursor:legacy",
      lastOwnerId: "worker-a",
    });
    expect("configRef" in legacy).toBe(false);
    expect("status" in legacy).toBe(false);

    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: legacy,
        lease: lease!,
      }),
    ).toEqual({ kind: "accepted" });

    const read = await store.transports!.getBindingCheckpoint!({
      namespace,
      bindingId,
    });
    expect(read).toEqual(legacy);
    expect(read).not.toHaveProperty("configRef");
    expect(read).not.toHaveProperty("status");
  });

  it("still fences putBindingCheckpoint on stale lease tokens with stream fields", async () => {
    const store = inMemoryRuntimeStore();
    const namespace = "checkpoint-stream-fence";
    const bindingId = "binding.orders.stream.fence";
    const resource = bindingLeaseResource(namespace, bindingId);
    const lease = await store.leases.claim(resource, {
      ttlMs: 30_000,
      ownerId: "worker-a",
    });
    expect(lease).not.toBeNull();

    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: baseCheckpoint({
          namespace,
          bindingId,
          cursor: "cursor:1",
          lastOwnerId: "worker-a",
          configRef: { id: "config.orders", revision: "rev.1" },
          status: "active",
        }),
        lease: lease!,
      }),
    ).toEqual({ kind: "accepted" });

    const stale: Lease = Object.freeze({
      ...lease!,
      token: "lease_stale" as LeaseToken,
    });
    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: baseCheckpoint({
          namespace,
          bindingId,
          cursor: "cursor:stale",
          lastOwnerId: "worker-a",
          configRef: { id: "config.orders", revision: "rev.1" },
          status: "faulted",
        }),
        lease: stale,
      }),
    ).toEqual({ kind: "rejected" });

    await expect(
      store.transports!.getBindingCheckpoint!({ namespace, bindingId }),
    ).resolves.toMatchObject({
      cursor: "cursor:1",
      status: "active",
      configRef: { id: "config.orders", revision: "rev.1" },
    });
  });
});
