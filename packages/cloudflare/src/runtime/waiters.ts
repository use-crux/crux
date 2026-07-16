import type { JsonValue } from "@use-crux/core/storage";
import type {
  RuntimeWaiter,
  RuntimeWaiterStorePort,
  WaiterId,
} from "@use-crux/core/runtime";
import type { CloudflareStoragePort } from "./storage";

interface StoredWaiter extends RuntimeWaiter {
  readonly settledAt?: Date;
}

const WAITER_PREFIX = "waiter:";
const NEXT_WAITER_ID = "counter:waiter";

export function createCloudflareWaiterPort(
  storage: CloudflareStoragePort,
): RuntimeWaiterStorePort {
  return {
    async register(input) {
      const next = ((await storage.get<number>(NEXT_WAITER_ID)) ?? 0) + 1;
      await storage.put(NEXT_WAITER_ID, next);
      const waiter: StoredWaiter = {
        ...input,
        waiterId: `waiter_${next}` as WaiterId,
        state: "armed",
      };
      await storage.put(`${WAITER_PREFIX}${waiter.waiterId}`, waiter);
      return waiter;
    },
    async resolve(eventName, payload, options) {
      return (await allWaiters(storage)).filter(
        (waiter) =>
          waiter.state === "armed" &&
          waiter.eventName === eventName &&
          (!options?.namespace || waiter.namespace === options.namespace) &&
          matchesTopLevel(waiter.match, payload),
      );
    },
    async cancel(waiterId) {
      await transition(storage, waiterId, "armed", "cancelled");
    },
    async attachTimer(waiterId, timerId) {
      const key = `${WAITER_PREFIX}${waiterId}`;
      const waiter = await storage.get<StoredWaiter>(key);
      if (waiter) await storage.put(key, { ...waiter, timerId });
    },
    async listByWork(workId) {
      return (await allWaiters(storage)).filter(
        (waiter) => waiter.workId === workId,
      );
    },
    async claimExpired(options) {
      return (await allWaiters(storage))
        .filter(
          (waiter) =>
            waiter.state === "armed" &&
            waiter.timeoutAt !== undefined &&
            waiter.timeoutAt <= options.now &&
            (!options.namespace || waiter.namespace === options.namespace),
        )
        .slice(0, options.limit);
    },
    async transition(waiterId, from, to) {
      return await transition(storage, waiterId, from, to);
    },
    async prune(options) {
      const rows = await storage.list<StoredWaiter>({ prefix: WAITER_PREFIX });
      const eligible = [...rows.entries()].filter(
        ([, waiter]) =>
          (!options.namespace || waiter.namespace === options.namespace) &&
          waiter.state !== "armed" &&
          waiter.settledAt !== undefined &&
          waiter.settledAt < options.before,
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

async function allWaiters(
  storage: CloudflareStoragePort,
): Promise<StoredWaiter[]> {
  return [
    ...(await storage.list<StoredWaiter>({ prefix: WAITER_PREFIX })).values(),
  ];
}

async function transition(
  storage: CloudflareStoragePort,
  waiterId: WaiterId,
  from: RuntimeWaiter["state"],
  to: RuntimeWaiter["state"],
): Promise<boolean> {
  const key = `${WAITER_PREFIX}${waiterId}`;
  const waiter = await storage.get<StoredWaiter>(key);
  if (!waiter || waiter.state !== from) return false;
  await storage.put(key, {
    ...waiter,
    state: to,
    ...(to === "armed" ? {} : { settledAt: new Date() }),
  });
  return true;
}

function matchesTopLevel(
  match: Readonly<Record<string, JsonValue>>,
  payload: JsonValue,
): boolean {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return Object.keys(match).length === 0;
  }
  const record = payload as Readonly<Record<string, JsonValue | undefined>>;
  return Object.entries(match).every(
    ([key, expected]) => key in record && record[key] === expected,
  );
}
