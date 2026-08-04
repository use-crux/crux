/**
 * Wake handling composite for the Runtime Engine kernel.
 *
 * @module
 */

import type { WorkId } from '../ports/ids'
import type { RuntimeStoreAdapter, RuntimeStoreTransaction } from '../store'
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
import { isLeaseLostError, startLeaseExtensionHeartbeat } from './kernel-leases'
import { completeWork, failWork } from './kernel-wake-commits'
import type { RuntimeCompositeDeps, RuntimeCompositeRunner } from './composites'
import {
  executeWithNamedDeferEvidence,
  flushNamedDeferEvidenceAfterCommit,
} from './named-defer-evidence'
import { transition } from './work'
import { runWithDurableEffectLedger } from '../../effect/internal/durable-binding'

/** Dependencies for wake handling. */
export interface HandleWakeDeps {
  /** Durable runtime store. */
  readonly store: RuntimeStoreAdapter
  /** Execute a named composite through the store default or adapter override. */
  readonly runComposite: RuntimeCompositeRunner
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
      runComposite: deps.runComposite,
      envelope,
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
      const executeTarget = () => target.execute({ work: leased, lease })
      const outcome = await executeWithNamedDeferEvidence(leased, () =>
        deps.store.effects
          ? runWithDurableEffectLedger(
              { namespace: leased.namespace, store: deps.store },
              executeTarget,
            )
          : executeTarget(),
      )
      await completeWork({
        runComposite: deps.runComposite,
        work: leased,
        leaseToken: lease.token,
        outcome,
        idempotencyKey: envelope.idempotencyKey,
        now: deps.now,
        newWorkId: deps.newWorkId,
      })
      await flushNamedDeferEvidenceAfterCommit(leased)
      return { status: 200, outcome: 'processed' }
    } catch (error) {
      if (isLeaseLostError(error)) {
        return { status: 200, outcome: 'lease-lost' }
      }
      const result = await failWork({
        runComposite: deps.runComposite,
        work: leased,
        leaseToken: lease.token,
        error,
        now: deps.now,
        newWorkId: deps.newWorkId,
        rng: deps.rng,
      })
      if (result.outcome !== 'lease-lost') {
        await flushNamedDeferEvidenceAfterCommit(leased)
      }
      return result
    } finally {
      heartbeat.stop()
    }
  } finally {
    await deps.store.leases.release(activeLease)
  }
}

interface BlockMissingTargetOptions {
  readonly runComposite: RuntimeCompositeRunner
  readonly envelope: WakeEnvelope
}

async function blockMissingTarget(
  options: BlockMissingTargetOptions,
): Promise<void> {
  await options.runComposite('wake.block-missing-target', {
    envelope: options.envelope,
  })
}

/** Block missing-target work inside a transaction. */
export async function blockMissingTargetInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: { readonly envelope: WakeEnvelope },
): Promise<void> {
  const error = targetNotFoundError(input.envelope.target)
  const current = await tx.state.getWork(input.envelope.workId, {
    namespace: input.envelope.ns,
  })
  if (current && !isTerminalWork(current)) {
    await putWorkWithIdleAccounting(
      tx,
      { newWorkId: deps.newWorkId, now: deps.now },
      current,
      transition(current, {
        status: 'blocked',
        lastError: {
          code: error.code,
          message: error.message,
          at: deps.now(),
        },
      }),
    )
  }
  await tx.state.putIdempotencyKey({
    namespace: input.envelope.ns,
    key: input.envelope.idempotencyKey,
    completedAt: deps.now(),
  })
}
