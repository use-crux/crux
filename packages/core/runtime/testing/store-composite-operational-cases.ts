import { expect } from 'vitest'
import type { RuntimeWaiter } from '../ports/waiters'
import type { RuntimeTimerRecord } from '../store'
import { makeConformanceWorkItem } from './store-fixtures'
import {
  FLOW_ID,
  LATER,
  NAMESPACE,
  TARGET_ID,
  TASK_ID,
  leasedWork,
  runComposite,
  type StoreCompositeRollbackCase,
} from './store-composite-case-utils'

export function operationalCompositeRollbackCases(): StoreCompositeRollbackCase[] {
  return [
    timersFireDueCase(),
    workCancelCase(),
    operatorRetryCase(),
    maintenanceReclaimLeaseCase(),
    maintenanceRequeueOrphanCase(),
    maintenanceExpireWaitersCase(),
  ]
}

function timersFireDueCase(): StoreCompositeRollbackCase {
  let timer: RuntimeTimerRecord | undefined
  return {
    kind: 'timers.fire-due',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      timer = await store.timers.put({
        namespace: NAMESPACE,
        fireAt: LATER,
        work: {
          kind: 'task.run',
          taskId: TASK_ID,
          targetId: TARGET_ID,
        },
      })
    },
    run: async (store) => {
      if (!timer) throw new Error('Expected timer fixture to be prepared.')
      await runComposite(store, 'timers.fire-due', { timers: [timer] })
    },
    verifyRollback: async (store) => {
      const timers = await store.timers.list({
        namespace: NAMESPACE,
        state: 'scheduled',
      })
      expect(timers).toHaveLength(1)
      await expect(
        store.outbox.list({ namespace: NAMESPACE, state: 'pending' }),
      ).resolves.toEqual([])
    },
  }
}

function workCancelCase(): StoreCompositeRollbackCase {
  const work = makeConformanceWorkItem()
  return {
    kind: 'work.cancel',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
      await store.waiters.register({
        namespace: work.namespace,
        eventName: 'approved',
        match: {},
        workId: work.workId,
        work: { kind: 'flow.resume', flowId: FLOW_ID },
      })
    },
    run: async (store) => {
      await runComposite(store, 'work.cancel', {
        namespace: work.namespace,
        workId: work.workId,
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'pending' })
      const waiters = await store.waiters.listByWork(work.workId)
      expect(waiters).toEqual([expect.objectContaining({ state: 'armed' })])
    },
  }
}

function operatorRetryCase(): StoreCompositeRollbackCase {
  const work = makeConformanceWorkItem({ status: 'blocked' })
  return {
    kind: 'work.operator-retry',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
    },
    run: async (store) => {
      await runComposite(store, 'work.operator-retry', {
        namespace: work.namespace,
        workId: work.workId,
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'blocked' })
      await expect(
        store.events.read({ namespace: work.namespace }),
      ).resolves.toMatchObject({ events: [] })
    },
  }
}

function maintenanceReclaimLeaseCase(): StoreCompositeRollbackCase {
  const work = leasedWork()
  return {
    kind: 'maintenance.reclaim-lease',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
    },
    run: async (store) => {
      await runComposite(store, 'maintenance.reclaim-lease', { work })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'leased' })
      await expect(
        store.outbox.list({ namespace: work.namespace, state: 'pending' }),
      ).resolves.toEqual([])
    },
  }
}

function maintenanceRequeueOrphanCase(): StoreCompositeRollbackCase {
  const work = makeConformanceWorkItem()
  return {
    kind: 'maintenance.requeue-orphan',
    writesBeforeFailure: 0,
    prepare: async (store) => {
      await store.state.putWork(work)
    },
    run: async (store) => {
      await runComposite(store, 'maintenance.requeue-orphan', { work })
    },
    verifyRollback: async (store) => {
      await expect(
        store.outbox.list({ namespace: work.namespace, state: 'pending' }),
      ).resolves.toEqual([])
    },
  }
}

function maintenanceExpireWaitersCase(): StoreCompositeRollbackCase {
  let waiter: RuntimeWaiter | undefined
  return {
    kind: 'maintenance.expire-waiters',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      waiter = await store.waiters.register({
        namespace: NAMESPACE,
        eventName: 'approved',
        match: {},
        work: {
          kind: 'task.run',
          taskId: TASK_ID,
          targetId: TARGET_ID,
        },
        timeoutAt: LATER,
      })
    },
    run: async (store) => {
      if (!waiter) throw new Error('Expected waiter fixture to be prepared.')
      await runComposite(store, 'maintenance.expire-waiters', {
        waiters: [waiter],
      })
    },
    verifyRollback: async (store) => {
      const expired = await store.waiters.claimExpired({
        namespace: NAMESPACE,
        now: LATER,
      })
      expect(expired).toEqual([expect.objectContaining({ state: 'armed' })])
      await expect(
        store.outbox.list({ namespace: NAMESPACE, state: 'pending' }),
      ).resolves.toEqual([])
    },
  }
}
