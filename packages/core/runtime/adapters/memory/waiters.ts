import type { JsonValue } from '../../../storage'
import type { TimerId, WaiterId, WorkId } from '../../ports/ids'
import type {
  ClaimExpiredWaitersOptions,
  RuntimeWaiterStorePort,
} from '../../store'
import type {
  NewRuntimeWaiter,
  ResolveWaiterOptions,
  RuntimeWaiter,
} from '../../ports/waiters'
import type { MemoryRuntimeData, MemoryWriteRecorder } from './data'
import { cloneJsonValue } from './json'
import { cloneRuntimeWork } from './state'

export type RuntimeWaiterState = RuntimeWaiter['state']

export interface MemoryWaiterPort extends RuntimeWaiterStorePort {
  transition(
    waiterId: WaiterId,
    from: RuntimeWaiterState,
    to: RuntimeWaiterState,
  ): Promise<boolean>
}

export function createMemoryWaiterPort(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): MemoryWaiterPort {
  return {
    async register(waiter: NewRuntimeWaiter): Promise<RuntimeWaiter> {
      const stored: RuntimeWaiter = Object.freeze({
        namespace: waiter.namespace,
        eventName: waiter.eventName,
        match: cloneJsonValue(waiter.match, 'waiter match'),
        workId: waiter.workId,
        work: cloneRuntimeWork(waiter.work),
        timeoutAt: waiter.timeoutAt ? new Date(waiter.timeoutAt) : undefined,
        waiterId: `waiter_${data.nextWaiterId}` as WaiterId,
        state: 'armed',
      })
      recordWrite?.()
      data.nextWaiterId += 1
      data.waiters.set(stored.waiterId, stored)
      return cloneRuntimeWaiter(stored)
    },

    async resolve(
      eventName: string,
      payload: JsonValue,
      options?: ResolveWaiterOptions,
    ): Promise<readonly RuntimeWaiter[]> {
      const clonedPayload = cloneJsonValue(payload, 'event payload')
      return [...data.waiters.values()]
        .filter(
          (waiter) =>
            waiter.state === 'armed' &&
            waiter.eventName === eventName &&
            (options?.namespace === undefined ||
              waiter.namespace === options.namespace) &&
            matchesTopLevel(waiter.match, clonedPayload),
        )
        .map((waiter) => cloneRuntimeWaiter(waiter))
    },

    async cancel(waiterId: WaiterId): Promise<void> {
      const waiter = data.waiters.get(waiterId)
      if (!waiter || waiter.state !== 'armed') return
      recordWrite?.()
      data.waiters.set(waiterId, cloneWithState(waiter, 'cancelled'))
    },

    async attachTimer(waiterId: WaiterId, timerId: TimerId): Promise<void> {
      const waiter = data.waiters.get(waiterId)
      if (!waiter) return
      recordWrite?.()
      data.waiters.set(
        waiterId,
        Object.freeze({ ...cloneRuntimeWaiter(waiter), timerId }),
      )
    },

    async listByWork(workId: WorkId): Promise<readonly RuntimeWaiter[]> {
      return [...data.waiters.values()]
        .filter((waiter) => waiter.workId === workId)
        .map((waiter) => cloneRuntimeWaiter(waiter))
    },

    async claimExpired(
      options: ClaimExpiredWaitersOptions,
    ): Promise<readonly RuntimeWaiter[]> {
      return [...data.waiters.values()]
        .filter(
          (waiter) =>
            waiter.state === 'armed' &&
            waiter.timeoutAt !== undefined &&
            waiter.timeoutAt.getTime() <= options.now.getTime() &&
            (options.namespace === undefined ||
              waiter.namespace === options.namespace),
        )
        .slice(0, options.limit)
        .map((waiter) => cloneRuntimeWaiter(waiter))
    },

    async transition(
      waiterId: WaiterId,
      from: RuntimeWaiterState,
      to: RuntimeWaiterState,
    ): Promise<boolean> {
      const waiter = data.waiters.get(waiterId)
      if (!waiter || waiter.state !== from) return false
      recordWrite?.()
      data.waiters.set(waiterId, cloneWithState(waiter, to))
      return true
    },
  }
}

function matchesTopLevel(
  match: Readonly<Record<string, JsonValue>>,
  payload: JsonValue,
): boolean {
  if (!isJsonObject(payload)) return Object.keys(match).length === 0
  return Object.entries(match).every(([key, expected]) =>
    Object.prototype.hasOwnProperty.call(payload, key)
      ? payload[key] === expected
      : false,
  )
}

function cloneWithState(
  waiter: RuntimeWaiter,
  state: RuntimeWaiterState,
): RuntimeWaiter {
  return Object.freeze({ ...cloneRuntimeWaiter(waiter), state })
}

function cloneRuntimeWaiter(waiter: RuntimeWaiter): RuntimeWaiter {
  return Object.freeze({
    namespace: waiter.namespace,
    eventName: waiter.eventName,
    match: cloneJsonValue(waiter.match, 'waiter match'),
    workId: waiter.workId,
    work: cloneRuntimeWork(waiter.work),
    timeoutAt: waiter.timeoutAt ? new Date(waiter.timeoutAt) : undefined,
    waiterId: waiter.waiterId,
    timerId: waiter.timerId,
    state: waiter.state,
  })
}

function isJsonObject(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue | undefined } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
