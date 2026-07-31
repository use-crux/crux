/** Provider-neutral durable reactive composite conformance. */

import { describe, expect, it } from "vitest";
import type { FlowId, LeaseToken, RuntimeTargetId, WorkId } from "../ports";
import type { RuntimeStoreAdapter } from "../store";
import type { RuntimeSignalStorePort } from "../reactive/records";
import { makeConformanceWorkItem } from "./store-fixtures";
import { requireFaultHook, runComposite } from "./store-composite-case-utils";

const NAMESPACE = "reactive-conformance";
const FLOW_ID = "flow_signal_conformance" as FlowId;
const WORK_ID = "work_signal_conformance" as WorkId;
const TARGET_ID = "signal conformance flow" as RuntimeTargetId;
const OCCURRENCE_ID = "signal_occurrence_conformance";

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
  /** Configure the next transaction to fail after N successful writes. */
  readonly failAfterWrites?: (store: TStore, writes: number) => void;
  /** Declare native substrate atomicity when injected partial writes are impossible. */
  readonly substrateAtomicTransact?: boolean;
}

/**
 * Register Signal occurrence/delivery atomicity checks for a Runtime adapter.
 *
 * @remarks The suite uses only the provider-neutral Runtime store and named
 * composite contracts. Adapters must either provide fault injection or declare
 * substrate-owned atomic transactions.
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

    it.skipIf(options.substrateAtomicTransact)(
      "rolls back every reactive record when the required delivery write faults",
      async () => {
        const store = await options.createStore();
        await prepareSignalWait(store);
        requireFaultHook(options.failAfterWrites)(store, 6);

        await expect(publishConformanceSignal(store)).rejects.toThrow(
          "Injected transaction failure",
        );
        await expect(
          store.signals.getOccurrence(NAMESPACE, OCCURRENCE_ID),
        ).resolves.toBeNull();
        await expect(
          store.signals.listDeliveries(NAMESPACE, OCCURRENCE_ID),
        ).resolves.toHaveLength(0);
        await expect(
          store.events.read({ namespace: NAMESPACE }),
        ).resolves.toMatchObject({
          events: [],
        });
        await expect(
          store.outbox.list({
            namespace: NAMESPACE,
            state: "pending",
            limit: 10,
          }),
        ).resolves.toHaveLength(0);
      },
    );
  });
}

async function prepareSignalWait(
  store: RuntimeStoreAdapter,
  bindingCount = 1,
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
      };
    }),
  });
}

async function publishConformanceSignal(store: RuntimeStoreAdapter) {
  return await runComposite(store, "signal.publish", {
    namespace: NAMESPACE,
    occurrenceId: OCCURRENCE_ID,
    signalId: "signal.conformance",
    payload: { value: "accepted" },
    acceptedAt: "2026-07-31T22:30:00.000Z",
    idempotencyHash: "conformance-hash",
  });
}
