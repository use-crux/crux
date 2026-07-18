import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { RuntimeTargetId, TaskId, WorkId } from "@use-crux/core/runtime";
import { createCloudflareRuntimeStore } from "../../src/runtime/store";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CRUX_EVAL_HOST: DurableObjectNamespace;
  }
}

describe("Cloudflare Runtime store", () => {
  it("rolls back multi-record transactions when the composite fails", async () => {
    await withStore(async (store) => {
      await expect(
        store.transact(async (transaction) => {
          await transaction.state.createWork(workInput("rollback"));
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      await expect(
        store.state.getWork("work-rollback" as WorkId, {
          namespace: "store-test",
        }),
      ).resolves.toBeNull();
    });
  });

  it("admits only one concurrent lease owner", async () => {
    await withStore(async (store) => {
      const claims = await Promise.all([
        store.leases.claim("work:lease-race", { ttlMs: 10_000 }),
        store.leases.claim("work:lease-race", { ttlMs: 10_000 }),
      ]);

      expect(claims.filter((lease) => lease !== null)).toHaveLength(1);
    });
  });

  it("persists event, waiter, timer, and deferred coordination records", async () => {
    await withStore(async (store) => {
      const waiter = await store.waiters.register({
        namespace: "store-test",
        eventName: "approved",
        match: { id: "case-1" },
        work: {
          kind: "task.run",
          taskId: "task" as TaskId,
          targetId: targetId(),
        },
      });
      const event = await store.events.append({
        namespace: "store-test",
        name: "approved",
        payload: { id: "case-1" },
      });
      const timer = await store.timers.put({
        namespace: "store-test",
        fireAt: new Date(Date.now() + 1_000),
        work: {
          kind: "task.run",
          taskId: "task" as TaskId,
          targetId: targetId(),
        },
      });

      await expect(
        store.waiters.resolve(event.name, event.payload, {
          namespace: "store-test",
        }),
      ).resolves.toMatchObject([{ waiterId: waiter.waiterId }]);
      await expect(store.timers.get(timer.timerId)).resolves.toMatchObject({
        state: "scheduled",
      });
    });
  });
});

async function withStore(
  run: (
    store: ReturnType<typeof createCloudflareRuntimeStore>,
  ) => Promise<void>,
) {
  const stub = env.CRUX_EVAL_HOST.get(
    env.CRUX_EVAL_HOST.idFromName(`store-${crypto.randomUUID()}`),
  );
  await runInDurableObject(stub, async (_instance, state) => {
    await run(createCloudflareRuntimeStore(state.storage));
  });
}

function workInput(id: string) {
  return {
    workId: `work-${id}` as WorkId,
    namespace: "store-test",
    work: {
      kind: "task.run" as const,
      taskId: "task" as TaskId,
      targetId: targetId(),
    },
    targetId: targetId(),
    idempotencyKey: `task:work-${id}`,
  };
}

function targetId(): RuntimeTargetId {
  return "fixture.target" as RuntimeTargetId;
}
