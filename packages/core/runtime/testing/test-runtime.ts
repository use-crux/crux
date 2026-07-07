/**
 * App-level Runtime Engine test harness.
 *
 * `createTestRuntime()` installs a temporary runtime hook layer backed by the
 * in-memory store and an injected clock. Tests can then exercise the same
 * object-bound flow and durable-task wiring used in production while driving
 * maintenance synchronously.
 *
 * @module
 */

import { parseDuration } from '../../flow/lifecycle'
import { createRuntime, type ResolvedRuntimeEngine } from '../api/create-runtime'
import type { RuntimeTargetRuntimeRef } from '../api/target-registry'
import { inMemoryRuntimeStore, type InMemoryRuntimeStore } from '../adapters/memory'
import { node } from '../composers/node'
import type { MaintenanceTickResult } from '../engine/kernel'
import {
  normalizeRuntimeHandlerTargets,
  type RuntimeHandlerTarget,
} from '../handler/targets'
import type { WorkId } from '../ports'
import {
  pushHooksLayer,
  restoreHooksLayer,
} from '../runtime'

const DEFAULT_TEST_EPOCH = new Date('2026-01-01T00:00:00.000Z')
const DEFAULT_MAX_SETTLE_TICKS = 100

/** Options for {@link createTestRuntime}. */
export interface CreateTestRuntimeOptions {
  /**
   * Runtime targets exercised by the test.
   *
   * Pass exported `flow()` handles and `durableTask()` targets, matching the
   * shape accepted by `createRuntimeHandler({ targets })`.
   */
  readonly targets: readonly RuntimeHandlerTarget[]
  /**
   * Initial harness clock value.
   *
   * Defaults to a fixed timestamp so tests never depend on wall-clock time.
   */
  readonly epoch?: Date
}

/** Options for {@link TestRuntime.settle}. */
export interface TestRuntimeSettleOptions {
  /**
   * Maximum maintenance ticks before treating the runtime as livelocked.
   *
   * Increase this only when the test intentionally creates a long retry chain.
   */
  readonly maxTicks?: number
}

/** Summary returned after a bounded settle loop. */
export interface TestRuntimeSettleResult {
  /** Number of maintenance ticks run by this settle call. */
  readonly ticks: number
  /** Last maintenance result observed before the runtime became idle. */
  readonly lastTick: MaintenanceTickResult
}

/** Controllable Runtime Engine clock used by {@link TestRuntime}. */
export interface TestRuntimeClock {
  /** Current harness time. */
  now(): Date
  /**
   * Advance the harness clock and settle due runtime work.
   *
   * Duration strings use the same format as `flow.after()`, such as `'2d'`,
   * `'30m'`, or `'100ms'`.
   */
  advance(duration: string): Promise<TestRuntimeSettleResult>
}

/** Runtime Engine harness for app-level flow and durable-task tests. */
export interface TestRuntime {
  /** Resolved in-process runtime over the in-memory store. */
  readonly runtime: ResolvedRuntimeEngine<InMemoryRuntimeStore>
  /** In-memory store backing the harness runtime. */
  readonly store: InMemoryRuntimeStore
  /** Injected clock inherited by runtime instances created from the hook layer. */
  readonly clock: TestRuntimeClock
  /** Run one maintenance pass with wake delivery. */
  tick(): Promise<MaintenanceTickResult>
  /** Run maintenance until the runtime reports no activity twice in a row. */
  settle(options?: TestRuntimeSettleOptions): Promise<TestRuntimeSettleResult>
  /** Restore the previous runtime hook layer and stop harness-owned work. */
  dispose(): void
}

/**
 * Create an app-level Runtime Engine harness.
 *
 * The harness installs a temporary hooks layer, so calls such as
 * `reviewFlow.run()` use the same runtime-backed flow path they use in an app.
 * Always call `dispose()` in test cleanup to restore any previous runtime
 * configuration.
 *
 * @example
 * ```ts
 * const rt = createTestRuntime({ targets: [reviewFlow, sendReminder] })
 *
 * const suspended = await reviewFlow.run({ userId: 'user_1' })
 * await rt.clock.advance('2d')
 *
 * expect(suspended.status).toBe('suspended')
 * expect(sentReminders).toEqual(['user_1'])
 * rt.dispose()
 * ```
 */
export function createTestRuntime(
  options: CreateTestRuntimeOptions,
): TestRuntime {
  let currentTime = new Date(options.epoch ?? DEFAULT_TEST_EPOCH)
  let nextWorkId = 0
  let disposed = false

  const now = () => new Date(currentTime)
  const newWorkId = () => `work_test_${++nextWorkId}` as WorkId
  const store = inMemoryRuntimeStore()
  const definition = Object.freeze({
    ...node({ store, autoStartMaintenance: false }),
    now,
    newWorkId,
  })
  const runtimeRef: RuntimeTargetRuntimeRef = {}
  const targets = normalizeRuntimeHandlerTargets({
    targets: options.targets,
    runtimeRef,
    entry: 'createTestRuntime()',
  })
  const runtime = createRuntime({
    runtime: definition,
    targets,
    leaseExtension: false,
    startMaintenance: false,
  })
  runtimeRef.current = runtime
  const layerToken = pushHooksLayer({ runtimeEngine: definition })

  async function tick(): Promise<MaintenanceTickResult> {
    return await runtime.maintenance.tick()
  }

  async function settle(
    settleOptions: TestRuntimeSettleOptions = {},
  ): Promise<TestRuntimeSettleResult> {
    const maxTicks = settleOptions.maxTicks ?? DEFAULT_MAX_SETTLE_TICKS
    let idleTicks = 0
    let lastTick = idleMaintenanceTick()
    for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
      lastTick = await tick()
      idleTicks = maintenanceDidWork(lastTick) ? 0 : idleTicks + 1
      if (idleTicks >= 2) return { ticks, lastTick }
    }
    throw new Error(
      `createTestRuntime().settle() exceeded ${maxTicks} ticks; advance the clock or raise maxTicks.`,
    )
  }

  const clock: TestRuntimeClock = Object.freeze({
    now,
    async advance(duration: string): Promise<TestRuntimeSettleResult> {
      currentTime = new Date(currentTime.getTime() + parseDuration(duration))
      return await settle()
    },
  })

  return Object.freeze({
    runtime,
    store,
    clock,
    tick,
    settle,
    dispose() {
      if (disposed) return
      disposed = true
      restoreHooksLayer(layerToken)
      runtime.dispose()
    },
  })
}

function maintenanceDidWork(result: MaintenanceTickResult): boolean {
  return (
    result.outboxDelivered +
      result.outboxFailed +
      result.timersFired +
      result.leasesReclaimed +
      result.waitersExpired +
      result.pendingRequeued >
    0
  )
}

function idleMaintenanceTick(): MaintenanceTickResult {
  return {
    outboxDelivered: 0,
    outboxFailed: 0,
    timersFired: 0,
    timersSkipped: 0,
    leasesReclaimed: 0,
    waitersExpired: 0,
    pendingRequeued: 0,
    retainedRecordsRemoved: 0,
    retentionTruncated: false,
  }
}
