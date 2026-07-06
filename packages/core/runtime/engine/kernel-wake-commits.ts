/**
 * Final wake commit paths for the Runtime Engine kernel.
 *
 * These helpers keep wake orchestration separate from the durable transactions
 * that finish, suspend, retry, block, or dead-letter leased work.
 *
 * @module
 */

import type { LeaseToken, WorkId } from '../ports/ids'
import type { RuntimeStoreAdapter } from '../store'
import type { RuntimeTargetOutcome, RuntimeWakeResult } from './kernel-types'
import { recordSuspensionInTransaction } from './kernel-events'
import {
  flushScheduledEffectsInTransaction,
  mergeScheduledEffectRecords,
} from './kernel-effects'
import { putWorkWithIdleAccounting } from './kernel-idle'
import {
  assertLeaseHeldInTransaction,
  isLeaseLostError,
} from './kernel-leases'
import { runtimeErrorMessage, wakeEnvelopeForWork } from './kernel-shared'
import { classifyRuntimeFailure } from './retry'
import { transition, type WorkItem } from './work'

interface FailWorkOptions {
  readonly store: RuntimeStoreAdapter
  readonly work: WorkItem
  readonly leaseToken: LeaseToken
  readonly error: unknown
  readonly now: () => Date
  readonly newWorkId: () => WorkId
  readonly rng?: () => number
}

/** Record a target failure if the executor still owns the work lease. */
export async function failWork(
  options: FailWorkOptions,
): Promise<Extract<RuntimeWakeResult, { readonly status: 200 }>> {
  if (isLeaseLostError(options.error)) {
    return { status: 200, outcome: 'lease-lost' }
  }

  try {
    return await options.store.transact(async (tx) => {
      const current = await assertLeaseHeldInTransaction(
        tx,
        options.work,
        options.leaseToken,
      )
      const classification = classifyRuntimeFailure(options.error, {
        attempt: current.attempt,
        maxAttempts: current.maxAttempts,
        rng: options.rng,
      })

      if (classification.kind !== 'retry') {
        const failedWork =
          classification.kind === 'dead-letter'
            ? transition(current, {
                status: 'dead-letter',
                lastError: {
                  code: 'WORK_DEAD_LETTERED',
                  message: runtimeErrorMessage(options.error),
                  at: options.now(),
                },
              })
            : transition(current, {
                status: 'blocked',
                lastError: {
                  code: classification.code,
                  message: runtimeErrorMessage(options.error),
                  at: options.now(),
                },
              })

        await putWorkWithIdleAccounting(
          tx,
          { newWorkId: options.newWorkId, now: options.now },
          current,
          failedWork,
        )
        return {
          status: 200,
          outcome:
            classification.kind === 'dead-letter'
              ? 'dead-lettered'
              : 'blocked',
        }
      }

      const retryAt = new Date(options.now().getTime() + classification.delayMs)
      const retryWork = transition(current, {
        status: 'pending',
        attempt: current.attempt + 1,
        notBefore: retryAt,
      })
      await tx.state.putWork(retryWork)
      await tx.outbox.put(wakeEnvelopeForWork(retryWork), {
        deliverAt: retryAt,
      })
      return { status: 200, outcome: 'retry-scheduled' }
    })
  } catch (error) {
    if (isLeaseLostError(error)) {
      return { status: 200, outcome: 'lease-lost' }
    }
    throw error
  }
}

interface CompleteWorkOptions {
  readonly store: RuntimeStoreAdapter
  readonly work: WorkItem
  readonly leaseToken: LeaseToken
  readonly outcome: RuntimeTargetOutcome
  readonly idempotencyKey: string
  readonly now: () => Date
  readonly newWorkId: () => WorkId
}

/** Commit a successful target outcome if the executor still owns the lease. */
export async function completeWork(
  options: CompleteWorkOptions,
): Promise<void> {
  await options.store.transact(async (tx) => {
    const current = await assertLeaseHeldInTransaction(
      tx,
      options.work,
      options.leaseToken,
    )
    if (options.outcome.status === 'suspended') {
      await recordSuspensionInTransaction(
        tx,
        { newWorkId: options.newWorkId, now: options.now },
        options.outcome.suspension,
      )
      await tx.state.putIdempotencyKey({
        namespace: current.namespace,
        key: options.idempotencyKey,
        completedAt: options.now(),
      })
      return
    }

    const completed =
      options.outcome.status === 'completed'
        ? transition(current, { status: 'completed' })
        : options.outcome.status === 'cancelled'
          ? transition(current, { status: 'cancelled' })
          : transition(current, {
              status: 'blocked',
              lastError: options.outcome.error,
            })
    if (
      (options.outcome.status === 'completed' ||
        options.outcome.status === 'cancelled') &&
      'flowSnapshot' in options.outcome
    ) {
      const flushedEffects = await flushScheduledEffectsInTransaction(
        tx,
        options.outcome.scheduledEffects,
        options.now,
      )
      await tx.state.putSnapshot({
        ...options.outcome.flowSnapshot,
        scheduledEffects: mergeScheduledEffectRecords(
          options.outcome.flowSnapshot.scheduledEffects,
          flushedEffects,
        ),
      })
    }
    await putWorkWithIdleAccounting(
      tx,
      { newWorkId: options.newWorkId, now: options.now },
      current,
      completed,
    )
    await tx.state.putIdempotencyKey({
      namespace: current.namespace,
      key: options.idempotencyKey,
      completedAt: options.now(),
    })
  })
}
