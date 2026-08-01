import { expect } from "vitest";
import {
  inMemoryRuntimeStore,
  type FlowId,
  type InMemoryRuntimeStore,
  type WorkId,
} from "@use-crux/core/runtime";

export function durableMemoryRuntimeStore(): InMemoryRuntimeStore {
  return Object.freeze({
    ...inMemoryRuntimeStore(),
    durability: "durable" as const,
  });
}

export function deferred(): {
  readonly promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise() };
}

export async function expectFlowStatus(
  store: InMemoryRuntimeStore,
  namespace: string,
  flowId: string,
  status: "completed" | "suspended",
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await store.state.getSnapshot(flowId as FlowId, {
      namespace,
    });
    if (snapshot?.status === status) return;
    await Promise.resolve();
  }
  await expect(
    store.state.getSnapshot(flowId as FlowId, { namespace }),
  ).resolves.toMatchObject({ status });
}

export async function expectOutboxState(
  store: InMemoryRuntimeStore,
  namespace: string,
  state: "pending" | "confirmed",
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await store.outbox.list({ namespace, state, limit: 10 });
    if (rows.length > 0) return;
    await Promise.resolve();
  }
  await expect(
    store.outbox.list({ namespace, state, limit: 10 }),
  ).resolves.not.toHaveLength(0);
}

export async function expectWorkStatus(
  store: InMemoryRuntimeStore,
  namespace: string,
  workId: WorkId,
  status: "pending" | "suspended" | "completed",
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const work = await store.state.getWork(workId, { namespace });
    if (work?.status === status) return;
    await Promise.resolve();
  }
  await expect(
    store.state.getWork(workId, { namespace }),
  ).resolves.toMatchObject({ status });
}

export async function expectWaiterCounts(
  store: InMemoryRuntimeStore,
  workId: WorkId,
  expected: { readonly armed: number; readonly total: number },
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiters = await store.waiters.listByWork(workId);
    if (
      waiters.length === expected.total &&
      waiters.filter((waiter) => waiter.state === "armed").length ===
        expected.armed
    ) {
      return waiters;
    }
    await Promise.resolve();
  }
  const waiters = await store.waiters.listByWork(workId);
  expect(waiters.filter((waiter) => waiter.state === "armed")).toHaveLength(
    expected.armed,
  );
  expect(waiters).toHaveLength(expected.total);
  return waiters;
}
