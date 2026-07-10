import { DEFAULT_RUNTIME_MAX_ATTEMPTS } from '../engine/retry'
import type { WakeEnvelope } from '../engine/envelope'
import type { WorkItem } from '../engine/work'
import type { RuntimeTargetId, TaskId, WorkId } from '../ports'

export function makeConformanceWorkItem(
  overrides: Partial<WorkItem> = {},
): WorkItem {
  const now = new Date('2026-07-02T00:00:00.000Z')
  return {
    workId: 'work_1' as WorkId,
    namespace: 'tenant-a',
    work: {
      kind: 'task.run',
      taskId: 'task_1' as TaskId,
      targetId: 'review' as RuntimeTargetId,
    },
    targetId: 'review' as RuntimeTargetId,
    status: 'pending',
    attempt: 1,
    maxAttempts: DEFAULT_RUNTIME_MAX_ATTEMPTS,
    idempotencyKey: 'task:work_1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeConformanceWakeEnvelope(work: WorkItem): WakeEnvelope {
  return {
    v: 1,
    ns: work.namespace,
    workId: work.workId,
    target: work.targetId,
    kind: work.work.kind,
    idempotencyKey: work.idempotencyKey,
    attempt: work.attempt,
  }
}
