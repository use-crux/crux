import { expect } from 'vitest'
import type { FlowSnapshot, RuntimeTargetId, WorkId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import { makeConformanceWorkItem } from './store-fixtures'
import {
  FLOW_ID,
  LATER,
  LEASE_TOKEN,
  NAMESPACE,
  NOW,
  TARGET_ID,
  TASK_ID,
  leasedWork,
  runComposite,
  type StoreCompositeRollbackCase,
} from './store-composite-case-utils'

export function workflowCompositeRollbackCases(): StoreCompositeRollbackCase[] {
  return [
    taskEnqueueCase(),
    wakeBlockMissingTargetCase(),
    wakeRetryCase(),
    wakeFailCase(),
    wakeCompleteCase(),
    suspensionRecordCase(),
    eventEmitCase(),
  ]
}

function taskEnqueueCase(): StoreCompositeRollbackCase {
  return {
    kind: 'task.enqueue',
    writesBeforeFailure: 1,
    run: (store) =>
      runComposite(store, 'task.enqueue', {
        namespace: NAMESPACE,
        taskId: TASK_ID,
        targetId: TARGET_ID,
      }).then(() => undefined),
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork('work_child_1' as WorkId, { namespace: NAMESPACE }),
      ).resolves.toBeNull()
      await expect(
        store.outbox.list({ namespace: NAMESPACE, state: 'pending' }),
      ).resolves.toEqual([])
    },
  }
}

function wakeBlockMissingTargetCase(): StoreCompositeRollbackCase {
  const work = makeConformanceWorkItem()
  return {
    kind: 'wake.block-missing-target',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
    },
    run: async (store) => {
      await runComposite(store, 'wake.block-missing-target', {
        envelope: {
          v: 1,
          ns: work.namespace,
          workId: work.workId,
          target: 'missing' as RuntimeTargetId,
          kind: work.work.kind,
          idempotencyKey: work.idempotencyKey,
          attempt: work.attempt,
        },
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'pending' })
      await expect(
        store.state.hasIdempotencyKey(work.namespace, work.idempotencyKey),
      ).resolves.toBe(false)
    },
  }
}

function wakeRetryCase(): StoreCompositeRollbackCase {
  const work = leasedWork()
  const snapshot: FlowSnapshot = {
    flowId: FLOW_ID,
    workId: work.workId,
    targetId: work.targetId,
    namespace: work.namespace,
    status: 'suspended',
    input: {},
    continuation: { segment: 'before-retry' },
    completedSteps: {},
    fingerprint: [],
    pendingSuspends: [],
    updatedAt: NOW,
  }
  return {
    kind: 'wake.retry',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
      await store.state.putSnapshot(snapshot)
    },
    run: async (store) => {
      await runComposite(store, 'wake.retry', {
        work,
        leaseToken: LEASE_TOKEN,
        retryAt: LATER,
        retrySnapshot: {
          ...snapshot,
          continuation: { segment: 'after-retry' },
          updatedAt: LATER,
        },
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'leased', leaseToken: LEASE_TOKEN })
      await expect(
        store.outbox.list({ namespace: work.namespace, state: 'pending' }),
      ).resolves.toEqual([])
      await expect(
        store.state.getSnapshot(FLOW_ID, { namespace: work.namespace }),
      ).resolves.toMatchObject({
        continuation: { segment: 'before-retry' },
      })
    },
  }
}

function wakeFailCase(): StoreCompositeRollbackCase {
  const work = leasedWork({ idleScope: 'flow:rollback' })
  return {
    kind: 'wake.fail',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.createWork({
        workId: work.workId,
        namespace: work.namespace,
        work: work.work,
        targetId: work.targetId,
        idempotencyKey: work.idempotencyKey,
        idleScope: work.idleScope,
        now: NOW,
      })
      await store.state.putWork(work)
    },
    run: async (store) => {
      await runComposite(store, 'wake.fail', {
        work,
        leaseToken: LEASE_TOKEN,
        failure: { kind: 'dead-letter', message: 'boom' },
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'leased' })
      await expect(
        store.state.getIdleCount(work.namespace, work.idleScope!),
      ).resolves.toBe(1)
    },
  }
}

function wakeCompleteCase(): StoreCompositeRollbackCase {
  const work = leasedWork()
  return {
    kind: 'wake.complete',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
    },
    run: async (store) => {
      await runComposite(store, 'wake.complete', {
        work,
        leaseToken: LEASE_TOKEN,
        outcome: { status: 'completed' },
        idempotencyKey: work.idempotencyKey,
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'leased' })
      await expect(
        store.state.hasIdempotencyKey(work.namespace, work.idempotencyKey),
      ).resolves.toBe(false)
    },
  }
}

function suspensionRecordCase(): StoreCompositeRollbackCase {
  const work = leasedWork()
  return {
    kind: 'suspension.record',
    writesBeforeFailure: 1,
    prepare: async (store) => {
      await store.state.putWork(work)
    },
    run: async (store) => {
      await runComposite(store, 'suspension.record', {
        namespace: work.namespace,
        workId: work.workId,
        flowId: FLOW_ID,
        targetId: work.targetId,
        snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
        suspends: [{ label: 'approval', eventName: 'approved', match: {} }],
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'leased' })
      await expect(
        store.state.getSnapshot(FLOW_ID, { namespace: work.namespace }),
      ).resolves.toBeNull()
    },
  }
}

function eventEmitCase(): StoreCompositeRollbackCase {
  const work = makeConformanceWorkItem({ status: 'suspended' })
  return {
    kind: 'event.emit',
    writesBeforeFailure: 1,
    prepare: async (store: RuntimeStoreAdapter) => {
      await store.state.putWork(work)
      const waiter = await store.waiters.register({
        namespace: work.namespace,
        eventName: 'approved',
        match: {},
        workId: work.workId,
        work: { kind: 'flow.resume', flowId: FLOW_ID },
      })
      await store.state.putSnapshot({
        flowId: FLOW_ID,
        workId: work.workId,
        targetId: work.targetId,
        namespace: work.namespace,
        status: 'suspended',
        input: {},
        completedSteps: {},
        fingerprint: [],
        pendingSuspends: [{ label: 'approval', waiterId: waiter.waiterId }],
        updatedAt: NOW,
      })
    },
    run: async (store) => {
      await runComposite(store, 'event.emit', {
        namespace: work.namespace,
        name: 'approved',
        payload: {},
      })
    },
    verifyRollback: async (store) => {
      await expect(
        store.events.read({ namespace: work.namespace }),
      ).resolves.toMatchObject({ events: [] })
      await expect(
        store.state.getWork(work.workId, { namespace: work.namespace }),
      ).resolves.toMatchObject({ status: 'suspended' })
    },
  }
}
