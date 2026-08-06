import { describe, expect, it } from "vitest";
import { inMemoryRuntimeStore } from "@use-crux/core/runtime";
import {
  sessionSubscriptionMatchKey,
  sessionSubscriptionMatchValue,
} from "../../src/session/subscription-match";

describe("Memory Session subscription matchKey contract", () => {
  it("persists the caller-provided matchKey without re-deriving identity", async () => {
    const store = inMemoryRuntimeStore();
    const now = new Date("2026-08-05T00:00:00.000Z");
    await store.transact(async (tx) => {
      if (!tx.sessions) throw new Error("missing sessions");
      await tx.sessions.create({
        namespace: "match-key-ns",
        sessionId: "session_mk_1",
        keyHash: "key_mk_1",
        targetId: "flow-mk",
        targetKind: "flow",
        threadId: "thread_mk_1",
        definition: {
          targetId: "flow-mk" as never,
          definitionId: "flow:flow-mk",
          fingerprint: "v1",
          manifestHash: "manifest-v1",
        },
        now,
      });
      await tx.sessions.markReady("match-key-ns", "session_mk_1", now);
    });

    const match = sessionSubscriptionMatchValue({ env: "prod", repo: "crux" });
    const derived = sessionSubscriptionMatchKey(match);
    const stored = await store.transact(async (tx) => {
      if (!tx.sessions) throw new Error("missing sessions");
      return tx.sessions.upsertSubscription({
        namespace: "match-key-ns",
        sessionId: "session_mk_1",
        subscriptionId: "subscription_mk",
        signalId: "orders.changed",
        ...(match === undefined ? {} : { match }),
        matchKey: derived,
        now,
      });
    });
    expect(stored.matchKey).toBe(derived);

    const activeRetry = await store.transact(async (tx) => {
      if (!tx.sessions) throw new Error("missing sessions");
      return tx.sessions.upsertSubscription({
        namespace: "match-key-ns",
        sessionId: "session_mk_1",
        subscriptionId: "subscription_mk_other",
        signalId: "orders.changed",
        match: { repo: "crux", env: "prod" },
        matchKey: derived,
        now: new Date(now.getTime() + 1_000),
      });
    });
    expect(activeRetry.subscriptionId).toBe(stored.subscriptionId);
    expect(activeRetry.updatedAt).toBe(stored.updatedAt);

    await store.transact(async (tx) => {
      if (!tx.sessions) throw new Error("missing sessions");
      await tx.sessions.unsubscribe(
        "match-key-ns",
        "session_mk_1",
        stored.subscriptionId,
        new Date(now.getTime() + 2_000),
      );
    });
    const unsubscribedAgain = await store.transact(async (tx) => {
      if (!tx.sessions) throw new Error("missing sessions");
      return tx.sessions.unsubscribe(
        "match-key-ns",
        "session_mk_1",
        stored.subscriptionId,
        new Date(now.getTime() + 3_000),
      );
    });
    expect(unsubscribedAgain.state).toBe("unsubscribed");
    expect(unsubscribedAgain.updatedAt).toBe(
      new Date(now.getTime() + 2_000).toISOString(),
    );
  });
});
