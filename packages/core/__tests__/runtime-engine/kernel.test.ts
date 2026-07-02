import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../runtime/adapters/memory'
import type { RuntimeTargetId, TaskId, WorkId } from '../../runtime/ports'
import {
  createRuntimeKernel,
  wakeEnvelopeForWork,
} from '../../runtime/engine/kernel'
import {
  createOutboxDispatcher,
  dispatchBatch,
} from '../../runtime/engine/outbox'

describe('RuntimeKernel', () => {
  it('runs task work once through outbox delivery and duplicate wake handling', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {
        'embed-document': {
          targetId: 'embed-document' as RuntimeTargetId,
          kind: 'task',
          execute: async ({ work }) => {
            expect(work.status).toBe('leased')
            await store.events.append({
              namespace: work.namespace,
              name: 'task.executed',
              payload: { workId: work.workId },
            })
            return { status: 'completed' }
          },
        },
      },
      newWorkId: () => 'work_task_1' as WorkId,
    })

    const enqueued = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    })
    expect(enqueued).toMatchObject({
      workId: 'work_task_1',
      status: 'pending',
      idempotencyKey: 'task:work_task_1',
    })

    await createOutboxDispatcher({
      store,
      deliver: async (envelope) => {
        await kernel.handleWake(envelope)
      },
    }).nudge()

    await expect(
      store.state.getWork('work_task_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'completed' })
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'task:work_task_1'),
    ).resolves.toBe(true)

    await expect(
      kernel.handleWake(wakeEnvelopeForWork(enqueued)),
    ).resolves.toEqual({
      status: 200,
      outcome: 'duplicate',
    })
    await expect(
      store.events.read({ namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      events: [expect.objectContaining({ name: 'task.executed' })],
    })
  })

  it('redelivers an outbox row after confirm crashes without executing work twice', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {
        'embed-document': {
          targetId: 'embed-document' as RuntimeTargetId,
          kind: 'task',
          execute: async ({ work }) => {
            await store.events.append({
              namespace: work.namespace,
              name: 'task.executed',
              payload: { workId: work.workId },
            })
            return { status: 'completed' }
          },
        },
      },
      newWorkId: () => 'work_task_1' as WorkId,
    })
    await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    })

    store.testing.crashBeforeConfirm()
    await expect(
      dispatchBatch({
        store,
        deliver: async (envelope) => {
          await kernel.handleWake(envelope)
        },
        now: () => new Date('2100-01-01T00:00:00.000Z'),
        rng: () => 0,
      }),
    ).resolves.toEqual({ delivered: 0, failed: 1 })

    await expect(
      dispatchBatch({
        store,
        deliver: async (envelope) => {
          await kernel.handleWake(envelope)
        },
        now: () => new Date('2100-01-01T00:00:00.500Z'),
        rng: () => 0,
      }),
    ).resolves.toEqual({ delivered: 1, failed: 0 })
    await expect(
      store.events.read({ namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      events: [expect.objectContaining({ name: 'task.executed' })],
    })
  })

  it('marks unknown targets blocked and acknowledges the poison wake', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'work_task_1' as WorkId,
    })
    const enqueued = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'missing-target' as RuntimeTargetId,
    })

    await expect(
      kernel.handleWake(wakeEnvelopeForWork(enqueued)),
    ).resolves.toEqual({
      status: 200,
      outcome: 'blocked',
    })
    await expect(
      store.state.getWork('work_task_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      status: 'blocked',
      lastError: { code: 'TARGET_NOT_FOUND' },
    })
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'task:work_task_1'),
    ).resolves.toBe(true)
  })

  it('returns busy when another worker holds the work lease', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {
        'embed-document': {
          targetId: 'embed-document' as RuntimeTargetId,
          kind: 'task',
          execute: async () => ({ status: 'completed' }),
        },
      },
      newWorkId: () => 'work_task_1' as WorkId,
    })
    const enqueued = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    })
    await store.leases.claim('work:work_task_1', { ttlMs: 60_000 })

    await expect(
      kernel.handleWake(wakeEnvelopeForWork(enqueued)),
    ).resolves.toEqual({
      status: 409,
      outcome: 'busy',
    })
    await expect(
      store.state.getWork('work_task_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending', attempt: 1 })
  })

  it('reschedules retryable failures with backoff and dead-letters exhausted work', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {
        'embed-document': {
          targetId: 'embed-document' as RuntimeTargetId,
          kind: 'task',
          execute: async () => {
            throw new Error('database unavailable')
          },
        },
      },
      newWorkId: () => 'work_task_1' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
      rng: () => 0,
    })
    const enqueued = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    })

    await expect(
      kernel.handleWake(wakeEnvelopeForWork(enqueued)),
    ).resolves.toEqual({
      status: 200,
      outcome: 'retry-scheduled',
    })
    await expect(
      store.state.getWork('work_task_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      status: 'pending',
      attempt: 2,
      notBefore: new Date('2026-07-02T00:00:00.500Z'),
    })

    const exhausted = await store.state.getWork('work_task_1' as WorkId, {
      namespace: 'tenant-a',
    })
    await store.state.putWork({ ...exhausted!, attempt: 8 })
    await expect(
      kernel.handleWake(wakeEnvelopeForWork(exhausted!)),
    ).resolves.toEqual({
      status: 200,
      outcome: 'dead-lettered',
    })
    await expect(
      store.state.getWork('work_task_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      status: 'dead-letter',
      lastError: { code: 'WORK_DEAD_LETTERED' },
    })
  })
})
