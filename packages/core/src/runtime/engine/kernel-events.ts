/**
 * Event and suspension composites for the Runtime Engine kernel.
 *
 * @module
 */

import type { EventCursor, WorkId } from '../ports/ids'
import type { RuntimePendingSuspend } from '../ports/state'
import type { RuntimeWaiter } from '../ports/waiters'
import type {
  RuntimeOutboxItem,
  RuntimeStoreTransaction,
} from '../store'
import { flowEventResumeKey, taskRunKey } from './idempotency'
import {
  flushScheduledWorkInTransaction,
  mergeScheduledWorkRecords,
} from './kernel-scheduled-work'
import type {
  EmitEventInput,
  EmitEventResult,
  RecordSuspensionInput,
  RuntimeSuspendRegistration,
} from './kernel-types'
import type { RuntimeCompositeDeps, RuntimeCompositeRunner } from './composites'
import {
  isTerminalWork,
  targetIdForNewWork,
  wakeEnvelopeForWork,
} from './kernel-shared'
import { scheduleTimerInTransaction } from './kernel-timers'
import { transition, type WorkItem } from './work'

/** Dependencies for event/suspension kernel operations. */
export interface EmitEventInTransactionDeps extends RuntimeCompositeDeps {}

/** Dependencies for event/suspension kernel operations. */
export interface KernelEventDeps extends EmitEventInTransactionDeps {
  /** Execute a named composite through the store default or adapter override. */
  readonly runComposite: RuntimeCompositeRunner
}

/** Persist a flow suspension and owned waiter registrations atomically. */
export async function recordSuspension(
  deps: KernelEventDeps,
  input: RecordSuspensionInput,
): Promise<void> {
  await deps.runComposite('suspension.record', input)
}

/** Persist a flow suspension inside an existing kernel transaction. */
export async function recordSuspensionInTransaction(
  tx: RuntimeStoreTransaction,
  deps: EmitEventInTransactionDeps,
  input: RecordSuspensionInput,
): Promise<void> {
  const current = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  })
  if (current && current.status !== 'suspended') {
    await tx.state.putWork(transition(current, { status: 'suspended' }))
  }

  const pendingSuspends = await input.suspends.reduce<
    Promise<readonly RuntimePendingSuspend[]>
  >(
    async (previous, suspend) => [
      ...(await previous),
      await registerSuspend(tx, input, suspend),
    ],
    Promise.resolve([]),
  )
  const flushedWork = await flushScheduledWorkInTransaction(
    tx,
    input.scheduledWork,
    deps.now,
  )

  await tx.state.putSnapshot({
    flowId: input.flowId,
    workId: input.workId,
    targetId: input.targetId,
    namespace: input.namespace,
    status: 'suspended',
    input: input.snapshot.input,
    completedSteps: input.snapshot.completedSteps,
    fingerprint: input.snapshot.fingerprint,
    pendingSuspends,
    deliveredSuspends: input.snapshot.deliveredSuspends,
    scheduledWork: mergeScheduledWorkRecords(
      input.snapshot.scheduledWork,
      flushedWork,
    ),
    updatedAt: deps.now(),
  })
}

/** Append an event and resume all matching waiters that win the CAS race. */
export async function emitEvent(
  deps: KernelEventDeps,
  input: EmitEventInput,
): Promise<EmitEventResult> {
  return await deps.runComposite('event.emit', input)
}

/** Append an event and fire matching waiters inside an existing transaction. */
export async function emitEventInTransaction(
  tx: RuntimeStoreTransaction,
  deps: EmitEventInTransactionDeps,
  input: EmitEventInput,
): Promise<EmitEventResult> {
  const event = await tx.events.append({
    namespace: input.namespace,
    name: input.name,
    payload: input.payload,
    eventId: input.eventId,
  })
  const matched = await tx.waiters.resolve(input.name, input.payload, {
    namespace: input.namespace,
  })
  const outboxItems = await matched.reduce<
    Promise<readonly RuntimeOutboxItem[]>
  >(
    async (previous, waiter) => [
      ...(await previous),
      ...(await fireWaiter({
        tx,
        deps,
        waiter,
        eventId: event.eventId,
        payload: event.payload,
      })),
    ],
    Promise.resolve([]),
  )
  return { event, outboxItems }
}

async function registerSuspend(
  tx: RuntimeStoreTransaction,
  input: RecordSuspensionInput,
  suspend: RuntimeSuspendRegistration,
): Promise<RuntimePendingSuspend> {
  const waiter = await tx.waiters.register({
    namespace: input.namespace,
    eventName: suspend.eventName,
    match: suspend.match,
    workId: input.workId,
    work: { kind: 'flow.resume', flowId: input.flowId },
    timeoutAt: suspend.timeoutAt,
  })
  const timer = suspend.timeoutAt
    ? await scheduleTimerInTransaction(tx, {
        namespace: input.namespace,
        fireAt: suspend.timeoutAt,
        workId: input.workId,
        waiterId: waiter.waiterId,
        work: {
          kind: 'flow.timeout',
          flowId: input.flowId,
          suspendPoint: suspend.label,
        },
      })
    : undefined
  if (timer) {
    await tx.waiters.attachTimer(waiter.waiterId, timer.timerId)
  }
  return {
    label: suspend.label,
    deliveryKey: suspend.deliveryKey,
    waiterId: waiter.waiterId,
    timerId: timer?.timerId,
  }
}

interface FireWaiterOptions {
  readonly tx: RuntimeStoreTransaction
  readonly deps: EmitEventInTransactionDeps
  readonly waiter: RuntimeWaiter
  readonly eventId: EventCursor
  readonly payload: EmitEventInput['payload']
}

async function fireWaiter(
  options: FireWaiterOptions,
): Promise<readonly RuntimeOutboxItem[]> {
  const won = await options.tx.waiters.transition(
    options.waiter.waiterId,
    'armed',
    'fired',
  )
  if (!won) return []

  if (options.waiter.timerId) {
    await options.tx.timers.transition(
      options.waiter.timerId,
      'scheduled',
      'cancelled',
    )
  }

  if (options.waiter.workId) {
    const idempotencyKey = flowEventResumeKey(
      options.waiter.workId,
      options.eventId,
    )
    const transitioned = await options.tx.state.setWorkPending(
      options.waiter.workId,
      {
        namespace: options.waiter.namespace,
        work: options.waiter.work,
        idempotencyKey,
        now: options.deps.now(),
      },
    )
    const wakeWork =
      transitioned ??
      (await options.tx.state.getWork(options.waiter.workId, {
        namespace: options.waiter.namespace,
      }))
    if (!wakeWork || isTerminalWork(wakeWork)) return []

    await options.tx.state.markSnapshotDelivered(options.waiter.workId, {
      namespace: options.waiter.namespace,
      waiterId: options.waiter.waiterId,
      eventId: options.eventId,
      payload: options.payload,
    })
    return [
      await options.tx.outbox.put(
        {
          ...wakeEnvelopeForWork(wakeWork),
          idempotencyKey,
        },
        {
          deliverAt: options.deps.now(),
        },
      ),
    ]
  }

  const work = await createUnownedWork(options)
  return [
    await options.tx.outbox.put(wakeEnvelopeForWork(work), {
      deliverAt: options.deps.now(),
    }),
  ]
}

async function createUnownedWork(
  options: FireWaiterOptions,
): Promise<WorkItem> {
  const workId = options.deps.newWorkId()
  const targetId = targetIdForNewWork(options.waiter.work)
  return await options.tx.state.createWork({
    workId,
    namespace: options.waiter.namespace,
    work: options.waiter.work,
    targetId,
    idempotencyKey: taskRunKey(workId),
    now: options.deps.now(),
  })
}
