import type {
  RuntimeOutboxItem,
  RuntimeOutboxPort,
  WakeEnvelope,
  WorkId,
} from "@use-crux/core/runtime";
import type { CloudflareStoragePort } from "./storage";

interface StoredOutboxItem extends RuntimeOutboxItem {
  readonly confirmedAt?: Date;
}

const OUTBOX_PREFIX = "outbox:";
const NEXT_OUTBOX_ID = "counter:outbox";

export function createCloudflareOutboxPort(
  storage: CloudflareStoragePort,
): RuntimeOutboxPort {
  return {
    async put(envelope: WakeEnvelope, options = {}) {
      const rows = await storage.list<StoredOutboxItem>({
        prefix: OUTBOX_PREFIX,
      });
      const deliverAt = options.deliverAt ?? new Date();
      const existing = [...rows.values()].find(
        (item) =>
          item.state === "pending" &&
          item.namespace === envelope.ns &&
          item.envelope.idempotencyKey === envelope.idempotencyKey &&
          item.nextAttemptAt.getTime() === deliverAt.getTime(),
      );
      if (existing) return existing;
      const next = ((await storage.get<number>(NEXT_OUTBOX_ID)) ?? 0) + 1;
      await storage.put(NEXT_OUTBOX_ID, next);
      const item: StoredOutboxItem = {
        outboxId: `outbox_${next}`,
        namespace: envelope.ns,
        envelope,
        state: "pending",
        attempts: 0,
        nextAttemptAt: deliverAt,
      };
      await storage.put(`${OUTBOX_PREFIX}${item.outboxId}`, item);
      return item;
    },
    async get(outboxId) {
      return (
        (await storage.get<StoredOutboxItem>(`${OUTBOX_PREFIX}${outboxId}`)) ??
        null
      );
    },
    async claimPending(options) {
      const rows = await storage.list<StoredOutboxItem>({
        prefix: OUTBOX_PREFIX,
      });
      const eligible = [...rows.values()]
        .filter(
          (item) =>
            item.state !== "confirmed" &&
            item.nextAttemptAt <= options.now &&
            (!options.namespace || item.namespace === options.namespace),
        )
        .slice(0, options.limit);
      return await Promise.all(
        eligible.map(async (item) => {
          const claimed: StoredOutboxItem = {
            ...item,
            state: "dispatched",
            attempts: item.attempts + 1,
          };
          await storage.put(`${OUTBOX_PREFIX}${item.outboxId}`, claimed);
          return claimed;
        }),
      );
    },
    async list(options) {
      const rows = await storage.list<StoredOutboxItem>({
        prefix: OUTBOX_PREFIX,
      });
      return [...rows.values()]
        .filter(
          (item) =>
            item.namespace === options.namespace &&
            (!options.state || item.state === options.state),
        )
        .slice(0, options.limit);
    },
    async listByWork(workId: WorkId, options = {}) {
      const rows = await storage.list<StoredOutboxItem>({
        prefix: OUTBOX_PREFIX,
      });
      return [...rows.values()]
        .filter(
          (item) =>
            item.envelope.workId === workId &&
            (!options.namespace || item.namespace === options.namespace) &&
            (!options.state || item.state === options.state),
        )
        .slice(0, options.limit);
    },
    async confirm(outboxId) {
      const key = `${OUTBOX_PREFIX}${outboxId}`;
      const item = await storage.get<StoredOutboxItem>(key);
      if (!item || item.state === "confirmed") return;
      await storage.put(key, {
        ...item,
        state: "confirmed",
        confirmedAt: new Date(),
      });
    },
    async retryLater(outboxId, nextAttemptAt) {
      const key = `${OUTBOX_PREFIX}${outboxId}`;
      const item = await storage.get<StoredOutboxItem>(key);
      if (!item || item.state === "confirmed") return;
      await storage.put(key, { ...item, state: "pending", nextAttemptAt });
    },
    async prune() {
      return { removed: 0, truncated: false };
    },
  };
}
