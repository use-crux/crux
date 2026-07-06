/**
 * Host-bound Runtime Engine binding.
 *
 * Host packages call this after they have request-scoped platform context.
 * Core still performs kernel composition through the same `createRuntime()`
 * path used by in-process composers.
 *
 * @module
 */

import type { WorkId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import type { RuntimeKernelOptions, RuntimeTargetMap } from '../engine/kernel'
import type { RuntimeWakeDeliver } from '../engine/outbox'
import type { RuntimeWakeRequestVerifier } from '../handler/verify'
import { createRuntime } from './create-runtime'
import type { ResolvedRuntimeEngine } from './create-runtime'
import type {
  HostBoundRuntimeEngineDefinition,
  InProcessRuntimeEngineDefinition,
  RuntimeWakeFactoryInput,
} from './runtime-definition'

/** Executable host binding supplied by a host integration per invocation. */
export interface HostRuntimeBinding<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Store backed by request-scoped host context. */
  readonly store: TStore
  /** Runtime namespace for this host invocation. Defaults to the declaration namespace, then `local`. */
  readonly namespace?: string
  /** Optional HTTP or host-specific wake verifier for bound handlers. */
  readonly verifyWakeRequest?: RuntimeWakeRequestVerifier
  /** Create wake delivery for this host invocation. */
  createWake(input: RuntimeWakeFactoryInput<TStore>): RuntimeWakeDeliver
  /** Runtime targets available to wake delivery. */
  readonly targets?: RuntimeTargetMap
  /** Work id generator owned by the host or generated entry. */
  readonly newWorkId?: () => WorkId
  /** Current time source for deterministic tests. */
  readonly now?: () => Date
  /** Verify wake envelopes before execution. Defaults to the kernel default. */
  readonly verifyWake?: RuntimeKernelOptions['verifyWake']
  /** Lease TTL for wake processing. Defaults to the kernel default. */
  readonly leaseTtlMs?: number
  /** Override whether the automatic maintenance loop starts immediately. */
  readonly startMaintenance?: boolean
}

/**
 * Bind a declaration-only host runtime to executable request-scoped ports.
 *
 * Host integrations use this per invocation after they have access to their
 * native context, component refs, scheduler, or other platform capabilities.
 * The helper assembles an in-process definition and delegates to
 * {@link createRuntime}, keeping kernel composition on one shared path.
 */
export function bindHostRuntime<TStore extends RuntimeStoreAdapter>(
  definition: HostBoundRuntimeEngineDefinition,
  binding: HostRuntimeBinding<TStore>,
): ResolvedRuntimeEngine<TStore> {
  const runtime: InProcessRuntimeEngineDefinition<TStore> = {
    kind: 'in-process',
    id: definition.id,
    store: binding.store,
    capabilities: definition.capabilities,
    namespace: binding.namespace ?? definition.namespace,
    ...(definition.retention ? { retention: definition.retention } : {}),
    ...(binding.verifyWakeRequest
      ? { verifyWakeRequest: binding.verifyWakeRequest }
      : {}),
    createWake: binding.createWake,
  }

  return createRuntime({
    runtime,
    targets: binding.targets ?? {},
    ...(binding.newWorkId ? { newWorkId: binding.newWorkId } : {}),
    ...(binding.now ? { now: binding.now } : {}),
    ...(binding.verifyWake ? { verifyWake: binding.verifyWake } : {}),
    ...(binding.leaseTtlMs ? { leaseTtlMs: binding.leaseTtlMs } : {}),
    ...(binding.startMaintenance !== undefined
      ? { startMaintenance: binding.startMaintenance }
      : {}),
  })
}
