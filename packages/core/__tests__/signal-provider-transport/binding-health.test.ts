/**
 * Public per-binding transport health snapshot from durable Runtime state.
 */

import { describe, expect, it } from "vitest";

import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  acceptTransportEnvelope,
  createRuntimeProgram,
  createWorkerTransportSupervision,
  emptyTransportEnvelopeStats,
  projectTransportBindingHealth,
  transportBindingHealth,
  transportStatisticsIdentity,
  type RuntimeTransportBindingCheckpoint,
} from "../../src/runtime/public";
import { managedTransportBinding } from "../../src/signal/provider";
import { createPollingFixture, inlinePayload } from "./polling-supervision-helpers";

describe("transport binding health", () => {
  it("projects one binding health snapshot from program + checkpoint + stats", async () => {
    const fixture = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const namespace = "demo";
    const now = new Date("2026-08-08T12:00:00.000Z");

    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    });
    expect(supervision).toBeDefined();

    const run = await supervision!.runOnce(new AbortController().signal, now);
    expect(run.accepted).toBe(1);
    expect(run.checkpointed).toBe(1);

    const snapshot = await transportBindingHealth({
      store,
      namespace,
      program: fixture.program,
      now: new Date("2026-08-08T12:00:05.000Z"),
    });

    expect(snapshot.schema).toBe(1);
    expect(snapshot.namespace).toBe(namespace);
    expect(snapshot.observedAt).toBe("2026-08-08T12:00:05.000Z");
    expect(snapshot.coverage.bindingLimit).toBe(64);
    expect(snapshot.coverage.bindings).toBe("complete");
    expect(snapshot.coverage.checkpoints).toBe("available");
    expect(snapshot.coverage.statistics).toBe("available");
    expect(snapshot.totals.accepted).toBe(1);
    expect(snapshot.bindings).toHaveLength(1);

    const health = snapshot.bindings[0]!;
    expect(health).toMatchObject({
      schema: 1,
      namespace,
      bindingId: "binding.orders.poll",
      adapterId: "orders.poll",
      provider: "orders.poll",
      transportKind: "polling",
      transportKindCoverage: "available",
      status: "active",
      statusCoverage: "defaulted",
      configRef: { id: "config.orders.poll", revision: "rev.1" },
      target: { kind: "signal", signalId: "order.submitted" },
      lease: {
        coverage: "last_owner",
        ownerId: "worker-a",
      },
      cursor: {
        present: true,
        coverage: "durable",
        ageMs: 5_000,
        updatedAt: "2026-08-08T12:00:00.000Z",
        lagCoverage: "unavailable",
      },
      outcomes: {
        coverage: "available",
        accepted: 1,
        deduplicated: 0,
        delivered: 0,
        retried: 0,
        deadLettered: 0,
      },
      fault: { coverage: "absent" },
      reconnect: { coverage: "unavailable" },
      shutdown: { coverage: "unavailable" },
    });

    // Secret-free: never expose raw cursors, tokens, payloads, or credentials.
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/cursor:1|lease_|base64|secret|payload|ord_/);
    expect(health).not.toHaveProperty("rawCursor");
    expect(health.cursor).not.toHaveProperty("value");
    expect(health.cursor).not.toHaveProperty("cursor");

    await supervision!.dispose();
  });

  it("marks missing checkpoint and statistics coverage honestly", async () => {
    const fixture = createPollingFixture();
    const store = inMemoryRuntimeStore();

    const snapshot = await transportBindingHealth({
      store,
      namespace: "empty",
      program: fixture.program,
      now: new Date("2026-08-08T15:00:00.000Z"),
    });

    expect(snapshot.totals).toEqual(emptyTransportEnvelopeStats().total);
    expect(snapshot.coverage.statistics).toBe("missing");
    expect(snapshot.bindings).toHaveLength(1);

    const health = snapshot.bindings[0]!;
    expect(health.status).toBe("active");
    expect(health.statusCoverage).toBe("defaulted");
    expect(health.cursor).toMatchObject({
      present: false,
      coverage: "absent",
      lagCoverage: "unavailable",
    });
    expect(health.lease.coverage).toBe("absent");
    expect(health.outcomes.coverage).toBe("missing");
    expect(health.fault.coverage).toBe("absent");
  });

  it("projects pure health from an explicit checkpoint without store I/O", () => {
    const fixture = createPollingFixture();
    const checkpoint: RuntimeTransportBindingCheckpoint = {
      schemaVersion: 1,
      namespace: "demo",
      bindingId: fixture.binding.id,
      cursor: "opaque-provider-cursor",
      updatedAt: "2026-08-08T11:59:00.000Z",
      lastPolledAt: "2026-08-08T11:59:00.000Z",
      lastOwnerId: "worker-b",
      lastErrorCode: "PROVIDER_UNAVAILABLE",
      status: "faulted",
      configRef: fixture.binding.configRef,
    };

    const health = projectTransportBindingHealth({
      namespace: "demo",
      binding: fixture.binding,
      provider: fixture.program.providers[0],
      checkpoint,
      outcomes: {
        accepted: 2,
        deduplicated: 1,
        normalized: 1,
        delivered: 1,
        retried: 1,
        deadLettered: 0,
      },
      outcomesCoverage: "available",
      now: new Date("2026-08-08T12:00:00.000Z"),
    });

    expect(health.status).toBe("faulted");
    expect(health.statusCoverage).toBe("durable");
    expect(health.fault).toEqual({
      coverage: "durable",
      lastErrorCode: "PROVIDER_UNAVAILABLE",
    });
    expect(health.cursor.present).toBe(true);
    expect(health.cursor.ageMs).toBe(60_000);
    expect(JSON.stringify(health)).not.toContain("opaque-provider-cursor");
    expect(health.outcomes).toMatchObject({
      coverage: "available",
      accepted: 2,
      deduplicated: 1,
      delivered: 1,
      retried: 1,
    });
    expect(transportStatisticsIdentity("orders.poll", "binding.orders.poll")).toEqual(
      transportStatisticsIdentity(health.adapterId, health.bindingId),
    );
  });

  it("bounds the snapshot to 64 binding identities and remains restart-safe", async () => {
    const fixture = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const namespace = "bound";
    const now = new Date("2026-08-08T12:00:00.000Z");

    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-restart",
    });
    await supervision!.runOnce(new AbortController().signal, now);
    await supervision!.dispose();

    // Fresh store handle simulates another process reading durable state.
    const restarted = await transportBindingHealth({
      store,
      namespace,
      program: fixture.program,
      now: new Date("2026-08-08T12:01:00.000Z"),
    });
    expect(restarted.bindings[0]!.lease).toMatchObject({
      coverage: "last_owner",
      ownerId: "worker-restart",
    });
    expect(restarted.bindings[0]!.cursor.present).toBe(true);
    expect(restarted.totals.accepted).toBe(1);

    const provider = fixture.program.providers[0]!;
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: Array.from({ length: 70 }, (_, index) =>
        managedTransportBinding(provider, {
          id: `binding.many.${index}`,
          configRef: { id: `cfg.${index}`, revision: "1" },
          signalId: "order.submitted",
        }),
      ),
    });

    const truncated = await transportBindingHealth({
      store,
      namespace: "many",
      program,
      now,
    });
    expect(truncated.bindings).toHaveLength(64);
    expect(truncated.coverage.bindings).toBe("truncated");
    expect(truncated.coverage.bindingLimit).toBe(64);
  });

  it("truncates bindings by deterministic id order regardless of input order", async () => {
    const fixture = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const provider = fixture.program.providers[0]!;
    const now = new Date("2026-08-08T12:00:00.000Z");

    const descending = Array.from({ length: 70 }, (_, index) =>
      managedTransportBinding(provider, {
        id: `binding.z.${String(69 - index).padStart(3, "0")}`,
        configRef: { id: `cfg.${index}`, revision: "1" },
        signalId: "order.submitted",
      }),
    );
    const ascending = [...descending].reverse();

    const fromDesc = await transportBindingHealth({
      store,
      namespace: "order-a",
      bindings: descending,
      providers: [provider],
      now,
    });
    const fromAsc = await transportBindingHealth({
      store,
      namespace: "order-b",
      bindings: ascending,
      providers: [provider],
      now,
    });

    expect(fromDesc.bindings.map((row) => row.bindingId)).toEqual(
      fromAsc.bindings.map((row) => row.bindingId),
    );
    expect(fromDesc.bindings).toHaveLength(64);
    expect(fromDesc.bindings[0]!.bindingId).toBe("binding.z.000");
    expect(fromDesc.bindings[63]!.bindingId).toBe("binding.z.063");
    expect(fromDesc.coverage.bindings).toBe("truncated");
  });

  it("accepts webhook binding health without inventing supervised fields", async () => {
    const fixture = createPollingFixture();
    // Re-use polling fixture store path with a webhook-only style accept for
    // identity stats, while health still comes from program declarations.
    const store = inMemoryRuntimeStore();
    await acceptTransportEnvelope({
      store,
      namespace: "web",
      envelope: {
        _tag: "RuntimeAcceptedTransportEnvelope",
        schemaVersion: 1,
        bindingId: fixture.binding.id,
        adapterId: fixture.binding.adapter.id,
        provider: fixture.binding.adapter.provider,
        accountId: "acct_1",
        eventId: "evt_w1",
        receivedAt: "2026-08-08T12:00:00.000Z",
        authenticatedRouting: { source: "test" },
        payload: inlinePayload(JSON.stringify({ orderId: "ord_w1" })),
        configRef: fixture.binding.configRef,
        target: fixture.binding.target,
      },
      now: new Date("2026-08-08T12:00:00.000Z"),
    });

    const snapshot = await transportBindingHealth({
      store,
      namespace: "web",
      program: fixture.program,
      now: new Date("2026-08-08T12:00:01.000Z"),
    });

    expect(snapshot.bindings[0]!.outcomes).toMatchObject({
      coverage: "available",
      accepted: 1,
    });
    // No supervised acquisition yet: cursor remains absent, not fabricated.
    expect(snapshot.bindings[0]!.cursor.present).toBe(false);
    expect(snapshot.bindings[0]!.cursor.coverage).toBe("absent");
  });
});
