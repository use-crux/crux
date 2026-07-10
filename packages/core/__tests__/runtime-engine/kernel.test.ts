import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import type { RuntimeTargetId, TaskId, WorkId } from '../../src/runtime/ports'
import {
  createRuntimeKernel,
  wakeEnvelopeForWork,
} from '../../src/runtime/engine/kernel'
import {
  createOutboxDispatcher,
  dispatchBatch,
} from '../../src/runtime/engine/outbox'

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

  it('does not resurrect terminal work when a duplicate wake read stale pending state before leasing', async () => {
    const store = inMemoryRuntimeStore()
    let executions = 0
    const kernel = createRuntimeKernel({
      store,
      targets: {
        'embed-document': {
          targetId: 'embed-document' as RuntimeTargetId,
          kind: 'task',
          execute: async () => {
            executions += 1
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
    const envelope = wakeEnvelopeForWork(enqueued)
    const originalClaim = store.leases.claim.bind(store.leases)
    let releaseFirstClaim!: () => void
    const firstClaimReached = new Promise<void>((resolve) => {
      let claimCalls = 0
      ;(store.leases as unknown as typeof store.leases & {
        claim: typeof store.leases.claim
      }).claim = async (...args) => {
        claimCalls += 1
        if (claimCalls === 1) {
          resolve()
          await new Promise<void>((release) => {
            releaseFirstClaim = release
          })
        }
        return originalClaim(...args)
      }
    })

    const staleDelivery = kernel.handleWake(envelope)
    await firstClaimReached
    await expect(kernel.handleWake(envelope)).resolves.toEqual({
      status: 200,
      outcome: 'processed',
    })
    expect(executions).toBe(1)

    releaseFirstClaim()
    await expect(staleDelivery).resolves.toEqual({
      status: 200,
      outcome: 'duplicate',
    })
    expect(executions).toBe(1)
    await expect(
      store.state.getWork(enqueued.workId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'completed' })
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

  it('dispatches outbox rows with bounded concurrency', async () => {
    const store = inMemoryRuntimeStore()
    for (const workId of ['work_1', 'work_2', 'work_3', 'work_4']) {
      await store.outbox.put({
        v: 1,
        ns: 'tenant-a',
        workId: workId as WorkId,
        target: 'embed-document' as RuntimeTargetId,
        kind: 'task.run',
        idempotencyKey: `task:${workId}`,
        attempt: 1,
      })
    }

    let active = 0
    let maxActive = 0
    const result = await dispatchBatch({
      store,
      concurrency: 2,
      deliver: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        active -= 1
      },
      now: () => new Date('2100-01-01T00:00:00.000Z'),
    })

    expect(result).toEqual({ delivered: 4, failed: 0 })
    expect(maxActive).toBe(2)
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

  it('retries blocked work with a fresh operator idempotency key', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'work_task_1' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
    })
    const enqueued = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'missing-target' as RuntimeTargetId,
      idleScope: 'flow:flow_1',
    })
    await kernel.handleWake(wakeEnvelopeForWork(enqueued))
    await expect(
      store.state.getIdleCount('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(0)
    const initialOutbox = await store.outbox.claimPending({
      namespace: 'tenant-a',
      now: new Date('2100-01-01T00:00:00.000Z'),
    })
    for (const item of initialOutbox) await store.outbox.confirm(item.outboxId)

    await expect(
      kernel.retryWork({
        namespace: 'tenant-a',
        workId: enqueued.workId,
      }),
    ).resolves.toMatchObject({
      retried: true,
      work: {
        status: 'pending',
        attempt: 1,
        idempotencyKey: expect.stringMatching(/^retry:work_task_1:mr2qmtc0:/),
        lastError: undefined,
        notBefore: undefined,
      },
    })
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'task:work_task_1'),
    ).resolves.toBe(true)
    await expect(
      store.state.getIdleCount('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(1)
    await expect(
      store.events.read({ namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ name: 'crux.retried:work_task_1' }),
      ]),
    })
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2100-01-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        envelope: expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^retry:work_task_1:mr2qmtc0:/),
        }),
      }),
    ])
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

  it('does not deliver task work before its notBefore deadline', async () => {
    const store = inMemoryRuntimeStore()
    let executions = 0
    const kernel = createRuntimeKernel({
      store,
      targets: {
        'embed-document': {
          targetId: 'embed-document' as RuntimeTargetId,
          kind: 'task',
          execute: async () => {
            executions += 1
            return { status: 'completed' }
          },
        },
      },
      newWorkId: () => 'work_task_1' as WorkId,
      now: () => new Date('2100-01-01T00:00:00.000Z'),
    })
    const notBefore = new Date('2100-01-01T00:00:01.000Z')
    const enqueued = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
      notBefore,
    })

    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2100-01-01T00:00:00.999Z'),
      }),
    ).resolves.toEqual([])
    await expect(
      kernel.handleWake(wakeEnvelopeForWork(enqueued)),
    ).resolves.toEqual({
      status: 200,
      outcome: 'retry-scheduled',
    })
    expect(executions).toBe(0)
    await expect(
      store.state.getWork('work_task_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending', attempt: 1 })
    const due = await store.outbox.claimPending({
      namespace: 'tenant-a',
      now: notBefore,
    })
    expect(due).toEqual([
      expect.objectContaining({ nextAttemptAt: notBefore }),
    ])
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
      now: () => new Date('2100-01-01T00:00:00.000Z'),
      rng: () => 0,
    })
    const enqueued = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    })
    const initialOutbox = await store.outbox.claimPending({
      namespace: 'tenant-a',
      now: new Date('2100-01-01T00:00:00.000Z'),
    })
    for (const item of initialOutbox) await store.outbox.confirm(item.outboxId)

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
      notBefore: new Date('2100-01-01T00:00:00.500Z'),
    })
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2100-01-01T00:00:00.499Z'),
      }),
    ).resolves.toEqual([])
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2100-01-01T00:00:00.500Z'),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        envelope: expect.objectContaining({ attempt: 2 }),
        nextAttemptAt: new Date('2100-01-01T00:00:00.500Z'),
      }),
    ])

    const exhausted = await store.state.getWork('work_task_1' as WorkId, {
      namespace: 'tenant-a',
    })
    await store.state.putWork({
      ...exhausted!,
      attempt: 8,
      notBefore: new Date('2099-01-01T00:00:00.000Z'),
    })
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
