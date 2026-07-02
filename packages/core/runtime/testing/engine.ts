/**
 * Runtime Engine kernel conformance suite.
 *
 * Adapter packages use this helper to prove wake handling preserves the
 * Runtime Engine's core invariants: at-least-once delivery, idempotent
 * duplicate wakes, durable completion, and poison-message blocking.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import type { FlowId, RuntimeTargetId, TaskId, TimerId, WaiterId, WorkId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import type { RuntimeKernel } from '../engine/kernel'
import { wakeEnvelopeForWork } from '../engine/kernel'
import { createOutboxDispatcher } from '../engine/outbox'
import type { WorkItem } from '../engine/work'

/** Harness supplied by a runtime engine adapter conformance test. */
export interface RuntimeEngineAdapterTestHarness<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Durable store under test. */
  readonly store: TStore
  /** Kernel configured with at least one executable task target. */
  readonly kernel: RuntimeKernel
  /** Target id that succeeds and records one observable execution. */
  readonly targetId: RuntimeTargetId
  /** Task id used for conformance work. */
  readonly taskId: TaskId
  /** Return the number of successful target executions observed so far. */
  readonly readExecutionCount: () => Promise<number>
}

/** Options for {@link runRuntimeEngineAdapterTests}. */
export interface RunRuntimeEngineAdapterTestsOptions<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string
  /** Create a fresh, isolated runtime engine harness for each test. */
  readonly createHarness: () =>
    | RuntimeEngineAdapterTestHarness<TStore>
    | Promise<RuntimeEngineAdapterTestHarness<TStore>>
}

/** Register shared behavior checks for Runtime Engine adapters. */
export function runRuntimeEngineAdapterTests<
  TStore extends RuntimeStoreAdapter,
>(options: RunRuntimeEngineAdapterTestsOptions<TStore>): void {
  describe(`${options.name} Runtime Engine conformance`, () => {
    it('invariant: task wake delivery completes once and duplicate wakes are idempotent', async () => {
      const harness = await options.createHarness()
      const enqueued = await harness.kernel.enqueueTask({
        namespace: 'tenant-a',
        taskId: harness.taskId,
        targetId: harness.targetId,
      })

      await createOutboxDispatcher({
        store: harness.store,
        deliver: (envelope) =>
          harness.kernel.handleWake(envelope).then(() => {}),
      }).nudge()

      await expect(
        harness.store.state.getWork(enqueued.workId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({ status: 'completed' })
      await expect(harness.readExecutionCount()).resolves.toBe(1)

      await harness.kernel.handleWake(wakeEnvelopeForWork(enqueued))
      await expect(harness.readExecutionCount()).resolves.toBe(1)
    })

    it('invariant: unknown targets become blocked poison work with a 200-level ack', async () => {
      const harness = await options.createHarness()
      const enqueued = await harness.kernel.enqueueTask({
        namespace: 'tenant-a',
        taskId: harness.taskId,
        targetId: 'missing-target' as RuntimeTargetId,
      })

      await expect(
        harness.kernel.handleWake(wakeEnvelopeForWork(enqueued)),
      ).resolves.toEqual({ status: 200, outcome: 'blocked' })
      await expect(
        harness.store.state.getWork(enqueued.workId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({
        status: 'blocked',
        lastError: { code: 'TARGET_NOT_FOUND' },
      })
    })

    it('invariant: timers mint task work, scoped idle reaches zero, and cancellation owns registrations', async () => {
      const harness = await options.createHarness()
      const dueAt = new Date('2026-07-02T00:00:10.000Z')

      await harness.kernel.scheduleTimer({
        namespace: 'tenant-a',
        fireAt: dueAt,
        work: {
          kind: 'task.run',
          taskId: harness.taskId,
          targetId: harness.targetId,
        },
        idleScope: 'flow:flow_1',
      })
      await expect(
        harness.kernel.scanTimers({ namespace: 'tenant-a', now: dueAt }),
      ).resolves.toMatchObject({ fired: 1, skipped: 0 })
      await createOutboxDispatcher({
        store: harness.store,
        deliver: (envelope) =>
          harness.kernel.handleWake(envelope).then(() => {}),
      }).nudge()

      await expect(harness.readExecutionCount()).resolves.toBe(1)
      await expect(
        harness.store.state.getIdleCount('tenant-a', 'flow:flow_1'),
      ).resolves.toBe(0)

      await harness.store.state.putWork(makeSuspendedFlowWork())
      await harness.kernel.recordSuspension({
        namespace: 'tenant-a',
        workId: 'work_flow_1' as WorkId,
        flowId: 'flow_1' as FlowId,
        targetId: 'review' as RuntimeTargetId,
        snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
        suspends: [
          {
            label: 'approval',
            eventName: 'document.approved',
            match: {},
            timeoutAt: new Date('2026-07-02T00:01:00.000Z'),
          },
        ],
      })

      await expect(
        harness.kernel.cancelWork({
          namespace: 'tenant-a',
          workId: 'work_flow_1' as WorkId,
        }),
      ).resolves.toEqual({ cancelled: true })
      await expect(
        harness.store.waiters.transition(
          'waiter_1' as WaiterId,
          'armed',
          'fired',
        ),
      ).resolves.toBe(false)
      await expect(
        harness.store.timers.transition(
          'timer_1' as TimerId,
          'scheduled',
          'fired',
        ),
      ).resolves.toBe(false)
    })
  })
}

function makeSuspendedFlowWork(): WorkItem {
  const now = new Date('2026-07-02T00:00:00.000Z')
  return {
    workId: 'work_flow_1' as WorkId,
    namespace: 'tenant-a',
    work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
    targetId: 'review' as RuntimeTargetId,
    status: 'leased',
    attempt: 1,
    maxAttempts: 8,
    idempotencyKey: 'resume:work_flow_1:start',
    createdAt: now,
    updatedAt: now,
  }
}
