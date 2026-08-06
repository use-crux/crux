import { describe, expect, it, vi } from "vitest";
import { SessionCapabilityError } from "../../src/session/errors";
import { resolveDurableSignalConsumers } from "../../src/runtime/engine/composites/signal-session-consumers";
import type { RuntimeSessionStorePort } from "../../src/runtime/ports/sessions";
import type { RuntimeStoreTransaction } from "../../src/runtime/store";
import type { WorkId } from "../../src/runtime/ports/ids";

function baseSessions(): RuntimeSessionStorePort {
  return {
    create: vi.fn(),
    getByKey: vi.fn(),
    get: vi.fn(),
    getInput: vi.fn(),
    getInputAtCursor: vi.fn(),
    inspectInputs: vi.fn(),
    markReady: vi.fn(),
    acceptInputs: vi.fn(),
    reserveTurn: vi.fn(),
    startTurn: vi.fn(),
    getTurnInputs: vi.fn(),
    claimStepInputs: vi.fn(),
    getPreparedExecution: vi.fn(),
    checkpointPreparedExecution: vi.fn(),
    completeTurn: vi.fn(),
    blockTurn: vi.fn(),
    getByActivationWorkId: vi.fn(async () => null),
    upsertSubscription: vi.fn(),
    getSubscription: vi.fn(),
    listSubscriptions: vi.fn(),
    listActiveSubscriptionsForSignal: vi.fn(async () => Object.freeze([])),
    unsubscribe: vi.fn(),
  };
}

describe("Session capability integrity", () => {
  it("fails closed when Session storage is missing subscription list capability", async () => {
    const sessions = baseSessions();
    Reflect.deleteProperty(sessions, "listActiveSubscriptionsForSignal");
    const tx = {
      sessions,
      waiters: {
        resolve: vi.fn(async () => Object.freeze([])),
      },
    } as unknown as RuntimeStoreTransaction;

    await expect(
      resolveDurableSignalConsumers(tx, {
        namespace: "ns",
        signalId: "orders.changed",
        payload: { ok: true },
      }),
    ).rejects.toBeInstanceOf(SessionCapabilityError);
  });

  it("fails closed when Session storage is missing activation lookup capability", async () => {
    const sessions = baseSessions();
    sessions.listActiveSubscriptionsForSignal = vi.fn(async () =>
      Object.freeze([
        {
          schemaVersion: 1 as const,
          namespace: "ns",
          sessionId: "session_1",
          subscriptionId: "sub_1",
          signalId: "orders.changed",
          matchKey: "",
          state: "active" as const,
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      ]),
    );
    Reflect.deleteProperty(sessions, "getByActivationWorkId");
    const tx = {
      sessions,
      waiters: {
        resolve: vi.fn(async () =>
          Object.freeze([
            {
              waiterId: "waiter_1",
              namespace: "ns",
              eventName: "orders.changed",
              workId: "work_1" as WorkId,
              work: { kind: "flow.resume", flowId: "flow_1" },
              match: {},
              state: "armed",
              source: { kind: "signal", signalId: "orders.changed" },
            },
          ]),
        ),
      },
    } as unknown as RuntimeStoreTransaction;

    await expect(
      resolveDurableSignalConsumers(tx, {
        namespace: "ns",
        signalId: "orders.changed",
        payload: { ok: true },
      }),
    ).rejects.toBeInstanceOf(SessionCapabilityError);
  });

  it("uses full Session subscription capability when present", async () => {
    const sessions = baseSessions();
    const list = vi.fn(async () => Object.freeze([]));
    sessions.listActiveSubscriptionsForSignal = list;
    const tx = {
      sessions,
      waiters: {
        resolve: vi.fn(async () => Object.freeze([])),
      },
    } as unknown as RuntimeStoreTransaction;

    const result = await resolveDurableSignalConsumers(tx, {
      namespace: "ns",
      signalId: "orders.changed",
      payload: { ok: true },
    });
    expect(list).toHaveBeenCalledWith("ns", "orders.changed");
    expect(result.subscriptions).toEqual([]);
    expect(result.waiters).toEqual([]);
  });
});
