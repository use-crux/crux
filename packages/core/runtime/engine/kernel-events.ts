/**
 * Event and suspension composites for the Runtime Engine kernel.
 *
 * @module
 */

import type { EventCursor, RuntimeTargetId, WorkId } from '../ports/ids'
import type { RuntimePendingSuspend } from '../ports/state'
import type { RuntimeWaiter } from '../ports/waiters'
import type { RuntimeWork } from '../ports/work'
import type {
  RuntimeOutboxItem,
  RuntimeStoreAdapter,
  RuntimeStoreTransaction,
} from '../store'
import { createRuntimeError } from './errors'
import { flowEventResumeKey, taskRunKey } from './idempotency'
import type {
  EmitEventInput,
  EmitEventResult,
  RecordSuspensionInput,
  RuntimeSuspendRegistration,
} from './kernel-types'
import { wakeEnvelopeForWork } from './kernel-shared'
import { transition, type WorkItem } from './work'

/** Dependencies for event/suspension kernel operations. */
export interface KernelEventDeps {
  /** Durable runtime store. */
  readonly store: RuntimeStoreAdapter
  /** Kernel-owned work id generator for unowned waiter firings. */
  readonly newWorkId: () => WorkId
  /** Current time source. */
  readonly now: () => Date
}

/** Persist a flow suspension and owned waiter registrations atomically. */
export async function recordSuspension(
  deps: KernelEventDeps,
  input: RecordSuspensionInput,
): Promise<void> {
  await deps.store.transact(async (tx) => {
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
      updatedAt: deps.now(),
    })
  })
}

/** Append an event and resume all matching waiters that win the CAS race. */
export async function emitEvent(
  deps: KernelEventDeps,
  input: EmitEventInput,
): Promise<EmitEventResult> {
  return await deps.store.transact(async (tx) => {
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
        ...(await fireWaiter({ tx, deps, waiter, eventId: event.eventId })),
      ],
      Promise.resolve([]),
    )
    return { event, outboxItems }
  })
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
  })
  return { label: suspend.label, waiterId: waiter.waiterId }
}

interface FireWaiterOptions {
  readonly tx: RuntimeStoreTransaction
  readonly deps: KernelEventDeps
  readonly waiter: RuntimeWaiter
  readonly eventId: EventCursor
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

  const work = options.waiter.workId
    ? await options.tx.state.setWorkPending(options.waiter.workId, {
        namespace: options.waiter.namespace,
        work: options.waiter.work,
        idempotencyKey: flowEventResumeKey(
          options.waiter.workId,
          options.eventId,
        ),
      })
    : await createUnownedWork(options)

  if (!work) return []
  if (options.waiter.workId) {
    await options.tx.state.markSnapshotDelivered(options.waiter.workId, {
      namespace: options.waiter.namespace,
      waiterId: options.waiter.waiterId,
      eventId: options.eventId,
    })
  }
  return [await options.tx.outbox.put(wakeEnvelopeForWork(work))]
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

function targetIdForNewWork(work: RuntimeWork): RuntimeTargetId {
  if (work.kind === 'task.run') return work.targetId
  throw createRuntimeError({
    code: 'CAPABILITY_MISSING',
    whatFailed: `Runtime work kind \`${work.kind}\` cannot mint a new work item yet.`,
    why: 'Only task.run work carries a target id for new work creation in this phase.',
    whatStillWorks: 'Owned flow waiters can still resume existing work items.',
    nextStep:
      'Add the target identity to the future work kind before allowing unowned waiter firing.',
  })
}
