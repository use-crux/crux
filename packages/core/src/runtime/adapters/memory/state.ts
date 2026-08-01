import type { JsonValue } from "../../../storage";
import { DEFAULT_RUNTIME_MAX_ATTEMPTS } from "../../engine/retry";
import type { WorkItem } from "../../engine/work";
import type { EventCursor, FlowId, WorkId } from "../../ports/ids";
import type {
  FlowSnapshot,
  IdempotencyRecord,
  ListWorkOptions,
  MarkSnapshotDeliveredOptions,
  NewWorkItem,
  RuntimePendingSuspend,
  RuntimeStatePort,
  RuntimeStateReadOptions,
  SetWorkPendingOptions,
  WorkStatusCount,
} from "../../ports/state";
import type { RuntimeWork } from "../../ports/work";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import { cloneJsonValue } from "./json";
import { matchesPruneNamespace, olderThan, pruneMapValues } from "./retention";
import { cloneRuntimeResultRef } from "../../results/types";
import {
  appendPredicateCandidate,
  cloneMemoryDeliveredSuspend,
  cloneMemoryPendingSuspend,
} from "./predicate-candidates";

export function createMemoryStatePort(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeStatePort {
  return {
    async createWork(input: NewWorkItem): Promise<WorkItem> {
      const key = scopedKey(input.namespace, input.workId);
      const existing = data.work.get(key);
      if (existing) return cloneWorkItem(existing);

      recordWrite?.();
      const now = input.now ? new Date(input.now) : new Date();
      const stored: WorkItem = Object.freeze({
        workId: input.workId,
        namespace: input.namespace,
        work: cloneRuntimeWork(input.work),
        targetId: input.targetId,
        status: "pending",
        attempt: 1,
        maxAttempts: input.maxAttempts ?? DEFAULT_RUNTIME_MAX_ATTEMPTS,
        notBefore: input.notBefore ? new Date(input.notBefore) : undefined,
        idempotencyKey: input.idempotencyKey,
        idleScope: input.idleScope,
        createdAt: now,
        updatedAt: now,
      });
      data.work.set(key, stored);
      if (input.idleScope) {
        incrementCounter(data, input.namespace, input.idleScope);
      }
      return cloneWorkItem(stored);
    },

    async getWork(
      workId: WorkId,
      options: RuntimeStateReadOptions,
    ): Promise<WorkItem | null> {
      const work = data.work.get(scopedKey(options.namespace, workId));
      return work ? cloneWorkItem(work) : null;
    },

    async putWork(work: WorkItem): Promise<void> {
      recordWrite?.();
      data.work.set(
        scopedKey(work.namespace, work.workId),
        cloneWorkItem(work),
      );
    },

    async listWork(options: ListWorkOptions): Promise<readonly WorkItem[]> {
      const work = [...data.work.values()]
        .filter(
          (item) =>
            item.namespace === options.namespace &&
            item.status === options.status &&
            (options.updatedBefore === undefined ||
              item.updatedAt.getTime() < options.updatedBefore.getTime()),
        )
        .slice(0, options.limit);
      return work.map((item) => cloneWorkItem(item));
    },

    async pruneTerminalWork(options) {
      const result = pruneMapValues(
        data.work,
        options,
        (work) =>
          matchesPruneNamespace(work, options.namespace) &&
          isPrunableWorkStatus(work.status) &&
          olderThan(work.updatedAt, options.before),
      );
      if (result.removed > 0) recordWrite?.();
      return result;
    },

    async countWork(options): Promise<readonly WorkStatusCount[]> {
      const counts = new Map<string, WorkStatusCount>();
      for (const item of data.work.values()) {
        if (item.namespace !== options.namespace) continue;
        const key = `${item.namespace}:${item.status}:${item.targetId}`;
        const previous = counts.get(key);
        counts.set(key, {
          namespace: item.namespace,
          status: item.status,
          targetId: item.targetId,
          count: (previous?.count ?? 0) + 1,
        });
      }
      return [...counts.values()];
    },

    async setWorkPending(
      workId: WorkId,
      options: SetWorkPendingOptions,
    ): Promise<WorkItem | null> {
      const key = scopedKey(options.namespace, workId);
      const existing = data.work.get(key);
      if (!existing || !statusAllowed(existing.status, options.from))
        return null;

      recordWrite?.();
      const updated: WorkItem = Object.freeze({
        workId: existing.workId,
        namespace: existing.namespace,
        work: cloneRuntimeWork(options.work),
        targetId: existing.targetId,
        status: "pending",
        attempt: 1,
        maxAttempts: existing.maxAttempts,
        idempotencyKey: options.idempotencyKey,
        idleScope: existing.idleScope,
        createdAt: new Date(existing.createdAt),
        updatedAt: options.now ? new Date(options.now) : new Date(),
      });
      data.work.set(key, updated);
      return cloneWorkItem(updated);
    },

    async getSnapshot(
      flowId: FlowId,
      options: RuntimeStateReadOptions,
    ): Promise<FlowSnapshot | null> {
      const snapshot = data.snapshots.get(scopedKey(options.namespace, flowId));
      return snapshot ? cloneFlowSnapshot(snapshot) : null;
    },

    async putSnapshot(snapshot: FlowSnapshot): Promise<void> {
      recordWrite?.();
      data.snapshots.set(
        scopedKey(snapshot.namespace, snapshot.flowId),
        cloneFlowSnapshot(snapshot),
      );
    },

    async pruneTerminalSnapshots(options) {
      const result = pruneMapValues(
        data.snapshots,
        options,
        (snapshot) =>
          matchesPruneNamespace(snapshot, options.namespace) &&
          isPrunableSnapshotStatus(snapshot.status) &&
          olderThan(snapshot.updatedAt, options.before),
      );
      if (result.removed > 0) recordWrite?.();
      return result;
    },

    async markSnapshotDelivered(
      workId: WorkId,
      options: MarkSnapshotDeliveredOptions,
    ): Promise<void> {
      const entry = [...data.snapshots.entries()].find(
        ([, snapshot]) =>
          snapshot.namespace === options.namespace &&
          snapshot.workId === workId,
      );
      if (!entry) return;

      const [key, snapshot] = entry;
      const pendingSuspends = snapshot.pendingSuspends.map((suspend) => {
        if (suspend.waiterId !== options.waiterId) return suspend;
        if (options.predicateCandidate) {
          return appendPredicateCandidate(suspend, options);
        }
        return Object.freeze({
          ...cloneMemoryPendingSuspend(suspend),
          delivered: deliveredSuspend(options),
        });
      });
      const deliveredSuspends = options.predicateCandidate
        ? snapshot.deliveredSuspends
        : mergeDeliveredSuspend(snapshot, options);
      recordWrite?.();
      data.snapshots.set(
        key,
        cloneFlowSnapshot({ ...snapshot, pendingSuspends, deliveredSuspends }),
      );
    },

    async hasIdempotencyKey(namespace: string, key: string): Promise<boolean> {
      return data.idempotency.has(scopedKey(namespace, key));
    },

    async putIdempotencyKey(record: IdempotencyRecord): Promise<void> {
      const key = scopedKey(record.namespace, record.key);
      if (data.idempotency.has(key)) return;
      recordWrite?.();
      data.idempotency.set(key, cloneIdempotencyRecord(record));
    },

    async pruneIdempotencyKeys(options) {
      const result = pruneMapValues(
        data.idempotency,
        options,
        (record) =>
          matchesPruneNamespace(record, options.namespace) &&
          olderThan(record.completedAt, options.before),
      );
      if (result.removed > 0) recordWrite?.();
      return result;
    },

    async incrementIdle(namespace: string, scope: string): Promise<number> {
      recordWrite?.();
      return incrementCounter(data, namespace, scope);
    },

    async decrementIdle(namespace: string, scope: string): Promise<number> {
      const key = scopedKey(namespace, scope);
      const next = (data.idleCounters.get(key) ?? 0) - 1;
      if (next < 0) {
        throw new Error(`Runtime idle counter ${scope} went negative.`);
      }
      recordWrite?.();
      if (next === 0) {
        data.idleCounters.delete(key);
      } else {
        data.idleCounters.set(key, next);
      }
      return next;
    },

    async getIdleCount(namespace: string, scope: string): Promise<number> {
      return data.idleCounters.get(scopedKey(namespace, scope)) ?? 0;
    },
  };
}
function isPrunableWorkStatus(status: WorkItem["status"]): boolean {
  return (
    status === "completed" || status === "cancelled" || status === "dead-letter"
  );
}
function isPrunableSnapshotStatus(status: FlowSnapshot["status"]): boolean {
  return (
    status === "completed" ||
    status === "blocked" ||
    status === "expired" ||
    status === "cancelled"
  );
}
export function cloneWorkItem(work: WorkItem): WorkItem {
  return Object.freeze({
    workId: work.workId,
    namespace: work.namespace,
    work: cloneRuntimeWork(work.work),
    targetId: work.targetId,
    status: work.status,
    attempt: work.attempt,
    maxAttempts: work.maxAttempts,
    notBefore: work.notBefore ? new Date(work.notBefore) : undefined,
    idempotencyKey: work.idempotencyKey,
    idleScope: work.idleScope,
    leaseToken: work.leaseToken,
    lastError: work.lastError
      ? {
          code: work.lastError.code,
          message: work.lastError.message,
          at: new Date(work.lastError.at),
          ...(work.lastError.details === undefined
            ? {}
            : {
                details: cloneJsonValue(
                  work.lastError.details,
                  "work error details",
                ),
              }),
        }
      : undefined,
    resultRef: work.resultRef
      ? cloneRuntimeResultRef(work.resultRef)
      : undefined,
    createdAt: new Date(work.createdAt),
    updatedAt: new Date(work.updatedAt),
  });
}
function incrementCounter(
  data: MemoryRuntimeData,
  namespace: string,
  scope: string,
): number {
  const key = scopedKey(namespace, scope);
  const next = (data.idleCounters.get(key) ?? 0) + 1;
  data.idleCounters.set(key, next);
  return next;
}
function statusAllowed(
  status: WorkItem["status"],
  from: SetWorkPendingOptions["from"],
): boolean {
  const allowed =
    from === undefined ? ["suspended"] : Array.isArray(from) ? from : [from];
  return allowed.includes(status);
}
export function cloneFlowSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  return Object.freeze({
    flowId: snapshot.flowId,
    workId: snapshot.workId,
    targetId: snapshot.targetId,
    namespace: snapshot.namespace,
    status: snapshot.status,
    input: cloneJsonValue(snapshot.input, "flow snapshot input"),
    ...(snapshot.continuation
      ? {
          continuation: cloneJsonValue(
            snapshot.continuation,
            "flow snapshot continuation",
          ),
        }
      : {}),
    completedSteps: cloneJsonValue(
      snapshot.completedSteps,
      "flow snapshot completedSteps",
    ) as Readonly<Record<string, JsonValue>>,
    fingerprint: [...snapshot.fingerprint],
    pendingSuspends: snapshot.pendingSuspends.map((suspend) =>
      cloneMemoryPendingSuspend(suspend),
    ),
    deliveredSuspends: snapshot.deliveredSuspends
      ? Object.freeze(
          Object.fromEntries(
            Object.entries(snapshot.deliveredSuspends).map(
              ([deliveryKey, delivery]) => [
                deliveryKey,
                delivery
                  ? cloneMemoryDeliveredSuspend(
                      delivery,
                      `flow snapshot deliveredSuspends.${deliveryKey}.payload`,
                    )
                  : undefined,
              ],
            ),
          ),
        )
      : undefined,
    scheduledWork: snapshot.scheduledWork
      ? Object.freeze(
          Object.fromEntries(
            Object.entries(snapshot.scheduledWork).map(([key, work]) => [
              key,
              { workId: work.workId, timerId: work.timerId },
            ]),
          ),
        )
      : undefined,
    updatedAt: new Date(snapshot.updatedAt),
  });
}
function cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
  return Object.freeze({
    namespace: record.namespace,
    key: record.key,
    completedAt: new Date(record.completedAt),
  });
}
function mergeDeliveredSuspend(
  snapshot: FlowSnapshot,
  options: MarkSnapshotDeliveredOptions,
): FlowSnapshot["deliveredSuspends"] {
  const suspend = snapshot.pendingSuspends.find(
    (pending) => pending.waiterId === options.waiterId,
  );
  const deliveryKey = suspend?.deliveryKey ?? suspend?.label;
  if (!deliveryKey) return snapshot.deliveredSuspends;
  return Object.freeze({
    ...(snapshot.deliveredSuspends ?? {}),
    [deliveryKey]: deliveredSuspend(options),
  });
}

function deliveredSuspend(
  options: MarkSnapshotDeliveredOptions,
): NonNullable<RuntimePendingSuspend["delivered"]> {
  return {
    eventId: options.eventId as EventCursor,
    payload: cloneJsonValue(options.payload, "flow snapshot delivered payload"),
  };
}

export function cloneRuntimeWork(work: RuntimeWork): RuntimeWork {
  switch (work.kind) {
    case "flow.resume":
      return { kind: work.kind, flowId: work.flowId };
    case "flow.timeout":
      return {
        kind: work.kind,
        flowId: work.flowId,
        suspendPoint: work.suspendPoint,
      };
    case "task.run":
      return {
        kind: work.kind,
        taskId: work.taskId,
        targetId: work.targetId,
        input:
          work.input === undefined
            ? undefined
            : cloneJsonValue(work.input, "durable task input"),
        ...(work.defer === undefined
          ? {}
          : {
              defer: cloneJsonValue(work.defer, "named defer provenance"),
            }),
      };
    case "watch.deliver":
      return {
        kind: work.kind,
        subscriptionId: work.subscriptionId,
        cursor: work.cursor,
      };
  }
}
