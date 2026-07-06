/**
 * Kernel-owned runtime maintenance pass.
 *
 * Maintenance centralizes recovery policies that must stay identical across
 * adapters: outbox backstop dispatch, store-backed timer firing, and reclaiming
 * work whose worker lease expired without treating it as a failed attempt.
 *
 * @module
 */

import type { RuntimeStoreAdapter, RuntimeStoreTransaction } from '../store'
import { dispatchBatch } from './outbox'
import { timerKey, waiterTimeoutKey } from './idempotency'
import { targetIdForNewWork, wakeEnvelopeForWork } from './kernel-shared'
import type {
  MaintenanceTickOptions,
  MaintenanceTickResult,
} from './kernel-types'
import { pruneRetainedRecords } from './maintenance-retention'
import { scanTimers, type KernelTimerDeps } from './kernel-timers'
import { transition, type WorkItem } from './work'
import type { RuntimeWaiter } from '../ports/waiters'
import type { ResolvedRuntimeRetentionConfig } from './retention'

/** Dependencies for runtime maintenance. */
export interface KernelMaintenanceDeps extends KernelTimerDeps {
  /** Lease TTL in milliseconds. */
  readonly leaseTtlMs: number
  /** Resolved retention policy for terminal runtime records. */
  readonly retention: ResolvedRuntimeRetentionConfig
}

/** Run one kernel-owned maintenance pass. */
export async function maintenanceTick(
  deps: KernelMaintenanceDeps,
  options: MaintenanceTickOptions = {},
): Promise<MaintenanceTickResult> {
  const now = options.now ?? deps.now()
  const outbox = options.deliver
    ? await dispatchBatch({
        store: deps.store,
        deliver: options.deliver,
        namespace: options.namespace,
        now: () => now,
      })
    : { delivered: 0, failed: 0 }
  const timers = await scanTimers(deps, {
    namespace: options.namespace,
    now,
    limit: options.timerLimit,
  })
  const leasesReclaimed = await reclaimExpiredLeases(deps, {
    namespace: options.namespace,
    limit: options.workLimit,
  })
  const waitersExpired = await expireWaiters(deps, {
    namespace: options.namespace,
    now,
    limit: options.waiterLimit,
  })
  const pendingRequeued = await requeueOrphanedPendingWork(deps, {
    namespace: options.namespace,
    now,
    limit: options.workLimit,
  })
  const retention = await pruneRetainedRecords(deps, {
    namespace: options.namespace,
    now,
  })

  return {
    outboxDelivered: outbox.delivered,
    outboxFailed: outbox.failed,
    timersFired: timers.fired,
    timersSkipped: timers.skipped,
    leasesReclaimed,
    waitersExpired,
    pendingRequeued,
    retainedRecordsRemoved: retention.removed,
    retentionTruncated: retention.truncated,
  }
}

async function reclaimExpiredLeases(
  deps: Pick<KernelMaintenanceDeps, 'store' | 'leaseTtlMs'>,
  options: {
    readonly namespace?: string
    readonly limit?: number
  },
): Promise<number> {
  if (!options.namespace) return 0
  const leased = await deps.store.state.listWork({
    namespace: options.namespace,
    status: 'leased',
    limit: options.limit,
  })
  let reclaimedCount = 0
  for (const work of leased) {
    const lease = await deps.store.leases.claim(`work:${work.workId}`, {
      ttlMs: deps.leaseTtlMs,
    })
    if (!lease) continue
    try {
      if (await reclaimLeasedWork(deps.store, work)) {
        reclaimedCount += 1
      }
    } finally {
      await deps.store.leases.release(lease)
    }
  }
  return reclaimedCount
}

async function reclaimLeasedWork(
  store: RuntimeStoreAdapter,
  work: WorkItem,
): Promise<boolean> {
  return await store.transact(async (tx) => {
    const current = await tx.state.getWork(work.workId, {
      namespace: work.namespace,
    })
    if (!current || current.status !== 'leased') return false
    const pending = transition(current, { status: 'pending' })
    await tx.state.putWork(pending)
    await tx.outbox.put(wakeEnvelopeForWork(pending))
    return true
  })
}

async function requeueOrphanedPendingWork(
  deps: Pick<KernelMaintenanceDeps, 'store'>,
  options: {
    readonly namespace?: string
    readonly now: Date
    readonly limit?: number
  },
): Promise<number> {
  if (!options.namespace) return 0
  const pending = await deps.store.state.listWork({
    namespace: options.namespace,
    status: 'pending',
    updatedBefore: options.now,
    limit: options.limit,
  })
  let requeued = 0
  for (const work of pending) {
    if (work.notBefore && work.notBefore.getTime() > options.now.getTime()) {
      continue
    }
    if (await requeuePendingWorkIfStillOrphaned(deps.store, work)) {
      requeued += 1
    }
  }
  return requeued
}

async function requeuePendingWorkIfStillOrphaned(
  store: RuntimeStoreAdapter,
  work: WorkItem,
): Promise<boolean> {
  return await store.transact(async (tx) => {
    const current = await tx.state.getWork(work.workId, {
      namespace: work.namespace,
    })
    if (!current || current.status !== 'pending') return false
    const before = await tx.outbox.list({
      namespace: current.namespace,
      state: 'pending',
      limit: 1_000,
    })
    const hasPendingWake = before.some(
      (item) =>
        item.envelope.workId === current.workId &&
        item.envelope.idempotencyKey === current.idempotencyKey,
    )
    if (hasPendingWake) return false
    await tx.outbox.put(wakeEnvelopeForWork(current), {
      deliverAt: current.notBefore ?? current.updatedAt,
    })
    return true
  })
}

async function expireWaiters(
  deps: Pick<KernelMaintenanceDeps, 'store' | 'newWorkId' | 'now'>,
  options: {
    readonly namespace?: string
    readonly now: Date
    readonly limit?: number
  },
): Promise<number> {
  const expired = await deps.store.waiters.claimExpired({
    namespace: options.namespace,
    now: options.now,
    limit: options.limit,
  })

  return await deps.store.transact(async (tx) => {
    let expiredCount = 0
    for (const waiter of expired) {
      const producedWork = await expireWaiterInTransaction({
        tx,
        deps,
        waiter,
      })
      if (producedWork) expiredCount += 1
    }
    return expiredCount
  })
}

async function expireWaiterInTransaction(options: {
  readonly tx: RuntimeStoreTransaction
  readonly deps: Pick<KernelMaintenanceDeps, 'newWorkId' | 'now'>
  readonly waiter: RuntimeWaiter
}): Promise<boolean> {
  const won = await options.tx.waiters.transition(
    options.waiter.waiterId,
    'armed',
    'timed-out',
  )
  if (!won) return false

  const idempotencyKey = options.waiter.timerId
    ? timerKey(options.waiter.timerId)
    : waiterTimeoutKey(options.waiter.waiterId)
  const work = options.waiter.workId
    ? await options.tx.state.setWorkPending(options.waiter.workId, {
        namespace: options.waiter.namespace,
        work: options.waiter.work,
        idempotencyKey,
      })
    : await options.tx.state.createWork({
        workId: options.deps.newWorkId(),
        namespace: options.waiter.namespace,
        work: options.waiter.work,
        targetId: targetIdForNewWork(options.waiter.work),
        idempotencyKey,
        now: options.deps.now(),
      })

  if (!work) return false
  await options.tx.outbox.put(wakeEnvelopeForWork(work))
  return true
}
