/**
 * Lease fencing and heartbeat helpers for wake execution.
 *
 * The kernel owns lease correctness. Adapters only store lease records; every
 * finalizing commit must prove it still owns the work row before it writes.
 *
 * @module
 */

import type { Lease, LeaseToken } from '../ports'
import type { RuntimeStoreAdapter, RuntimeStoreTransaction } from '../store'
import { CruxRuntimeError, createRuntimeError } from './errors'
import type { RuntimeLeaseExtensionOptions } from './kernel-types'
import type { WorkItem } from './work'

/** Scheduler used by the lease heartbeat. */
export type LeaseExtensionSchedule = NonNullable<
  RuntimeLeaseExtensionOptions['schedule']
>

/** Stop handle returned by {@link startLeaseExtensionHeartbeat}. */
export interface LeaseExtensionHeartbeat {
  /** Stop future lease extension attempts. */
  stop(): void
}

/** Verify the active transaction still owns a work item's lease token. */
export async function assertLeaseHeldInTransaction(
  tx: RuntimeStoreTransaction,
  work: WorkItem,
  leaseToken: LeaseToken,
): Promise<WorkItem> {
  const current = await tx.state.getWork(work.workId, {
    namespace: work.namespace,
  })
  if (
    !current ||
    current.status !== 'leased' ||
    current.leaseToken !== leaseToken
  ) {
    throw leaseLostError(work)
  }
  return current
}

/** Return whether an unknown error is the dedicated stale-lease diagnostic. */
export function isLeaseLostError(error: unknown): error is CruxRuntimeError {
  return error instanceof CruxRuntimeError && error.code === 'LEASE_LOST'
}

/** Start the best-effort heartbeat that keeps a long-running lease fresh. */
export function startLeaseExtensionHeartbeat(
  options: {
    readonly store: RuntimeStoreAdapter
    readonly leaseTtlMs: number
    readonly leaseExtension?: false | RuntimeLeaseExtensionOptions
  },
  initialLease: Lease,
  onExtended: (lease: Lease) => void,
): LeaseExtensionHeartbeat {
  if (options.leaseExtension === false) return NOOP_HEARTBEAT

  const intervalMs =
    options.leaseExtension?.intervalMs ??
    Math.max(1, Math.floor(options.leaseTtlMs / 3))
  const schedule = options.leaseExtension?.schedule ?? defaultSchedule
  let activeLease = initialLease
  let stopped = false
  let extending = false
  let loggedFailure = false

  const stop = schedule(() => {
    if (stopped || extending) return
    extending = true
    void options.store.leases
      .extend(activeLease, options.leaseTtlMs)
      .then((extended) => {
        activeLease = extended
        onExtended(extended)
      })
      .catch((error: unknown) => {
        if (loggedFailure) return
        loggedFailure = true
        logLeaseExtensionFailure(error)
      })
      .finally(() => {
        extending = false
      })
  }, intervalMs)

  return Object.freeze({
    stop() {
      stopped = true
      stop()
    },
  })
}

function leaseLostError(work: WorkItem): CruxRuntimeError {
  return createRuntimeError({
    code: 'LEASE_LOST',
    whatFailed: `Runtime work \`${work.workId}\` lost its lease before commit.`,
    why: 'Another worker reclaimed or replaced the lease before this executor reached its durable commit.',
    whatStillWorks:
      'The winning worker can continue. This stale executor exits without retrying, dead-lettering, or overwriting the new owner.',
    nextStep:
      'No action is needed for occasional races. For consistently long work, increase leaseTtlMs or enable the lease heartbeat where the host supports timers.',
  })
}

const NOOP_HEARTBEAT: LeaseExtensionHeartbeat = Object.freeze({
  stop() {},
})

function defaultSchedule(fn: () => void, intervalMs: number): () => void {
  const timer = setInterval(fn, intervalMs)
  const maybeUnref = timer as { unref?: () => void }
  maybeUnref.unref?.()
  return () => clearInterval(timer)
}

function logLeaseExtensionFailure(error: unknown): void {
  if (typeof console === 'undefined') return
  console.warn(
    '[crux] Runtime Engine lease heartbeat failed; lease fencing will prevent stale commits.',
    error,
  )
}
