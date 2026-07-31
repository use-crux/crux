import type { JsonValue } from "../../../storage";
import type { TimerId, WaiterId, WorkId } from "../../ports/ids";
import type {
  ClaimExpiredWaitersOptions,
  RuntimeWaiterStorePort,
} from "../../store";
import type {
  NewRuntimeWaiter,
  ResolveWaiterOptions,
  RuntimeWaiter,
} from "../../ports/waiters";
import type {
  MemoryRuntimeData,
  MemoryRuntimeWaiter,
  MemoryWriteRecorder,
} from "./data";
import { cloneJsonValue } from "./json";
import { matchesPruneNamespace, olderThan, pruneMapValues } from "./retention";
import { cloneRuntimeWork } from "./state";

export type RuntimeWaiterState = RuntimeWaiter["state"];

export interface MemoryWaiterPort extends RuntimeWaiterStorePort {
  transition(
    waiterId: WaiterId,
    from: RuntimeWaiterState,
    to: RuntimeWaiterState,
  ): Promise<boolean>;
}

export function createMemoryWaiterPort(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): MemoryWaiterPort {
  return {
    async register(waiter: NewRuntimeWaiter): Promise<RuntimeWaiter> {
      const stored: MemoryRuntimeWaiter = Object.freeze({
        namespace: waiter.namespace,
        eventName: waiter.eventName,
        source: cloneWaiterSource(waiter.source),
        match: cloneJsonValue(waiter.match, "waiter match"),
        workId: waiter.workId,
        work: cloneRuntimeWork(waiter.work),
        timeoutAt: waiter.timeoutAt ? new Date(waiter.timeoutAt) : undefined,
        waiterId: `waiter_${data.nextWaiterId}` as WaiterId,
        state: "armed",
      });
      recordWrite?.();
      data.nextWaiterId += 1;
      data.waiters.set(stored.waiterId, stored);
      return cloneRuntimeWaiter(stored);
    },

    async resolve(
      eventName: string,
      payload: JsonValue,
      options?: ResolveWaiterOptions,
    ): Promise<readonly RuntimeWaiter[]> {
      const clonedPayload = cloneJsonValue(payload, "event payload");
      return [...data.waiters.values()]
        .filter(
          (waiter) =>
            waiter.state === "armed" &&
            waiter.eventName === eventName &&
            (options?.namespace === undefined ||
              waiter.namespace === options.namespace) &&
            matchesTopLevel(waiter.match, clonedPayload),
        )
        .map((waiter) => cloneRuntimeWaiter(waiter));
    },

    async cancel(waiterId: WaiterId): Promise<void> {
      const waiter = data.waiters.get(waiterId);
      if (!waiter || waiter.state !== "armed") return;
      recordWrite?.();
      data.waiters.set(waiterId, cloneWithState(waiter, "cancelled"));
    },

    async attachTimer(waiterId: WaiterId, timerId: TimerId): Promise<void> {
      const waiter = data.waiters.get(waiterId);
      if (!waiter) return;
      recordWrite?.();
      data.waiters.set(
        waiterId,
        Object.freeze({ ...cloneRuntimeWaiter(waiter), timerId }),
      );
    },

    async listByWork(workId: WorkId): Promise<readonly RuntimeWaiter[]> {
      return [...data.waiters.values()]
        .filter((waiter) => waiter.workId === workId)
        .map((waiter) => cloneRuntimeWaiter(waiter));
    },

    async claimExpired(
      options: ClaimExpiredWaitersOptions,
    ): Promise<readonly RuntimeWaiter[]> {
      return [...data.waiters.values()]
        .filter(
          (waiter) =>
            waiter.state === "armed" &&
            waiter.timeoutAt !== undefined &&
            waiter.timeoutAt.getTime() <= options.now.getTime() &&
            (options.namespace === undefined ||
              waiter.namespace === options.namespace),
        )
        .slice(0, options.limit)
        .map((waiter) => cloneRuntimeWaiter(waiter));
    },

    async transition(
      waiterId: WaiterId,
      from: RuntimeWaiterState,
      to: RuntimeWaiterState,
    ): Promise<boolean> {
      const waiter = data.waiters.get(waiterId);
      if (!waiter || waiter.state !== from) return false;
      recordWrite?.();
      data.waiters.set(waiterId, cloneWithState(waiter, to));
      return true;
    },

    async prune(options) {
      const result = pruneMapValues(
        data.waiters,
        options,
        (waiter) =>
          matchesPruneNamespace(waiter, options.namespace) &&
          waiter.state !== "armed" &&
          olderThan(waiter.settledAt, options.before),
      );
      if (result.removed > 0) recordWrite?.();
      return result;
    },
  };
}

function matchesTopLevel(
  match: Readonly<Record<string, JsonValue>>,
  payload: JsonValue,
): boolean {
  if (!isJsonObject(payload)) return Object.keys(match).length === 0;
  return Object.entries(match).every(([key, expected]) =>
    Object.prototype.hasOwnProperty.call(payload, key)
      ? payload[key] === expected
      : false,
  );
}

function cloneWithState(
  waiter: RuntimeWaiter | MemoryRuntimeWaiter,
  state: RuntimeWaiterState,
): MemoryRuntimeWaiter {
  return Object.freeze({
    ...cloneStoredRuntimeWaiter(waiter),
    state,
    ...(state === "armed" ? {} : { settledAt: new Date() }),
  });
}

function cloneRuntimeWaiter(waiter: RuntimeWaiter): RuntimeWaiter {
  const stored = cloneStoredRuntimeWaiter(waiter);
  return Object.freeze({
    namespace: stored.namespace,
    eventName: stored.eventName,
    source: cloneWaiterSource(stored.source),
    match: stored.match,
    workId: stored.workId,
    work: stored.work,
    timeoutAt: stored.timeoutAt,
    waiterId: stored.waiterId,
    timerId: stored.timerId,
    state: stored.state,
  });
}

function cloneStoredRuntimeWaiter(
  waiter: RuntimeWaiter | MemoryRuntimeWaiter,
): MemoryRuntimeWaiter {
  return Object.freeze({
    namespace: waiter.namespace,
    eventName: waiter.eventName,
    source: cloneWaiterSource(waiter.source),
    match: cloneJsonValue(waiter.match, "waiter match"),
    workId: waiter.workId,
    work: cloneRuntimeWork(waiter.work),
    timeoutAt: waiter.timeoutAt ? new Date(waiter.timeoutAt) : undefined,
    waiterId: waiter.waiterId,
    timerId: waiter.timerId,
    state: waiter.state,
    settledAt:
      "settledAt" in waiter && waiter.settledAt
        ? new Date(waiter.settledAt)
        : undefined,
  });
}

function cloneWaiterSource(
  source: RuntimeWaiter["source"],
): RuntimeWaiter["source"] {
  if (!source) return undefined;
  return Object.freeze({
    kind: source.kind,
    signalId: source.signalId,
    ...(source.match === undefined
      ? {}
      : { match: cloneJsonValue(source.match, "Signal waiter match") }),
  });
}

function isJsonObject(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue | undefined } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
