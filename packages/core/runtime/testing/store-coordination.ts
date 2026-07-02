import { expect, it, vi } from 'vitest'
import type { FlowId } from '../ports'
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
      work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
    })
    await store.waiters.register({
      namespace: 'tenant-b',
      eventName: 'document.approved',
      match: { documentId: 'doc_1' },
      work: { kind: 'flow.resume', flowId: 'flow_2' as FlowId },
    })

    await expect(
      store.waiters.resolve('document.approved', { documentId: 'doc_1' }, {
        namespace: 'tenant-a',
      }),
    ).resolves.toEqual([expect.objectContaining({ waiterId: waiter.waiterId })])

    await expect(
      Promise.all([
        store.waiters.transition(waiter.waiterId, 'armed', 'fired'),
        store.waiters.transition(waiter.waiterId, 'armed', 'timed-out'),
      ]),
    ).resolves.toEqual([true, false])
    await expect(
      store.waiters.resolve('document.approved', { documentId: 'doc_1' }, {
        namespace: 'tenant-a',
      }),
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

  it('invariant: timers, outbox, and transactions recover from crashes', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const store = await options.createStore()
      const work = makeConformanceWorkItem()
      const dueAt = new Date('2026-07-02T00:00:10.000Z')

      const timer = await store.timers.put({
        namespace: 'tenant-a',
        fireAt: dueAt,
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
      ).resolves.toEqual([expect.objectContaining({ timerId: timer.timerId })])
      await expect(
        store.timers.transition(timer.timerId, 'scheduled', 'fired'),
      ).resolves.toBe(true)
      await expect(
        store.timers.transition(timer.timerId, 'scheduled', 'cancelled'),
      ).resolves.toBe(false)

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
      options.crashBeforeOutboxConfirm(store)
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
      await store.outbox.confirm(outbox.outboxId)

      options.failAfterWrites(store, 1)
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
    } finally {
      vi.useRealTimers()
    }
  })

  it('invariant: transactions serialize through one async mutex', async () => {
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
  })
}
