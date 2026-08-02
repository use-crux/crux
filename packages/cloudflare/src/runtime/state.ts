import {
  DEFAULT_RUNTIME_MAX_ATTEMPTS,
  type FlowSnapshot,
  type IdempotencyRecord,
  type NewWorkItem,
  type RuntimeStatePort,
  type WorkId,
  type RuntimeWorkItem,
  type WorkStatusCount,
  type RuntimeWorkState,
} from "@use-crux/core/runtime";
import type { CloudflareStoragePort } from "./storage";
import { scopedKey, scopedPrefix } from "./storage";

export function createCloudflareStatePort(
  storage: CloudflareStoragePort,
): RuntimeStatePort {
  return {
    async createWork(input: NewWorkItem): Promise<RuntimeWorkItem> {
      const key = scopedKey("work", input.namespace, input.workId);
      const existing = await storage.get<RuntimeWorkItem>(key);
      if (existing) return existing;
      const now = input.now ?? new Date();
      const work: RuntimeWorkItem = {
        workId: input.workId,
        namespace: input.namespace,
        work: input.work,
        targetId: input.targetId,
        status: "pending",
        attempt: 1,
        maxAttempts: input.maxAttempts ?? DEFAULT_RUNTIME_MAX_ATTEMPTS,
        idempotencyKey: input.idempotencyKey,
        ...(input.notBefore ? { notBefore: input.notBefore } : {}),
        ...(input.idleScope ? { idleScope: input.idleScope } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await storage.put(key, work);
      return work;
    },
    async getWork(workId, options) {
      return (
        (await storage.get<RuntimeWorkItem>(
          scopedKey("work", options.namespace, workId),
        )) ?? null
      );
    },
    async putWork(work) {
      await storage.put(scopedKey("work", work.namespace, work.workId), work);
    },
    async listWork(options) {
      const rows = await storage.list<RuntimeWorkItem>({
        prefix: scopedPrefix("work", options.namespace),
      });
      return [...rows.values()]
        .filter(
          (work) =>
            work.status === options.status &&
            (!options.updatedBefore || work.updatedAt < options.updatedBefore),
        )
        .slice(0, options.limit);
    },
    async countWork(options): Promise<readonly WorkStatusCount[]> {
      const rows = await storage.list<RuntimeWorkItem>({
        prefix: scopedPrefix("work", options.namespace),
      });
      const counts = new Map<string, WorkStatusCount>();
      for (const work of rows.values()) {
        const key = `${work.status}:${work.targetId}`;
        const current = counts.get(key);
        counts.set(key, {
          namespace: work.namespace,
          status: work.status,
          targetId: work.targetId,
          count: (current?.count ?? 0) + 1,
        });
      }
      return [...counts.values()];
    },
    async hasIdempotencyKey(namespace, key) {
      return (
        (await storage.get<IdempotencyRecord>(
          scopedKey("idempotency", namespace, key),
        )) !== undefined
      );
    },
    async putIdempotencyKey(record) {
      const key = scopedKey("idempotency", record.namespace, record.key);
      if ((await storage.get(key)) === undefined)
        await storage.put(key, record);
    },
    async incrementIdle(namespace, scope) {
      const key = scopedKey("idle", namespace, scope);
      const count = ((await storage.get<number>(key)) ?? 0) + 1;
      await storage.put(key, count);
      return count;
    },
    async decrementIdle(namespace, scope) {
      const key = scopedKey("idle", namespace, scope);
      const count = ((await storage.get<number>(key)) ?? 0) - 1;
      if (count < 0)
        throw new Error(`Runtime idle counter ${scope} went negative.`);
      if (count === 0) await storage.delete(key);
      else await storage.put(key, count);
      return count;
    },
    async getIdleCount(namespace, scope) {
      return (
        (await storage.get<number>(scopedKey("idle", namespace, scope))) ?? 0
      );
    },
    async setWorkPending(workId, options): Promise<RuntimeWorkItem | null> {
      const key = scopedKey("work", options.namespace, workId);
      const existing = await storage.get<RuntimeWorkItem>(key);
      if (!existing || !statusAllowed(existing.status, options.from))
        return null;
      const updated: RuntimeWorkItem = {
        workId: existing.workId,
        namespace: existing.namespace,
        work: options.work,
        targetId: existing.targetId,
        status: "pending",
        attempt: 1,
        maxAttempts: existing.maxAttempts,
        idempotencyKey: options.idempotencyKey,
        ...(existing.idleScope ? { idleScope: existing.idleScope } : {}),
        createdAt: existing.createdAt,
        updatedAt: options.now ?? new Date(),
      };
      await storage.put(key, updated);
      return updated;
    },
    async getSnapshot(flowId, options): Promise<FlowSnapshot | null> {
      return (
        (await storage.get<FlowSnapshot>(
          scopedKey("snapshot", options.namespace, flowId),
        )) ?? null
      );
    },
    async putSnapshot(snapshot) {
      await storage.put(
        scopedKey("snapshot", snapshot.namespace, snapshot.flowId),
        snapshot,
      );
    },
    async markSnapshotDelivered(workId: WorkId, options) {
      const rows = await storage.list<FlowSnapshot>({
        prefix: scopedPrefix("snapshot", options.namespace),
      });
      const entry = [...rows.entries()].find(
        ([, value]) => value.workId === workId,
      );
      if (!entry) return;
      const [key, snapshot] = entry;
      const delivered = {
        eventId: options.eventId,
        payload: options.payload,
      };
      const pendingSuspends = snapshot.pendingSuspends.map((suspend) =>
        suspend.waiterId === options.waiterId
          ? { ...suspend, delivered }
          : suspend,
      );
      const deliveryKey = snapshot.pendingSuspends.find(
        (suspend) => suspend.waiterId === options.waiterId,
      )?.deliveryKey;
      await storage.put(key, {
        ...snapshot,
        pendingSuspends,
        ...(deliveryKey
          ? {
              deliveredSuspends: {
                ...snapshot.deliveredSuspends,
                [deliveryKey]: delivered,
              },
            }
          : {}),
      });
    },
    async pruneTerminalWork(options) {
      return await pruneRows<RuntimeWorkItem>(storage, "work:", options, (work) =>
        ["completed", "cancelled", "dead-letter"].includes(work.status),
      );
    },
    async pruneTerminalSnapshots(options) {
      return await pruneRows<FlowSnapshot>(
        storage,
        "snapshot:",
        options,
        (snapshot) =>
          ["completed", "blocked", "cancelled"].includes(snapshot.status),
      );
    },
    async pruneIdempotencyKeys(options) {
      return await pruneRows<IdempotencyRecord>(
        storage,
        "idempotency:",
        options,
        () => true,
        (record) => record.completedAt,
      );
    },
  };
}

function statusAllowed(
  current: RuntimeWorkState,
  allowed: RuntimeWorkState | readonly RuntimeWorkState[] | undefined,
): boolean {
  if (allowed === undefined) return current === "suspended";
  return Array.isArray(allowed)
    ? allowed.includes(current)
    : current === allowed;
}

async function pruneRows<T extends { namespace: string }>(
  storage: CloudflareStoragePort,
  prefix: string,
  options: { namespace?: string; before: Date; limit: number },
  terminal: (value: T) => boolean,
  updatedAt: (value: T) => Date = (value) =>
    (value as T & { updatedAt: Date }).updatedAt,
) {
  const rows = await storage.list<T>({ prefix });
  const eligible = [...rows.entries()].filter(
    ([, value]) =>
      (!options.namespace || value.namespace === options.namespace) &&
      terminal(value) &&
      updatedAt(value) < options.before,
  );
  const selected = eligible.slice(0, options.limit);
  if (selected.length > 0) await storage.delete(selected.map(([key]) => key));
  return {
    removed: selected.length,
    truncated: eligible.length > selected.length,
  };
}
