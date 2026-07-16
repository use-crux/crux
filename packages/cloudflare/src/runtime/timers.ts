import type {
  RuntimeTimerRecord,
  RuntimeTimerStorePort,
  TimerId,
} from "@use-crux/core/runtime";
import type { CloudflareStoragePort } from "./storage";
import { scopedKey } from "./storage";

interface StoredTimer extends RuntimeTimerRecord {
  readonly settledAt?: Date;
}

const TIMER_PREFIX = "timer:";
const NEXT_TIMER_ID = "counter:timer";

export function createCloudflareTimerPort(
  storage: CloudflareStoragePort,
): RuntimeTimerStorePort {
  return {
    async put(input) {
      const duplicateKey = input.idempotencyKey
        ? scopedKey("timer-idempotency", input.namespace, input.idempotencyKey)
        : undefined;
      const duplicateId = duplicateKey
        ? await storage.get<string>(duplicateKey)
        : undefined;
      if (duplicateId) {
        const existing = await storage.get<StoredTimer>(
          `${TIMER_PREFIX}${duplicateId}`,
        );
        if (existing) return existing;
      }
      const next = ((await storage.get<number>(NEXT_TIMER_ID)) ?? 0) + 1;
      await storage.put(NEXT_TIMER_ID, next);
      const timer: StoredTimer = {
        ...input,
        timerId: `timer_${next}` as TimerId,
        state: "scheduled",
      };
      await storage.put(`${TIMER_PREFIX}${timer.timerId}`, timer);
      if (duplicateKey) await storage.put(duplicateKey, timer.timerId);
      return timer;
    },
    async get(timerId) {
      return (
        (await storage.get<StoredTimer>(`${TIMER_PREFIX}${timerId}`)) ?? null
      );
    },
    async claimDue(options) {
      const rows = await allTimers(storage);
      return rows
        .filter(
          (timer) =>
            timer.state === "scheduled" &&
            timer.fireAt <= options.now &&
            (!options.namespace || timer.namespace === options.namespace),
        )
        .slice(0, options.limit);
    },
    async list(options) {
      const rows = await allTimers(storage);
      return rows
        .filter(
          (timer) =>
            timer.namespace === options.namespace &&
            (!options.state || timer.state === options.state),
        )
        .slice(0, options.limit);
    },
    async listByWork(workId) {
      return (await allTimers(storage)).filter(
        (timer) => timer.workId === workId,
      );
    },
    async transition(timerId, from, to) {
      const key = `${TIMER_PREFIX}${timerId}`;
      const timer = await storage.get<StoredTimer>(key);
      if (!timer || timer.state !== from) return false;
      await storage.put(key, {
        ...timer,
        state: to,
        ...(to === "fired" || to === "cancelled"
          ? { settledAt: new Date() }
          : {}),
      });
      return true;
    },
    async prune(options) {
      const rows = await storage.list<StoredTimer>({ prefix: TIMER_PREFIX });
      const eligible = [...rows.entries()].filter(
        ([, timer]) =>
          (!options.namespace || timer.namespace === options.namespace) &&
          timer.state !== "scheduled" &&
          timer.settledAt !== undefined &&
          timer.settledAt < options.before,
      );
      const selected = eligible.slice(0, options.limit);
      if (selected.length > 0)
        await storage.delete(selected.map(([key]) => key));
      return {
        removed: selected.length,
        truncated: eligible.length > selected.length,
      };
    },
  };
}

async function allTimers(
  storage: CloudflareStoragePort,
): Promise<StoredTimer[]> {
  return [
    ...(await storage.list<StoredTimer>({ prefix: TIMER_PREFIX })).values(),
  ];
}
