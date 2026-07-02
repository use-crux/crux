/**
 * Resolve Runtime Engine composers into executable kernel instances.
 *
 * Composers such as `node()` declare ports, wake delivery, and maintenance
 * defaults. `createRuntime()` performs the shared capability preflight, builds
 * the kernel, and exposes the small operational facade used by hand-written or
 * generated runtime entries.
 *
 * @module
 */

import type { CruxEngineCapabilities, WorkId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import { createRuntimeKernel } from '../engine/kernel'
import type {
  MaintenanceTickOptions,
  MaintenanceTickResult,
  RuntimeKernel,
  RuntimeKernelOptions,
  RuntimeTargetMap,
} from '../engine/kernel'
import { createOutboxDispatcher } from '../engine/outbox'
import type {
  RuntimeOutboxDispatcher,
  RuntimeWakeDeliver,
} from '../engine/outbox'
import { assertRuntimeCapabilities } from './runtime-capabilities'

/** Options passed to a composer when `createRuntime()` builds wake delivery. */
export interface RuntimeWakeFactoryInput<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Store used by the resolved runtime. */
  readonly store: TStore
  /** Kernel that should receive delivered wake envelopes. */
  readonly kernel: RuntimeKernel
  /** Default namespace for maintenance and dispatch. */
  readonly namespace: string
  /** Current time source shared with the kernel. */
  readonly now: () => Date
}

/** Maintenance-loop defaults supplied by a runtime composer. */
export interface RuntimeMaintenanceLoopOptions {
  /** Interval between automatic maintenance ticks in milliseconds. */
  readonly intervalMs?: number
  /** Whether `createRuntime()` should start the loop immediately. */
  readonly autoStart?: boolean
}

/** Runtime composer output accepted by `config({ runtime })`. */
export interface RuntimeEngineDefinition<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Stable adapter/composer id used in diagnostics. */
  readonly id: string
  /** Store backing runtime state, events, waiters, timers, outbox, and leases. */
  readonly store: TStore
  /** Capability declaration used for preflight and runtime diagnostics. */
  readonly capabilities: CruxEngineCapabilities
  /** Default namespace for local/runtime-owned operations. */
  readonly namespace?: string
  /** Optional automatic maintenance-loop defaults. */
  readonly maintenance?: RuntimeMaintenanceLoopOptions
  /** Create wake delivery for this runtime. */
  createWake(input: RuntimeWakeFactoryInput<TStore>): RuntimeWakeDeliver
}

/** Options for resolving a runtime composer into an executable kernel. */
export interface CreateRuntimeOptions<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Runtime composer returned by `node()`, `serverless()`, or a future adapter. */
  readonly runtime: RuntimeEngineDefinition<TStore>
  /** Runtime targets available to wake delivery. */
  readonly targets?: RuntimeTargetMap
  /** Runtime namespace. Defaults to the composer namespace, then `local`. */
  readonly namespace?: string
  /** Work id generator owned by the caller or generated entry. */
  readonly newWorkId?: () => WorkId
  /** Current time source for deterministic tests. */
  readonly now?: () => Date
  /** Verify wake envelopes before execution. Defaults to the kernel default. */
  readonly verifyWake?: RuntimeKernelOptions['verifyWake']
  /** Lease TTL for wake processing. Defaults to the kernel default. */
  readonly leaseTtlMs?: number
  /** Override whether the composer maintenance loop starts immediately. */
  readonly startMaintenance?: boolean
}

/** Maintenance controls exposed by a resolved runtime. */
export interface RuntimeMaintenanceController {
  /** Run one maintenance pass using the runtime's default wake delivery. */
  tick(options?: RuntimeMaintenanceTickOptions): Promise<MaintenanceTickResult>
  /** Start the automatic maintenance loop if it is not already running. */
  start(): RuntimeMaintenanceHandle
  /** Stop the automatic maintenance loop if it is running. */
  stop(): void
}

/** Options for a resolved runtime maintenance tick. */
export type RuntimeMaintenanceTickOptions = Omit<
  MaintenanceTickOptions,
  'deliver'
>

/** Handle returned by {@link RuntimeMaintenanceController.start}. */
export interface RuntimeMaintenanceHandle {
  /** Stop future automatic maintenance ticks. */
  stop(): void
}

/** Executable runtime instance built from a composer. */
export interface ResolvedRuntimeEngine<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Stable adapter/composer id. */
  readonly id: string
  /** Runtime namespace used by default for dispatch and maintenance. */
  readonly namespace: string
  /** Store backing the runtime. */
  readonly store: TStore
  /** Capability declaration that passed preflight. */
  readonly capabilities: CruxEngineCapabilities
  /** Kernel composite operations. */
  readonly kernel: RuntimeKernel
  /** Wake delivery callback used by the dispatcher and maintenance. */
  readonly deliver: RuntimeWakeDeliver
  /** Outbox dispatcher using this runtime's wake delivery. */
  readonly dispatcher: RuntimeOutboxDispatcher
  /** Maintenance tick and automatic-loop controls. */
  readonly maintenance: RuntimeMaintenanceController
  /** Stop runtime-owned background work. */
  dispose(): void
}

/** Resolve a runtime composer into an executable Runtime Engine instance. */
export function createRuntime<TStore extends RuntimeStoreAdapter>(
  options: CreateRuntimeOptions<TStore>,
): ResolvedRuntimeEngine<TStore> {
  assertRuntimeCapabilities(options.runtime)

  const namespace = options.namespace ?? options.runtime.namespace ?? 'local'
  const now = options.now ?? (() => new Date())
  const kernel = createRuntimeKernel({
    store: options.runtime.store,
    targets: options.targets ?? {},
    verifyWake: options.verifyWake,
    newWorkId: options.newWorkId ?? createDefaultWorkIdGenerator(),
    now,
    leaseTtlMs: options.leaseTtlMs,
  })
  const deliver = options.runtime.createWake({
    store: options.runtime.store,
    kernel,
    namespace,
    now,
  })
  const dispatcher = createOutboxDispatcher({
    store: options.runtime.store,
    deliver,
    namespace,
    now,
  })

  let activeMaintenance: RuntimeMaintenanceHandle | undefined
  const maintenance = createMaintenanceController({
    kernel,
    deliver,
    namespace,
    intervalMs: options.runtime.maintenance?.intervalMs,
    getActive: () => activeMaintenance,
    setActive: (handle) => {
      activeMaintenance = handle
    },
  })

  const resolved = Object.freeze({
    id: options.runtime.id,
    namespace,
    store: options.runtime.store,
    capabilities: options.runtime.capabilities,
    kernel,
    deliver,
    dispatcher,
    maintenance,
    dispose() {
      maintenance.stop()
    },
  })

  if (
    options.startMaintenance ??
    options.runtime.maintenance?.autoStart ??
    false
  ) {
    maintenance.start()
  }

  return resolved
}

function createMaintenanceController(options: {
  readonly kernel: RuntimeKernel
  readonly deliver: RuntimeWakeDeliver
  readonly namespace: string
  readonly intervalMs?: number
  readonly getActive: () => RuntimeMaintenanceHandle | undefined
  readonly setActive: (handle: RuntimeMaintenanceHandle | undefined) => void
}): RuntimeMaintenanceController {
  const tick = (tickOptions: RuntimeMaintenanceTickOptions = {}) =>
    options.kernel.maintenanceTick({
      ...tickOptions,
      namespace: tickOptions.namespace ?? options.namespace,
      deliver: options.deliver,
    })

  return Object.freeze({
    tick,
    start() {
      const active = options.getActive()
      if (active) return active
      const interval = setInterval(() => {
        void tick()
      }, options.intervalMs ?? 1_000)
      interval.unref?.()
      const handle = Object.freeze({
        stop() {
          clearInterval(interval)
          if (options.getActive() === handle) options.setActive(undefined)
        },
      })
      options.setActive(handle)
      return handle
    },
    stop() {
      options.getActive()?.stop()
    },
  })
}

function createDefaultWorkIdGenerator(): () => WorkId {
  let counter = 0
  return () => `work_${Date.now().toString(36)}_${++counter}` as WorkId
}
