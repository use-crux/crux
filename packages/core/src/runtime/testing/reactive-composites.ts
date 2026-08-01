/** Provider-neutral durable reactive composite conformance. */

import { describe, expect, it } from "vitest";
import type { FlowId, LeaseToken, RuntimeTargetId, WorkId } from "../ports";
import type { RuntimeStoreAdapter } from "../store";
import type { RuntimeSignalStorePort } from "../reactive/records";
import { makeConformanceWorkItem } from "./store-fixtures";
import { runComposite } from "./store-composite-case-utils";
import { verifyReactiveCompositeRollback } from "./reactive-composite-rollback";

const NAMESPACE = "reactive-conformance";
const FLOW_ID = "flow_signal_conformance" as FlowId;
const WORK_ID = "work_signal_conformance" as WorkId;
const TARGET_ID = "signal conformance flow" as RuntimeTargetId;
const OCCURRENCE_ID = "signal_occurrence_conformance";
const SECOND_OCCURRENCE_ID = "signal_occurrence_conformance_2";
const THIRD_OCCURRENCE_ID = "signal_occurrence_conformance_3";

/** Options for {@link runReactiveCompositeAdapterTests}. */
export interface RunReactiveCompositeAdapterTestsOptions<
  TStore extends RuntimeStoreAdapter & {
    readonly signals: RuntimeSignalStorePort;
  } = RuntimeStoreAdapter & { readonly signals: RuntimeSignalStorePort },
> {
  /** Human-readable adapter name used for the Vitest suite. */
  readonly name: string;
  /** Create a fresh, isolated Runtime store with a concrete Signal port. */
  readonly createStore: () => TStore | Promise<TStore>;
  /**
   * Abort the next composite transaction after exactly N successful mutations.
   *
   * @remarks Zero aborts before the first mutation. The hook must reset after
   * one transaction and expose the unchanged pre-transaction records after
   * the abort, regardless of whether the adapter uses a native transaction.
   */
  readonly failAfterWrites: (store: TStore, writes: number) => void;
}

/**
 * Register Signal occurrence/delivery atomicity checks for a Runtime adapter.
 *
 * @remarks The suite uses only provider-neutral Runtime store and named
 * composite contracts. Every adapter must provide deterministic transaction
 * abort injection; claiming substrate atomicity does not certify an adapter.
 * Calling this suite certifies only the supplied adapter harness.
 */
export function runReactiveCompositeAdapterTests<
  TStore extends RuntimeStoreAdapter & {
    readonly signals: RuntimeSignalStorePort;
  },
>(options: RunReactiveCompositeAdapterTestsOptions<TStore>): void {
  describe(`${options.name} reactive composite conformance`, () => {
    it("atomically commits one occurrence with its required Flow delivery", async () => {
      const store = await options.createStore();
      await prepareSignalWait(store);

      const result = await publishConformanceSignal(store);

      expect(result).toMatchObject({
        accepted: true,
        replayed: false,
        outboxCount: 1,
      });
      await expect(
        store.signals.getOccurrence(NAMESPACE, OCCURRENCE_ID),
      ).resolves.toMatchObject({ signalId: "signal.conformance" });
      await expect(
        store.signals.listDeliveries(NAMESPACE, OCCURRENCE_ID),
      ).resolves.toMatchObject([{ state: "pending", attempts: 0 }]);
      await expect(
        store.events.read({ namespace: NAMESPACE }),
      ).resolves.toMatchObject({
        events: [{ eventId: OCCURRENCE_ID }],
      });
    });

    it("retains one delivery identity for every required waiter binding", async () => {
      const store = await options.createStore();
      await prepareSignalWait(store, 2);

      await publishConformanceSignal(store);

      const deliveries = await store.signals.listDeliveries(
        NAMESPACE,
        OCCURRENCE_ID,
      );
      expect(deliveries).toHaveLength(2);
      expect(new Set(deliveries.map(({ deliveryId }) => deliveryId)).size).toBe(
        2,
      );
    });

    it("retains predicate candidates in FIFO order while work is pending or leased", async () => {
      const store = await options.createStore();
      await prepareSignalWait(store, 1, true);

      await publishConformanceSignal(store);
      await publishConformanceSignal(store, SECOND_OCCURRENCE_ID, "second");
      const pending = await store.state.getWork(WORK_ID, {
        namespace: NAMESPACE,
      });
      if (!pending || pending.status !== "pending") {
        throw new Error("Predicate publication did not leave pending work.");
      }
      await store.state.putWork({
        ...pending,
        status: "leased",
        leaseToken: "predicate_conformance_lease" as LeaseToken,
      });
      await publishConformanceSignal(store, THIRD_OCCURRENCE_ID, "third");

      const snapshot = await store.state.getSnapshot(FLOW_ID, {
        namespace: NAMESPACE,
      });
      expect(
        snapshot?.pendingSuspends[0]?.candidates?.map(({ eventId }) => eventId),
      ).toEqual([OCCURRENCE_ID, SECOND_OCCURRENCE_ID, THIRD_OCCURRENCE_ID]);
      await expect(store.waiters.listByWork(WORK_ID)).resolves.toMatchObject([
        { state: "armed", source: { filterKind: "predicate" } },
      ]);
      await expect(
        store.outbox.list({
          namespace: NAMESPACE,
          state: "pending",
          limit: 32,
        }),
      ).resolves.toHaveLength(1);
    });

    it("rolls back at every reactive write boundary", async () => {
      await verifyReactiveCompositeRollback({
        createStore: options.createStore,
        failAfterWrites: options.failAfterWrites,
        prepare: (store) => prepareSignalWait(store, 2),
        publish: publishConformanceSignal,
        namespace: NAMESPACE,
        flowId: FLOW_ID,
        workId: WORK_ID,
        occurrenceId: OCCURRENCE_ID,
      });
    });

    it("rolls back every predicate candidate and delivery write", async () => {
      await verifyReactiveCompositeRollback({
        createStore: options.createStore,
        failAfterWrites: options.failAfterWrites,
        prepare: async (store) => {
          await prepareSignalWait(store, 2, true);
          await publishConformanceSignal(store);
        },
        publish: (store) =>
          publishConformanceSignal(store, SECOND_OCCURRENCE_ID, "second"),
        namespace: NAMESPACE,
        flowId: FLOW_ID,
        workId: WORK_ID,
        occurrenceId: SECOND_OCCURRENCE_ID,
        verifyRollback: verifyPredicateAppendRolledBack,
      });
    });
  });
}

async function verifyPredicateAppendRolledBack(
  store: RuntimeStoreAdapter & { readonly signals: RuntimeSignalStorePort },
): Promise<void> {
  await expect(
    store.signals.getOccurrence(NAMESPACE, SECOND_OCCURRENCE_ID),
  ).resolves.toBeNull();
  await expect(
    store.signals.listDeliveries(NAMESPACE, SECOND_OCCURRENCE_ID),
  ).resolves.toHaveLength(0);
  await expect(
    store.events.read({ namespace: NAMESPACE }),
  ).resolves.toMatchObject({ events: [{ eventId: OCCURRENCE_ID }] });
  await expect(
    store.outbox.list({ namespace: NAMESPACE, state: "pending", limit: 32 }),
  ).resolves.toHaveLength(1);
  await expect(
    store.state.getWork(WORK_ID, { namespace: NAMESPACE }),
  ).resolves.toMatchObject({ status: "pending" });
  await expect(
    store.state.getSnapshot(FLOW_ID, { namespace: NAMESPACE }),
  ).resolves.toMatchObject({
    status: "suspended",
    pendingSuspends: [
      { candidates: [{ eventId: OCCURRENCE_ID }] },
      { candidates: [{ eventId: OCCURRENCE_ID }] },
    ],
  });
  await expect(store.waiters.listByWork(WORK_ID)).resolves.toMatchObject([
    { state: "armed", source: { filterKind: "predicate" } },
    { state: "armed", source: { filterKind: "predicate" } },
  ]);
}

async function prepareSignalWait(
  store: RuntimeStoreAdapter,
  bindingCount = 1,
  signalPredicate = false,
): Promise<void> {
  await store.state.putWork(
    makeConformanceWorkItem({
      workId: WORK_ID,
      namespace: NAMESPACE,
      work: { kind: "flow.resume", flowId: FLOW_ID },
      targetId: TARGET_ID,
      status: "leased",
      leaseToken: "signal_conformance_lease" as LeaseToken,
    }),
  );
  await runComposite(store, "suspension.record", {
    namespace: NAMESPACE,
    workId: WORK_ID,
    flowId: FLOW_ID,
    targetId: TARGET_ID,
    snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
    suspends: Array.from({ length: bindingCount }, (_, index) => {
      const occurrence = index + 1;
      return {
        label: `waitFor:signal.conformance:${occurrence}`,
        deliveryKey: `${occurrence}:waitFor:signal.conformance`,
        eventName: "signal.conformance",
        signalId: "signal.conformance",
        match: {},
        ...(signalPredicate ? { signalPredicate: true as const } : {}),
      };
    }),
  });
}

async function publishConformanceSignal(
  store: RuntimeStoreAdapter,
  occurrenceId = OCCURRENCE_ID,
  value = "accepted",
) {
  return await runComposite(store, "signal.publish", {
    namespace: NAMESPACE,
    occurrenceId,
    signalId: "signal.conformance",
    payload: { value },
    acceptedAt: "2026-07-31T22:30:00.000Z",
    idempotencyHash: `conformance-hash:${occurrenceId}`,
  });
}
