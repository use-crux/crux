import type { JsonValue } from '../../../storage'
import type { WorkItem } from '../../engine/work'
import type { FlowId, WorkId } from '../../ports/ids'
import type {
  FlowSnapshot,
  IdempotencyRecord,
  MarkSnapshotDeliveredOptions,
  NewWorkItem,
  RuntimePendingSuspend,
  RuntimeStatePort,
  RuntimeStateReadOptions,
  SetWorkPendingOptions,
} from '../../ports/state'
import type { RuntimeWork } from '../../ports/work'
import type { MemoryRuntimeData, MemoryWriteRecorder } from './data'
import { scopedKey } from './data'
import { cloneJsonValue } from './json'

const DEFAULT_MAX_ATTEMPTS = 8

export function createMemoryStatePort(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeStatePort {
  return {
    async createWork(input: NewWorkItem): Promise<WorkItem> {
      const key = scopedKey(input.namespace, input.workId)
      const existing = data.work.get(key)
      if (existing) return cloneWorkItem(existing)

      recordWrite?.()
      const now = input.now ? new Date(input.now) : new Date()
      const stored: WorkItem = Object.freeze({
        workId: input.workId,
        namespace: input.namespace,
        work: cloneRuntimeWork(input.work),
        targetId: input.targetId,
        status: 'pending',
        attempt: 1,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        notBefore: input.notBefore ? new Date(input.notBefore) : undefined,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
      })
      data.work.set(key, stored)
      return cloneWorkItem(stored)
    },

    async getWork(
      workId: WorkId,
      options: RuntimeStateReadOptions,
    ): Promise<WorkItem | null> {
      const work = data.work.get(scopedKey(options.namespace, workId))
      return work ? cloneWorkItem(work) : null
    },

    async putWork(work: WorkItem): Promise<void> {
      recordWrite?.()
      data.work.set(scopedKey(work.namespace, work.workId), cloneWorkItem(work))
    },

    async setWorkPending(
      workId: WorkId,
      options: SetWorkPendingOptions,
    ): Promise<WorkItem | null> {
      const key = scopedKey(options.namespace, workId)
      const existing = data.work.get(key)
      if (!existing || existing.status !== 'suspended') return null

      recordWrite?.()
      const updated: WorkItem = Object.freeze({
        workId: existing.workId,
        namespace: existing.namespace,
        work: cloneRuntimeWork(options.work),
        targetId: existing.targetId,
        status: 'pending',
        attempt: 1,
        maxAttempts: existing.maxAttempts,
        idempotencyKey: options.idempotencyKey,
        createdAt: new Date(existing.createdAt),
        updatedAt: new Date(),
      })
      data.work.set(key, updated)
      return cloneWorkItem(updated)
    },

    async getSnapshot(
      flowId: FlowId,
      options: RuntimeStateReadOptions,
    ): Promise<FlowSnapshot | null> {
      const snapshot = data.snapshots.get(scopedKey(options.namespace, flowId))
      return snapshot ? cloneFlowSnapshot(snapshot) : null
    },

    async putSnapshot(snapshot: FlowSnapshot): Promise<void> {
      recordWrite?.()
      data.snapshots.set(
        scopedKey(snapshot.namespace, snapshot.flowId),
        cloneFlowSnapshot(snapshot),
      )
    },

    async markSnapshotDelivered(
      workId: WorkId,
      options: MarkSnapshotDeliveredOptions,
    ): Promise<void> {
      const entry = [...data.snapshots.entries()].find(
        ([, snapshot]) =>
          snapshot.namespace === options.namespace &&
          snapshot.workId === workId,
      )
      if (!entry) return

      const [key, snapshot] = entry
      const pendingSuspends = snapshot.pendingSuspends.map((suspend) => {
        if (suspend.waiterId !== options.waiterId) return suspend
        return Object.freeze({
          ...clonePendingSuspend(suspend),
          delivered: { eventId: options.eventId },
        })
      })
      recordWrite?.()
      data.snapshots.set(
        key,
        cloneFlowSnapshot({ ...snapshot, pendingSuspends }),
      )
    },

    async hasIdempotencyKey(namespace: string, key: string): Promise<boolean> {
      return data.idempotency.has(scopedKey(namespace, key))
    },

    async putIdempotencyKey(record: IdempotencyRecord): Promise<void> {
      const key = scopedKey(record.namespace, record.key)
      if (data.idempotency.has(key)) return
      recordWrite?.()
      data.idempotency.set(key, cloneIdempotencyRecord(record))
    },
  }
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
    leaseToken: work.leaseToken,
    lastError: work.lastError
      ? {
          code: work.lastError.code,
          message: work.lastError.message,
          at: new Date(work.lastError.at),
        }
      : undefined,
    createdAt: new Date(work.createdAt),
    updatedAt: new Date(work.updatedAt),
  })
}

export function cloneFlowSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  return Object.freeze({
    flowId: snapshot.flowId,
    workId: snapshot.workId,
    targetId: snapshot.targetId,
    namespace: snapshot.namespace,
    status: snapshot.status,
    input: cloneJsonValue(snapshot.input, 'flow snapshot input'),
    completedSteps: cloneJsonValue(
      snapshot.completedSteps,
      'flow snapshot completedSteps',
    ) as Readonly<Record<string, JsonValue>>,
    fingerprint: [...snapshot.fingerprint],
    pendingSuspends: snapshot.pendingSuspends.map((suspend) =>
      clonePendingSuspend(suspend),
    ),
    updatedAt: new Date(snapshot.updatedAt),
  })
}

function cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
  return Object.freeze({
    namespace: record.namespace,
    key: record.key,
    completedAt: new Date(record.completedAt),
  })
}

function clonePendingSuspend(
  suspend: RuntimePendingSuspend,
): RuntimePendingSuspend {
  return Object.freeze({
    label: suspend.label,
    waiterId: suspend.waiterId,
    timerId: suspend.timerId,
    delivered: suspend.delivered
      ? { eventId: suspend.delivered.eventId }
      : undefined,
  })
}

export function cloneRuntimeWork(work: RuntimeWork): RuntimeWork {
  switch (work.kind) {
    case 'flow.resume':
      return { kind: work.kind, flowId: work.flowId }
    case 'flow.timeout':
      return {
        kind: work.kind,
        flowId: work.flowId,
        suspendPoint: work.suspendPoint,
      }
    case 'task.run':
      return {
        kind: work.kind,
        taskId: work.taskId,
        targetId: work.targetId,
      }
    case 'watch.deliver':
      return {
        kind: work.kind,
        subscriptionId: work.subscriptionId,
        cursor: work.cursor,
      }
  }
}
