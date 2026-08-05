import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  createWorkHost,
  flow,
  getSession,
  resetHooks,
  session,
  signal,
} from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type InMemoryRuntimeStore,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { z } from "zod";

afterEach(() => resetHooks());

function durableStore(): InMemoryRuntimeStore {
  return Object.freeze({
    ...inMemoryRuntimeStore(),
    durability: "durable" as const,
  });
}

function flowSessionHost(namespace: string, targets: readonly unknown[]) {
  const store = durableStore();
  const records = inMemoryRecordStore();
  const runtime = node({
    store,
    namespace,
    autoStartMaintenance: false,
  });
  config({ storage: { records }, runtime });
  const program = createRuntimeProgram({
    targets: targets as never,
    transports: [],
  });
  const host = createWorkHost({ runtime, program });
  const worker = createRuntimeWorker({ runtime, program });
  return { store, records, runtime, host, worker };
}

describe("public Flow Session lifecycle", () => {
  it("requires an active Session subscription for durable Session-owned Signal delivery and exact result", async () => {
    const approval = signal({
      id: "flow-session.approved",
      schema: z.object({
        documentId: z.string(),
        approvedBy: z.string(),
      }),
    });
    const review = flow(
      "flow-session-review",
      { signals: { approval } },
      async (scope, input: { readonly documentId: string }) => {
        const occurrence = await scope.waitFor(approval);
        return {
          documentId: input.documentId,
          approvedBy: occurrence.payload.approvedBy,
        } as const;
      },
    );
    const { store, host, worker } = flowSessionHost("flow-session-test", [
      review,
    ]);

    try {
      const created = await host.run(() =>
        session(review, { key: "document:42" }),
      );
      expect(created.targetKind).toBe("flow");

      const accepted = await host.run(() =>
        created.send({ documentId: "document:42" }),
      );
      await expect
        .poll(async () => {
          const work = await accepted.work();
          return (await work.status()).state;
        })
        .toBe("suspended");

      // Negative control: without a Session subscription, Session-owned waiters
      // are gated out and publication remains process-local.
      const withoutSubscription = await approval.publish({
        documentId: "document:42",
        approvedBy: "ops",
      });
      expect(withoutSubscription.guarantee).toBe("process-local");
      await expect
        .poll(async () => {
          const work = await accepted.work();
          return (await work.status()).state;
        })
        .toBe("suspended");

      const subscription = await host.run(() =>
        created.subscribe(approval.when({ documentId: "document:42" })),
      );
      expect(subscription.signalId).toBe("flow-session.approved");

      // Restart-safe reconstruction of subscription intent from storage.
      const reopened = await host.run(() => getSession(review, "document:42"));
      const reopenedSubscriptions = await host.run(() =>
        reopened.subscriptions(),
      );
      expect(reopenedSubscriptions.map((item) => item.id)).toEqual([
        subscription.id,
      ]);

      const receipt = await approval.publish({
        documentId: "document:42",
        approvedBy: "ops",
      });
      expect(receipt.guarantee).toBe("durable");

      const deliveries = await store.transact(async (tx) => {
        if (!tx.signals) throw new Error("missing signals");
        return tx.signals.listDeliveries(
          "flow-session-test",
          receipt.occurrenceId,
        );
      });
      expect(
        deliveries.some(
          (delivery) =>
            delivery.consumer.kind === "session.subscription" &&
            delivery.consumer.subscriptionId === subscription.id,
        ),
      ).toBe(true);
      expect(
        deliveries.some((delivery) => delivery.consumer.kind === "flow.signal-wait"),
      ).toBe(true);

      await expect(accepted.result()).resolves.toEqual({
        documentId: "document:42",
        approvedBy: "ops",
      });
      await expect(created.status()).resolves.toMatchObject({
        pendingInputs: 0,
        pendingWork: 0,
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("treats key-order variants as one canonical subscription identity", async () => {
    const changed = signal({
      id: "flow-session.match-order",
      schema: z.object({
        repo: z.string(),
        env: z.string(),
      }),
    });
    const release = flow(
      "flow-session-match-order",
      { signals: { changed } },
      async () => "ok" as const,
    );
    const { host, worker } = flowSessionHost("flow-session-match", [release]);
    try {
      const owned = await host.run(() =>
        session(release, { key: "repo:1" }),
      );
      const first = await host.run(() =>
        owned.subscribe(changed.when({ repo: "crux", env: "prod" })),
      );
      const second = await host.run(() =>
        owned.subscribe(changed.when({ env: "prod", repo: "crux" })),
      );
      expect(second.id).toBe(first.id);
      const listed = await host.run(() => owned.subscriptions());
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(first.id);
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("accepts void and primitive Flow Session inputs as JSON values", async () => {
    const voidFlow = flow(
      "flow-session-void-input",
      async () => "void-done" as const,
    );
    const primitiveFlow = flow(
      "flow-session-primitive-input",
      async (_scope, input: string) => `echo:${input}` as const,
    );
    const { host, worker, store } = flowSessionHost("flow-session-json-input", [
      voidFlow,
      primitiveFlow,
    ]);
    try {
      const voidSession = await host.run(() =>
        session(voidFlow, { key: "void:1" }),
      );
      const voidTurn = await host.run(() => voidSession.send(undefined as void));
      await expect(voidTurn.result()).resolves.toBe("void-done");
      const voidInput = await store.transact(async (tx) => {
        if (!tx.sessions) throw new Error("missing sessions");
        return tx.sessions.getInput(
          "flow-session-json-input",
          voidSession.id,
          voidTurn.id,
        );
      });
      expect(voidInput?.input).toBe(null);

      const primitiveSession = await host.run(() =>
        session(primitiveFlow, { key: "primitive:1" }),
      );
      const primitiveTurn = await host.run(() =>
        primitiveSession.send("hello"),
      );
      await expect(primitiveTurn.result()).resolves.toBe("echo:hello");
      const primitiveInput = await store.transact(async (tx) => {
        if (!tx.sessions) throw new Error("missing sessions");
        return tx.sessions.getInput(
          "flow-session-json-input",
          primitiveSession.id,
          primitiveTurn.id,
        );
      });
      expect(primitiveInput?.input).toBe("hello");
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("reopens the same Flow Session identity without forking Thread ownership", async () => {
    const release = flow("flow-session-conflict", async () => "done" as const);
    const { records, host } = flowSessionHost("flow-session-conflict", [
      release,
    ]);
    try {
      const created = await host.run(() =>
        session(release, { key: "shared" }),
      );
      await expect(
        host.run(() => session(release, { key: "shared" })),
      ).resolves.toMatchObject({ id: created.id });
      const control = await records.get(`thread/${created.thread.id}`);
      expect(control?.owners).toEqual({ [created.id]: "open" });
    } finally {
      host.dispose();
    }
  });

  it("keeps non-Session Flow waiters independent of Session subscriptions", async () => {
    const tick = signal({
      id: "flow-session.plain-waiter",
      schema: z.object({ ok: z.literal(true) }),
    });
    const plain = flow(
      "flow-session-plain-waiter",
      { signals: { tick } },
      async (scope) => {
        await scope.waitFor(tick);
        return "resumed" as const;
      },
    );
    const store = durableStore();
    const runtime = node({
      store,
      namespace: "flow-session-plain",
      autoStartMaintenance: false,
    });
    config({
      storage: { records: inMemoryRecordStore() },
      runtime,
    });
    const program = createRuntimeProgram({ targets: [plain], transports: [] });
    const worker = createRuntimeWorker({ runtime, program });
    try {
      const suspended = await plain.run({ flowId: "plain_flow_1" });
      expect(suspended.status).toBe("suspended");
      const receipt = await tick.publish({ ok: true });
      expect(receipt.guarantee).toBe("durable");
      await expect
        .poll(async () => {
          const snapshot = await store.state.getSnapshot("plain_flow_1" as never, {
            namespace: "flow-session-plain",
          });
          return snapshot?.status;
        })
        .toBe("completed");
    } finally {
      await worker.stop();
    }
  });
});
