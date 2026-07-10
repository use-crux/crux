import type { TimerId, WorkId } from '../../ports/ids'
import type {
  ClaimDueTimersOptions,
  NewRuntimeTimerRecord,
  RuntimeTimerRecord,
  RuntimeTimerState,
  RuntimeTimerStorePort,
} from '../../store'
import type {
  MemoryRuntimeData,
  MemoryRuntimeTimerRecord,
  MemoryWriteRecorder,
} from './data'
import { scopedKey } from './data'
import { matchesPruneNamespace, olderThan, pruneMapValues } from './retention'
import { cloneRuntimeWork } from './state'

export function createMemoryTimerStore(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeTimerStorePort {
  return {
    async put(timer: NewRuntimeTimerRecord): Promise<RuntimeTimerRecord> {
      const duplicateKey = timer.idempotencyKey
        ? scopedKey(timer.namespace, timer.idempotencyKey)
        : undefined
      const existing = duplicateKey
        ? data.timerDuplicateKeys.get(duplicateKey)
        : undefined
      if (existing) return cloneTimerRecord(existing)

      recordWrite?.()
      const stored: MemoryRuntimeTimerRecord = Object.freeze({
        namespace: timer.namespace,
        fireAt: new Date(timer.fireAt),
        workId: timer.workId,
        waiterId: timer.waiterId,
        idleScope: timer.idleScope,
        work: cloneRuntimeWork(timer.work),
        idempotencyKey: timer.idempotencyKey,
        timerId: `timer_${data.nextTimerId}` as TimerId,
        state: 'scheduled',
      })
      data.nextTimerId += 1
      data.timers.set(stored.timerId, stored)
      if (duplicateKey) data.timerDuplicateKeys.set(duplicateKey, stored)
      return cloneTimerRecord(stored)
    },

    async get(timerId: TimerId): Promise<RuntimeTimerRecord | null> {
      const timer = data.timers.get(timerId)
      return timer ? cloneTimerRecord(timer) : null
    },

    async claimDue(
      options: ClaimDueTimersOptions,
    ): Promise<readonly RuntimeTimerRecord[]> {
      const due = [...data.timers.values()]
        .filter(
          (timer) =>
            timer.state === 'scheduled' &&
            timer.fireAt.getTime() <= options.now.getTime() &&
            (options.namespace === undefined ||
              timer.namespace === options.namespace),
        )
        .slice(0, options.limit)
      return due.map((timer) => cloneTimerRecord(timer))
    },

    async list(options): Promise<readonly RuntimeTimerRecord[]> {
      const rows = [...data.timers.values()]
        .filter(
          (timer) =>
            timer.namespace === options.namespace &&
            (options.state === undefined || timer.state === options.state),
        )
        .slice(0, options.limit)
      return rows.map((timer) => cloneTimerRecord(timer))
    },

    async listByWork(workId: WorkId): Promise<readonly RuntimeTimerRecord[]> {
      return [...data.timers.values()]
        .filter((timer) => timer.workId === workId)
        .map((timer) => cloneTimerRecord(timer))
    },

    async transition(
      timerId: TimerId,
      from: RuntimeTimerState,
      to: RuntimeTimerState,
    ): Promise<boolean> {
      const timer = data.timers.get(timerId)
      if (!timer || timer.state !== from) return false
      recordWrite?.()
      data.timers.set(
        timerId,
        cloneStoredTimerRecord({
          ...timer,
          state: to,
          ...(to === 'fired' || to === 'cancelled'
            ? { settledAt: new Date() }
            : {}),
        }),
      )
      return true
    },

    async prune(options) {
      const result = pruneMapValues(
        data.timers,
        options,
        (timer) =>
          matchesPruneNamespace(timer, options.namespace) &&
          (timer.state === 'fired' || timer.state === 'cancelled') &&
          olderThan(timer.settledAt, options.before),
        (timer) => {
          for (const [key, value] of data.timerDuplicateKeys.entries()) {
            if (value.timerId === timer.timerId) data.timerDuplicateKeys.delete(key)
          }
        },
      )
      if (result.removed > 0) recordWrite?.()
      return result
    },
  }
}

export function cloneTimerRecord(
  timer: RuntimeTimerRecord,
): RuntimeTimerRecord {
  const stored = cloneStoredTimerRecord(timer)
  return Object.freeze({
    namespace: stored.namespace,
    fireAt: stored.fireAt,
    workId: stored.workId,
    waiterId: stored.waiterId,
    idleScope: stored.idleScope,
    work: stored.work,
    idempotencyKey: stored.idempotencyKey,
    timerId: stored.timerId,
    state: stored.state,
  })
}

function cloneStoredTimerRecord(
  timer: RuntimeTimerRecord | MemoryRuntimeTimerRecord,
): MemoryRuntimeTimerRecord {
  return Object.freeze({
    namespace: timer.namespace,
    fireAt: new Date(timer.fireAt),
    workId: timer.workId,
    waiterId: timer.waiterId,
    idleScope: timer.idleScope,
    work: cloneRuntimeWork(timer.work),
    idempotencyKey: timer.idempotencyKey,
    timerId: timer.timerId,
    state: timer.state,
    settledAt:
      'settledAt' in timer && timer.settledAt
        ? new Date(timer.settledAt)
        : undefined,
  })
}
