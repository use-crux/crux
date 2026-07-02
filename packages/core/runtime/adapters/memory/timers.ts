import type { TimerId, WorkId } from '../../ports/ids'
import type {
  ClaimDueTimersOptions,
  NewRuntimeTimerRecord,
  RuntimeTimerRecord,
  RuntimeTimerState,
  RuntimeTimerStorePort,
} from '../../store'
import type { MemoryRuntimeData, MemoryWriteRecorder } from './data'
import { scopedKey } from './data'
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
      const stored: RuntimeTimerRecord = Object.freeze({
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
      data.timers.set(timerId, cloneTimerRecord({ ...timer, state: to }))
      return true
    },
  }
}

export function cloneTimerRecord(
  timer: RuntimeTimerRecord,
): RuntimeTimerRecord {
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
  })
}
