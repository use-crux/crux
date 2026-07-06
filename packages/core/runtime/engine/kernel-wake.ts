/**
 * Wake handling composite for the Runtime Engine kernel.
 *
 * @module
 */

import type { WorkId } from '../ports/ids'
import type { RuntimeStoreAdapter } from '../store'
import type { WakeEnvelope } from './envelope'
import type {
  RuntimeKernelOptions,
  RuntimeTargetMap,
  RuntimeWakeResult,
} from './kernel-types'
import {
  isTerminalWork,
  targetNotFoundError,
  wakeEnvelopeForWork,
} from './kernel-shared'
import { putWorkWithIdleAccounting } from './kernel-idle'
import {
  isLeaseLostError,
  startLeaseExtensionHeartbeat,
} from './kernel-leases'
import { completeWork, failWork } from './kernel-wake-commits'
import { transition } from './work'

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
  /** Lease heartbeat options. */
  readonly leaseExtension?: RuntimeKernelOptions['leaseExtension']
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

  const current = await deps.store.state.getWork(envelope.workId, {
    namespace: envelope.ns,
  })
  if (!current || isTerminalWork(current)) {
    return { status: 200, outcome: 'stale' }
  }
  if (current.status === 'leased') {
    return { status: 409, outcome: 'busy' }
  }
  if (current.notBefore && current.notBefore.getTime() > deps.now().getTime()) {
    await deps.store.outbox.put(wakeEnvelopeForWork(current), {
      deliverAt: current.notBefore,
    })
    return { status: 200, outcome: 'retry-scheduled' }
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
  let activeLease = lease

  try {
    if (
      await deps.store.state.hasIdempotencyKey(
        envelope.ns,
        envelope.idempotencyKey,
      )
    ) {
      return { status: 200, outcome: 'duplicate' }
    }

    const fresh = await deps.store.state.getWork(envelope.workId, {
      namespace: envelope.ns,
    })
    if (!fresh || isTerminalWork(fresh)) {
      return { status: 200, outcome: 'stale' }
    }
    if (fresh.status === 'leased') {
      return { status: 409, outcome: 'busy' }
    }
    if (fresh.notBefore && fresh.notBefore.getTime() > deps.now().getTime()) {
      await deps.store.outbox.put(wakeEnvelopeForWork(fresh), {
        deliverAt: fresh.notBefore,
      })
      return { status: 200, outcome: 'retry-scheduled' }
    }

    const leased = transition(fresh, {
      status: 'leased',
      leaseToken: lease.token,
    })
    await deps.store.state.putWork(leased)

    const heartbeat = startLeaseExtensionHeartbeat(
      {
        store: deps.store,
        leaseTtlMs: deps.leaseTtlMs,
        leaseExtension: deps.leaseExtension,
      },
      lease,
      (extended) => {
        activeLease = extended
      },
    )
    try {
      const outcome = await target.execute({ work: leased, lease })
      await completeWork({
        store: deps.store,
        work: leased,
        leaseToken: lease.token,
        outcome,
        idempotencyKey: envelope.idempotencyKey,
        now: deps.now,
        newWorkId: deps.newWorkId,
      })
      return { status: 200, outcome: 'processed' }
    } catch (error) {
      if (isLeaseLostError(error)) {
        return { status: 200, outcome: 'lease-lost' }
      }
      return await failWork({
        store: deps.store,
        work: leased,
        leaseToken: lease.token,
        error,
        now: deps.now,
        newWorkId: deps.newWorkId,
        rng: deps.rng,
      })
    } finally {
      heartbeat.stop()
    }
  } finally {
    await deps.store.leases.release(activeLease)
  }
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
