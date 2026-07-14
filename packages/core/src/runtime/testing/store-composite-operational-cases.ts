import { expect } from 'vitest'
import type { RuntimeWaiter } from '../ports/waiters'
import type { RuntimeTimerRecord } from '../store'
import type { RuntimeDeferredIntent } from '../ports/deferred'
import type { DeferredIntentId, DeferredScopeId } from '../ports/ids'
import { makeConformanceWorkItem } from './store-fixtures'
import {
  FLOW_ID,
  LATER,
  LEASE_TOKEN,
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
    deferStageCase(),
    deferFinalizeCase(),
  ]
}

function deferStageCase(): StoreCompositeRollbackCase {
  const scopeId = 'defer_scope_conformance_stage' as DeferredScopeId
  const intentId = 'defer_intent_conformance_stage' as DeferredIntentId
  return {
    kind: 'defer.stage',
    writesBeforeFailure: 1,
    run: async (store) => {
      await runComposite(store, 'defer.stage', {
        namespace: NAMESPACE,
        scopeId,
        intentId,
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: LATER,
        targetId: TARGET_ID,
        input: { documentId: 'doc_1' },
      })
    },
    verifyRollback: async (store) => {
      await expect(store.deferred.getScope(scopeId, { namespace: NAMESPACE })).resolves.toBeNull()
      await expect(store.deferred.getIntent(intentId, { namespace: NAMESPACE })).resolves.toBeNull()
    },
  }
}

function deferFinalizeCase(): StoreCompositeRollbackCase {
  const scopeId = 'defer_scope_conformance_finalize' as DeferredScopeId
  const intentId = 'defer_intent_conformance_finalize' as DeferredIntentId
  let intent: RuntimeDeferredIntent | undefined
  return {
    kind: 'defer.finalize',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      intent = await runComposite(store, 'defer.stage', {
        namespace: NAMESPACE,
        scopeId,
        intentId,
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: LATER,
        targetId: TARGET_ID,
        input: { documentId: 'doc_1' },
      })
    },
    run: async (store) => {
      await runComposite(store, 'defer.finalize', {
        namespace: NAMESPACE,
        scopeId,
        leaseToken: LEASE_TOKEN,
        outcome: 'success',
      })
    },
    verifyRollback: async (store) => {
      if (!intent) throw new Error('Expected deferred intent fixture.')
      await expect(store.deferred.getScope(scopeId, { namespace: NAMESPACE })).resolves.toMatchObject({
        finalization: { state: 'open' },
      })
      await expect(store.deferred.getIntent(intentId, { namespace: NAMESPACE })).resolves.toMatchObject({
        state: 'staged',
      })
      await expect(store.state.getWork(intent.workId, { namespace: NAMESPACE })).resolves.toBeNull()
      await expect(store.outbox.list({ namespace: NAMESPACE, state: 'pending' })).resolves.toEqual([])
    },
  }
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
      await expect(store.outbox.list({ namespace: NAMESPACE, state: 'pending' })).resolves.toEqual([])
    },
  }
}

function workCancelCase(): StoreCompositeRollbackCase {
  const work = makeConformanceWorkItem({
    work: { kind: 'flow.resume', flowId: FLOW_ID },
  })
  return {
    kind: 'work.cancel',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
      await store.state.putSnapshot({
        flowId: FLOW_ID,
        workId: work.workId,
        targetId: work.targetId,
        namespace: work.namespace,
        status: 'suspended',
        input: {},
        completedSteps: {},
        fingerprint: [],
        pendingSuspends: [],
        updatedAt: LATER,
      })
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
    verifySuccess: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'cancelled' })
      await expect(
        store.state.getSnapshot(FLOW_ID, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'cancelled' })
    },
    verifyRollback: async (store) => {
      await expect(store.state.getWork(work.workId, { namespace: work.namespace })).resolves.toMatchObject({
        status: 'pending',
      })
      await expect(
        store.state.getSnapshot(FLOW_ID, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'suspended' })
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
      await expect(store.state.getWork(work.workId, { namespace: work.namespace })).resolves.toMatchObject({
        status: 'blocked',
      })
      await expect(store.events.read({ namespace: work.namespace })).resolves.toMatchObject({ events: [] })
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
      await expect(store.state.getWork(work.workId, { namespace: work.namespace })).resolves.toMatchObject({
        status: 'leased',
      })
      await expect(store.outbox.list({ namespace: work.namespace, state: 'pending' })).resolves.toEqual([])
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
      await expect(store.outbox.list({ namespace: work.namespace, state: 'pending' })).resolves.toEqual([])
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
      await expect(store.outbox.list({ namespace: NAMESPACE, state: 'pending' })).resolves.toEqual([])
    },
  }
}
