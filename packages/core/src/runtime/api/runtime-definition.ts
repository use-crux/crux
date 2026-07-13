/**
 * Runtime Engine definition contracts.
 *
 * In-process definitions are executable in the current JavaScript process.
 * Host-bound definitions are inert config declarations that a host package
 * binds to request-scoped ports before execution.
 *
 * @module
 */

import type { CruxEngineCapabilities, WorkId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import type { RuntimeKernel } from '../engine/kernel'
import type { RuntimeWakeDeliver } from '../engine/outbox'
import type { RuntimeWakeRequestVerifier } from '../handler/verify'
import type { RuntimeRetentionConfig } from '../engine/retention'
import { createRuntimeError } from '../engine/errors'

/** Provenance of a Runtime Engine namespace resolved by a composer. */
export type RuntimeNamespaceSource =
  | 'explicit'
  | 'env'
  | 'inferred'
  | 'fallback'

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

/** Runtime composer output that can execute in the current process. */
export interface InProcessRuntimeEngineDefinition<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Executable runtimes carry concrete ports and can resolve directly. */
  readonly kind: 'in-process'
  /** Stable adapter/composer id used in diagnostics. */
  readonly id: string
  /** Store backing runtime state, events, waiters, timers, outbox, and leases. */
  readonly store: TStore
  /** Capability declaration used for preflight and runtime diagnostics. */
  readonly capabilities: CruxEngineCapabilities
  /** Default namespace for local/runtime-owned operations. */
  readonly namespace?: string
  /** Provenance of the resolved namespace, used by setup/preflight tooling. */
  readonly namespaceSource?: RuntimeNamespaceSource
  /** Optional automatic maintenance-loop defaults. */
  readonly maintenance?: RuntimeMaintenanceLoopOptions
  /** Retention policy for terminal Runtime Engine records. */
  readonly retention?: RuntimeRetentionConfig
  /** Current time source inherited by resolved runtime instances. */
  readonly now?: () => Date
  /** Work id generator inherited by resolved runtime instances. */
  readonly newWorkId?: () => WorkId
  /** Optional HTTP wake verifier supplied by a wake adapter such as QStash. */
  readonly verifyWakeRequest?: RuntimeWakeRequestVerifier
  /** Create wake delivery for this runtime. */
  createWake(input: RuntimeWakeFactoryInput<TStore>): RuntimeWakeDeliver
}

/** Declaration-only runtime for hosts whose ports require request-scoped context. */
export interface HostBoundRuntimeEngineDefinition<
  TOptions extends object = object,
> {
  /** Host-bound runtimes must be bound by their host package before execution. */
  readonly kind: 'host-bound'
  /** Stable adapter/composer id used in diagnostics. */
  readonly id: string
  /** Host that owns execution, such as `convex`. */
  readonly host: string
  /** Capability declaration used for config-time preflight and diagnostics. */
  readonly capabilities: CruxEngineCapabilities
  /** Default namespace declared by the host adapter. */
  readonly namespace?: string
  /** Exact host entry point users must wire or generate. */
  readonly entry?: string
  /** Adapter-specific declaration options. Core stores these inertly. */
  readonly options?: TOptions
  /** Retention policy for terminal Runtime Engine records. */
  readonly retention?: RuntimeRetentionConfig
}

/** Runtime composer output accepted by `config({ runtime })`. */
export type RuntimeEngineDefinition<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> = InProcessRuntimeEngineDefinition<TStore> | HostBoundRuntimeEngineDefinition

/** Options for the standard host-only runtime diagnostic. */
export interface RuntimeHostOnlyErrorOptions {
  /** API that attempted to execute a host-bound runtime outside the host. */
  readonly api: string
  /** Host that owns execution, such as `convex`. */
  readonly host: string
  /** Exact generated or hand-written host entry point to use. */
  readonly entry?: string
}

/** Create the standard diagnostic for host-bound runtimes used outside their host. */
export function runtimeHostOnlyError(
  options: RuntimeHostOnlyErrorOptions,
): ReturnType<typeof createRuntimeError> {
  const entry =
    options.entry ??
    `Use the ${options.host} runtime entry generated by crux runtime generate.`
  return createRuntimeError({
    code: 'RUNTIME_HOST_ONLY',
    whatFailed: `${options.api} requires the ${options.host} runtime host.`,
    why: `This runtime declaration can only execute inside ${options.host} functions.`,
    whatStillWorks:
      'Object-bound flow and task definitions still typecheck. Execute runtime-backed work from the configured host boundary.',
    nextStep: `Wire ${entry}, or run crux runtime generate to create it.`,
  })
}
