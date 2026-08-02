/** Exhaustive rollback checks for durable reactive composite writes. */

import { expect } from "vitest";
import type { FlowId, WorkId } from "../ports";
import type { RuntimeSignalStorePort } from "../reactive/records";
import type { RuntimeStoreAdapter } from "../store";

interface ReactiveRollbackOptions<
  TStore extends RuntimeStoreAdapter & {
    readonly signals: RuntimeSignalStorePort;
  },
> {
  readonly createStore: () => TStore | Promise<TStore>;
  readonly failAfterWrites: (store: TStore, writes: number) => void;
  readonly prepare: (store: TStore) => Promise<void>;
  readonly publish: (store: TStore) => Promise<unknown>;
  readonly namespace: string;
  readonly flowId: FlowId;
  readonly workId: WorkId;
  readonly occurrenceId: string;
  readonly verifyRollback?: (store: TStore) => Promise<void>;
}

/** Verify rollback after every mutation preceding a successful publication. */
export async function verifyReactiveCompositeRollback<
  TStore extends RuntimeStoreAdapter & {
    readonly signals: RuntimeSignalStorePort;
  },
>(options: ReactiveRollbackOptions<TStore>): Promise<void> {
  const maximumWrites = 32;
  let rollbackCount = 0;

  for (let writes = 0; writes <= maximumWrites; writes += 1) {
    const store = await options.createStore();
    await options.prepare(store);
    options.failAfterWrites(store, writes);

    try {
      await options.publish(store);
      expect(rollbackCount).toBe(writes);
      expect(rollbackCount).toBeGreaterThan(1);
      return;
    } catch {
      rollbackCount += 1;
      if (options.verifyRollback) {
        await options.verifyRollback(store);
      } else {
        await verifyRolledBack(store, options);
      }
    }
  }

  throw new Error(
    `Reactive publication did not complete within ${maximumWrites} writes.`,
  );
}

async function verifyRolledBack(
  store: RuntimeStoreAdapter & { readonly signals: RuntimeSignalStorePort },
  options: Pick<
    ReactiveRollbackOptions<
      RuntimeStoreAdapter & { readonly signals: RuntimeSignalStorePort }
    >,
    "namespace" | "flowId" | "workId" | "occurrenceId"
  >,
): Promise<void> {
  await expect(
    store.signals.getOccurrence(options.namespace, options.occurrenceId),
  ).resolves.toBeNull();
  await expect(
    store.signals.listDeliveries(options.namespace, options.occurrenceId),
  ).resolves.toHaveLength(0);
  await expect(
    store.events.read({ namespace: options.namespace }),
  ).resolves.toMatchObject({ events: [] });
  await expect(
    store.outbox.list({
      namespace: options.namespace,
      state: "pending",
      limit: 32,
    }),
  ).resolves.toHaveLength(0);
  await expect(
    store.state.getWork(options.workId, { namespace: options.namespace }),
  ).resolves.toMatchObject({ status: "suspended" });
  await expect(
    store.state.getSnapshot(options.flowId, {
      namespace: options.namespace,
    }),
  ).resolves.toMatchObject({
    status: "suspended",
    pendingSuspends: [{ delivered: undefined }, { delivered: undefined }],
  });
  await expect(store.waiters.listByWork(options.workId)).resolves.toMatchObject(
    [{ state: "armed" }, { state: "armed" }],
  );
}
