/**
 * Wake handling composite for the Runtime Engine kernel.
 *
 * @module
 */

import type { Lease } from '../ports/leases'
import type { WorkId } from '../ports/ids'
import type { RuntimeStoreAdapter } from '../store'
import type { WakeEnvelope } from './envelope'
import type {
  RuntimeKernelOptions,
  RuntimeTargetMap,
  RuntimeTargetOutcome,
  RuntimeWakeResult,
} from './kernel-types'
import { recordSuspensionInTransaction } from './kernel-events'
import {
  isTerminalWork,
  runtimeErrorMessage,
  targetNotFoundError,
  wakeEnvelopeForWork,
} from './kernel-shared'
import { putWorkWithIdleAccounting } from './kernel-idle'
import { classifyRuntimeFailure } from './retry'
import { transition, type WorkItem } from './work'

/** Dependencies for wake handling. */
export interface HandleWakeDeps {
  /** Durable runtime store. */
  readonly store: RuntimeStoreAdapter
  /** Runtime target registry. */
  readonly targets: RuntimeTargetMap
  /** Wake verifier. */
  readonly verifyWake: NonNullable<RuntimeKernelOptions['verifyWake']>
  /** Current time source. */
  readonly now: () => Date
  /** Kernel-owned work id generator for waiter firings during terminal events. */
  readonly newWorkId: () => WorkId
  /** Retry jitter source. */
  readonly rng?: () => number
  /** Lease TTL in milliseconds. */
  readonly leaseTtlMs: number
}

/** Handle one verified wake envelope through lease, execution, and commit. */
export async function handleWake(
  deps: HandleWakeDeps,
  envelope: WakeEnvelope,
): Promise<RuntimeWakeResult> {
  if (!(await deps.verifyWake(envelope))) {
    return { status: 401, outcome: 'unverified' }
  }

  if (
    await deps.store.state.hasIdempotencyKey(
      envelope.ns,
      envelope.idempotencyKey,
    )
  ) {
    return { status: 200, outcome: 'duplicate' }
  }

  const target = deps.targets[envelope.target]
  if (!target) {
    await blockMissingTarget({
      store: deps.store,
      envelope,
      now: deps.now,
      newWorkId: deps.newWorkId,
    })
    return { status: 200, outcome: 'blocked' }
  }

  const lease = await deps.store.leases.claim(`work:${envelope.workId}`, {
    ttlMs: deps.leaseTtlMs,
  })
  if (!lease) return { status: 409, outcome: 'busy' }

  try {
    const current = await deps.store.state.getWork(envelope.workId, {
      namespace: envelope.ns,
    })
    if (!current || isTerminalWork(current)) {
      return { status: 200, outcome: 'stale' }
    }

    const leased = transition(current, {
      status: 'leased',
      leaseToken: lease.token,
    })
    await deps.store.state.putWork(leased)

    try {
      const outcome = await target.execute({ work: leased, lease })
      await completeWork({
        store: deps.store,
        work: leased,
        outcome,
        idempotencyKey: envelope.idempotencyKey,
        now: deps.now,
        newWorkId: deps.newWorkId,
      })
      return { status: 200, outcome: 'processed' }
    } catch (error) {
      return await failWork({
        store: deps.store,
        work: await loadLeasedWork(deps.store, envelope, lease),
        error,
        now: deps.now,
        newWorkId: deps.newWorkId,
        rng: deps.rng,
      })
    }
  } finally {
    await deps.store.leases.release(lease)
  }
}

interface LoadLeasedWorkOptions {
  readonly ns: string
  readonly workId: WorkId
}

async function loadLeasedWork(
  store: RuntimeStoreAdapter,
  envelope: LoadLeasedWorkOptions,
  lease: Lease,
): Promise<WorkItem> {
  const work = await store.state.getWork(envelope.workId, {
    namespace: envelope.ns,
  })
  if (!work) {
    throw new Error(`Runtime work item ${envelope.workId} disappeared.`)
  }
  return work.status === 'leased'
    ? work
    : transition(work, { status: 'leased', leaseToken: lease.token })
}

interface BlockMissingTargetOptions {
  readonly store: RuntimeStoreAdapter
  readonly envelope: WakeEnvelope
  readonly now: () => Date
  readonly newWorkId: () => WorkId
}

async function blockMissingTarget(
  options: BlockMissingTargetOptions,
): Promise<void> {
  const error = targetNotFoundError(options.envelope.target)
  await options.store.transact(async (tx) => {
    const current = await tx.state.getWork(options.envelope.workId, {
      namespace: options.envelope.ns,
    })
    if (current && !isTerminalWork(current)) {
      await putWorkWithIdleAccounting(
        tx,
        { newWorkId: options.newWorkId, now: options.now },
        current,
        transition(current, {
          status: 'blocked',
          lastError: {
            code: error.code,
            message: error.message,
            at: options.now(),
          },
        }),
      )
    }
    await tx.state.putIdempotencyKey({
      namespace: options.envelope.ns,
      key: options.envelope.idempotencyKey,
      completedAt: options.now(),
    })
  })
}

interface FailWorkOptions {
  readonly store: RuntimeStoreAdapter
  readonly work: WorkItem
  readonly error: unknown
  readonly now: () => Date
  readonly newWorkId: () => WorkId
  readonly rng?: () => number
}

async function failWork(
  options: FailWorkOptions,
): Promise<Extract<RuntimeWakeResult, { readonly status: 200 }>> {
  const classification = classifyRuntimeFailure(options.error, {
    attempt: options.work.attempt,
    maxAttempts: options.work.maxAttempts,
    rng: options.rng,
  })

  if (classification.kind === 'retry') {
    await options.store.transact(async (tx) => {
      const retryAt = new Date(options.now().getTime() + classification.delayMs)
      const retryWork = transition(options.work, {
        status: 'pending',
        attempt: options.work.attempt + 1,
        notBefore: retryAt,
      })
      await tx.state.putWork(retryWork)
      await tx.outbox.put(wakeEnvelopeForWork(retryWork))
    })
    return { status: 200, outcome: 'retry-scheduled' }
  }

  const failedWork =
    classification.kind === 'dead-letter'
      ? transition(options.work, {
          status: 'dead-letter',
          lastError: {
            code: 'WORK_DEAD_LETTERED',
            message: runtimeErrorMessage(options.error),
            at: options.now(),
          },
        })
      : transition(options.work, {
          status: 'blocked',
          lastError: {
            code: classification.code,
            message: runtimeErrorMessage(options.error),
            at: options.now(),
          },
        })

  await options.store.transact(async (tx) => {
    await putWorkWithIdleAccounting(
      tx,
      { newWorkId: options.newWorkId, now: options.now },
      options.work,
      failedWork,
    )
  })
  return {
    status: 200,
    outcome:
      classification.kind === 'dead-letter' ? 'dead-lettered' : 'blocked',
  }
}

interface CompleteWorkOptions {
  readonly store: RuntimeStoreAdapter
  readonly work: WorkItem
  readonly outcome: RuntimeTargetOutcome
  readonly idempotencyKey: string
  readonly now: () => Date
  readonly newWorkId: () => WorkId
}

async function completeWork(options: CompleteWorkOptions): Promise<void> {
  await options.store.transact(async (tx) => {
    if (options.outcome.status === 'suspended') {
      await recordSuspensionInTransaction(
        tx,
        { newWorkId: options.newWorkId, now: options.now },
        options.outcome.suspension,
      )
      await tx.state.putIdempotencyKey({
        namespace: options.work.namespace,
        key: options.idempotencyKey,
        completedAt: options.now(),
      })
      return
    }

    const completed =
      options.outcome.status === 'completed'
        ? transition(options.work, { status: 'completed' })
        : transition(options.work, {
            status: 'blocked',
            lastError: options.outcome.error,
          })
    if (
      options.outcome.status === 'completed' &&
      'flowSnapshot' in options.outcome
    ) {
      await tx.state.putSnapshot(options.outcome.flowSnapshot)
    }
    await putWorkWithIdleAccounting(
      tx,
      { newWorkId: options.newWorkId, now: options.now },
      options.work,
      completed,
    )
    await tx.state.putIdempotencyKey({
      namespace: options.work.namespace,
      key: options.idempotencyKey,
      completedAt: options.now(),
    })
  })
}
