import { expect, it, vi } from 'vitest'
import type { FlowId, WorkId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import {
  makeConformanceWakeEnvelope,
  makeConformanceWorkItem,
} from './store-fixtures'
import type { RunStoreAdapterTestsOptions } from './store-types'

export function registerStoreCoordinationTests<
  TStore extends RuntimeStoreAdapter,
>(options: RunStoreAdapterTestsOptions<TStore>): void {
  it('invariant: waiter resolution and timeout races have one CAS winner', async () => {
    const store = await options.createStore()
    const waiter = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'document.approved',
      match: { documentId: 'doc_1' },
      workId: 'work_flow_1' as WorkId,
      work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
    })
    await store.waiters.register({
      namespace: 'tenant-b',
      eventName: 'document.approved',
      match: { documentId: 'doc_1' },
      work: { kind: 'flow.resume', flowId: 'flow_2' as FlowId },
    })

    await expect(
      store.waiters.resolve(
        'document.approved',
        { documentId: 'doc_1' },
        {
          namespace: 'tenant-a',
        },
      ),
    ).resolves.toEqual([expect.objectContaining({ waiterId: waiter.waiterId })])
    expect(waiter.workId).toBe('work_flow_1')

    await expect(
      Promise.all([
        store.waiters.transition(waiter.waiterId, 'armed', 'fired'),
        store.waiters.transition(waiter.waiterId, 'armed', 'timed-out'),
      ]),
    ).resolves.toEqual([true, false])
    await expect(
      store.waiters.resolve(
        'document.approved',
        { documentId: 'doc_1' },
        {
          namespace: 'tenant-a',
        },
      ),
    ).resolves.toEqual([])
  })

  it('invariant: empty waiter matches accept scalar payloads and non-empty matches require objects', async () => {
    const store = await options.createStore()
    const waiter = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'document.ready',
      match: {},
      workId: 'work_flow_1' as WorkId,
      work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
    })
    await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'document.ready',
      match: { documentId: 'doc_1' },
      workId: 'work_flow_2' as WorkId,
      work: { kind: 'flow.resume', flowId: 'flow_2' as FlowId },
    })

    await expect(
      store.waiters.resolve('document.ready', 'ready', {
        namespace: 'tenant-a',
      }),
    ).resolves.toEqual([expect.objectContaining({ waiterId: waiter.waiterId })])
  })

  it('invariant: owned waiter and timer queries are scoped by work and timeout eligibility', async () => {
    const store = await options.createStore()
    const dueAt = new Date('2026-07-02T00:00:10.000Z')
    const waiter = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'document.approved',
      match: {},
      workId: 'work_flow_1' as WorkId,
      work: { kind: 'flow.timeout', flowId: 'flow_1' as FlowId, suspendPoint: 'approval' },
      timeoutAt: dueAt,
    })
    await store.waiters.register({
      namespace: 'tenant-b',
      eventName: 'document.approved',
      match: {},
      workId: 'work_flow_1' as WorkId,
      work: { kind: 'flow.resume', flowId: 'flow_2' as FlowId },
      timeoutAt: dueAt,
    })
    const timer = await store.timers.put({
      namespace: 'tenant-a',
      fireAt: dueAt,
      workId: 'work_flow_1' as WorkId,
      waiterId: waiter.waiterId,
      work: { kind: 'flow.timeout', flowId: 'flow_1' as FlowId, suspendPoint: 'approval' },
    })
    await store.waiters.attachTimer(waiter.waiterId, timer.timerId)

    const waitersByWork = await store.waiters.listByWork(
      'work_flow_1' as WorkId,
    )
    expect(waitersByWork).toHaveLength(2)
    expect(waitersByWork).toEqual(expect.arrayContaining([
      expect.objectContaining({
        waiterId: waiter.waiterId,
        timerId: timer.timerId,
      }),
      expect.objectContaining({ namespace: 'tenant-b' }),
    ]))
    await expect(
      store.timers.listByWork('work_flow_1' as WorkId),
    ).resolves.toEqual([
      expect.objectContaining({
        timerId: timer.timerId,
        waiterId: waiter.waiterId,
      }),
    ])
    await expect(
      store.waiters.claimExpired({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:09.999Z'),
      }),
    ).resolves.toEqual([])
    await expect(
      store.waiters.claimExpired({
        namespace: 'tenant-a',
        now: dueAt,
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        waiterId: waiter.waiterId,
        timerId: timer.timerId,
      }),
    ])
    await store.waiters.transition(waiter.waiterId, 'armed', 'timed-out')
    await expect(
      store.waiters.claimExpired({ namespace: 'tenant-a', now: dueAt }),
    ).resolves.toEqual([])
  })

  it('invariant: leases exclude concurrent owners and expire cleanly', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const store = await options.createStore()

      const first = await store.leases.claim('work:work_1', {
        ttlMs: 1_000,
        ownerId: 'worker-a',
      })
      expect(first).toMatchObject({ resource: 'work:work_1' })
      await expect(
        store.leases.claim('work:work_1', { ttlMs: 1_000 }),
      ).resolves.toBeNull()

      const extended = await store.leases.extend(first!, 2_000)
      vi.advanceTimersByTime(1_500)
      await expect(
        store.leases.claim('work:work_1', { ttlMs: 1_000 }),
      ).resolves.toBeNull()

      vi.advanceTimersByTime(501)
      const reclaimed = await store.leases.claim('work:work_1', {
        ttlMs: 1_000,
      })
      expect(reclaimed?.token).not.toBe(extended.token)
      await store.leases.release(reclaimed!)
      await expect(
        store.leases.claim('work:work_1', { ttlMs: 1_000 }),
      ).resolves.toMatchObject({ resource: 'work:work_1' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('invariant: timers and outbox delivery are due-time gated and deduplicated', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const store = await options.createStore()
      const work = makeConformanceWorkItem()
      const dueAt = new Date('2026-07-02T00:00:10.000Z')

      const timer = await store.timers.put({
        namespace: 'tenant-a',
        fireAt: dueAt,
        workId: work.workId,
        work: work.work,
      })
      await expect(
        store.timers.claimDue({
          namespace: 'tenant-a',
          now: new Date('2026-07-02T00:00:09.999Z'),
        }),
      ).resolves.toEqual([])
      await expect(
        store.timers.claimDue({ namespace: 'tenant-a', now: dueAt }),
      ).resolves.toEqual([
        expect.objectContaining({
          timerId: timer.timerId,
          workId: work.workId,
        }),
      ])
      await expect(
        store.timers.transition(timer.timerId, 'scheduled', 'fired'),
      ).resolves.toBe(true)
      await expect(
        store.timers.transition(timer.timerId, 'scheduled', 'cancelled'),
      ).resolves.toBe(false)

      await store.outbox.put(
        makeConformanceWakeEnvelope(
          makeConformanceWorkItem({
            namespace: 'tenant-b',
            workId: work.workId,
            idempotencyKey: 'task:tenant-b-collision',
          }),
        ),
        { deliverAt: dueAt },
      )
      const delayedOutbox = await store.outbox.put(
        makeConformanceWakeEnvelope(work),
        { deliverAt: dueAt },
      )
      await store.outbox.put(
        makeConformanceWakeEnvelope(
          makeConformanceWorkItem({ workId: 'work_other_1' as WorkId }),
        ),
        { deliverAt: dueAt },
      )
      await expect(
        store.outbox.listByWork(work.workId, {
          namespace: 'tenant-a',
          state: 'pending',
          limit: 1,
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          outboxId: delayedOutbox.outboxId,
          envelope: expect.objectContaining({ workId: work.workId }),
        }),
      ])
      await expect(
        store.outbox.claimPending({
          namespace: 'tenant-a',
          now: new Date('2026-07-02T00:00:09.999Z'),
          limit: 1,
        }),
      ).resolves.toEqual([])
      await expect(
        store.outbox.claimPending({
          namespace: 'tenant-a',
          now: dueAt,
          limit: 1,
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          outboxId: delayedOutbox.outboxId,
          nextAttemptAt: dueAt,
          attempts: 1,
        }),
      ])
      await store.outbox.confirm(delayedOutbox.outboxId)

      const outbox = await store.outbox.put(makeConformanceWakeEnvelope(work))
      await expect(
        store.outbox.claimPending({
          namespace: 'tenant-a',
          now: new Date(),
          limit: 1,
        }),
      ).resolves.toEqual([
        expect.objectContaining({ outboxId: outbox.outboxId, attempts: 1 }),
      ])
      await store.outbox.confirm(outbox.outboxId)

      const dedupeEnvelope = makeConformanceWakeEnvelope(
        makeConformanceWorkItem({
          workId: 'work_dedupe_1' as WorkId,
          idempotencyKey: 'task:work_dedupe_1',
        }),
      )
      const firstDedupe = await store.outbox.put(dedupeEnvelope, {
        deliverAt: dueAt,
      })
      await expect(
        store.outbox.put(dedupeEnvelope, { deliverAt: dueAt }),
      ).resolves.toMatchObject({ outboxId: firstDedupe.outboxId })
      await expect(
        store.outbox.claimPending({ namespace: 'tenant-a', now: dueAt, limit: 1 }),
      ).resolves.toEqual([
        expect.objectContaining({ outboxId: firstDedupe.outboxId }),
      ])
      const requeuedWhileDispatched = await store.outbox.put(dedupeEnvelope, {
        deliverAt: dueAt,
      })
      expect(requeuedWhileDispatched.outboxId).not.toBe(firstDedupe.outboxId)
      await store.outbox.confirm(firstDedupe.outboxId)
      await expect(
        store.outbox.claimPending({ namespace: 'tenant-a', now: dueAt, limit: 2 }),
      ).resolves.toEqual([
        expect.objectContaining({ outboxId: requeuedWhileDispatched.outboxId }),
      ])
      await store.outbox.confirm(requeuedWhileDispatched.outboxId)
    } finally {
      vi.useRealTimers()
    }
  })

  it.skipIf(options.substrateAtomicTransact)(
    'excluded: outbox confirm crash redelivery requires adapter fault injection (substrate-atomic transact)',
    async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
        const store = await options.createStore()
        const work = makeConformanceWorkItem()
        const outbox = await store.outbox.put(makeConformanceWakeEnvelope(work))
        await expect(
          store.outbox.claimPending({
            namespace: 'tenant-a',
            now: new Date(),
            limit: 1,
          }),
        ).resolves.toEqual([
          expect.objectContaining({ outboxId: outbox.outboxId, attempts: 1 }),
        ])
        requireFaultHook(
          options.crashBeforeOutboxConfirm,
          'crashBeforeOutboxConfirm',
        )(store)
        await expect(store.outbox.confirm(outbox.outboxId)).rejects.toThrow(
          'Injected outbox confirm crash',
        )
        await expect(
          store.outbox.claimPending({
            namespace: 'tenant-a',
            now: new Date(),
            limit: 1,
          }),
        ).resolves.toEqual([
          expect.objectContaining({ outboxId: outbox.outboxId, attempts: 2 }),
        ])
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it.skipIf(options.substrateAtomicTransact)(
    'excluded: transaction rollback fault injection is replaced by substrate rollback proof (substrate-atomic transact)',
    async () => {
      const store = await options.createStore()
      const work = makeConformanceWorkItem()
      requireFaultHook(options.failAfterWrites, 'failAfterWrites')(store, 1)
      await expect(
        store.transact(async (tx) => {
          await tx.state.putWork(work)
          await tx.events.append({
            namespace: 'tenant-a',
            name: 'work.created',
            payload: { workId: work.workId },
          })
        }),
      ).rejects.toThrow('Injected transaction failure')
      await expect(
        store.state.getWork(work.workId, { namespace: 'tenant-a' }),
      ).resolves.toBeNull()
      await expect(
        store.events.read({ namespace: 'tenant-a' }),
      ).resolves.toMatchObject({ events: [] })
    },
  )

  it.skipIf(!options.assertSerializedTransactions)(
    'invariant: transactions serialize through one async mutex',
    async () => {
      const store = await options.createStore()
      const order: string[] = []
      let releaseFirst: (() => void) | undefined
      let first: Promise<void>
      const firstReady = new Promise<void>((resolve) => {
        first = store.transact(async () => {
          order.push('first-start')
          resolve()
          await new Promise<void>((release) => {
            releaseFirst = release
          })
          order.push('first-end')
        })
      })
      await firstReady
      const second = store.transact(async () => {
        order.push('second-start')
      })
      await Promise.resolve()
      expect(order).toEqual(['first-start'])
      releaseFirst?.()
      await Promise.all([first!, second])
      expect(order).toEqual(['first-start', 'first-end', 'second-start'])
    },
  )
}

function requireFaultHook<TStore extends RuntimeStoreAdapter, TArgs extends unknown[]>(
  hook: ((store: TStore, ...args: TArgs) => void) | undefined,
  name: string,
): (store: TStore, ...args: TArgs) => void {
  if (hook) return hook
  throw new Error(`Runtime store conformance requires ${name} unless substrateAtomicTransact is declared.`)
}
