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
import type { RuntimeTargetId, TaskId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import type { RuntimeKernel } from '../engine/kernel'
import { wakeEnvelopeForWork } from '../engine/kernel'
import { createOutboxDispatcher } from '../engine/outbox'

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
  })
}
