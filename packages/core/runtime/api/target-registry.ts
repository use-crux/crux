/**
 * Process-local runtime target registry.
 *
 * This registry supports object-bound and config-bound runtime APIs before
 * generated handler artifacts exist. I10 discovery/codegen will produce
 * explicit target lists for deployed entry files; this registry keeps local
 * hand-written usage working without moving correctness logic out of the
 * kernel.
 *
 * @module
 */

import type { ResolvedRuntimeEngine } from './create-runtime'
import type { RuntimeTarget, RuntimeTargetMap } from '../engine/kernel'

/** Shared mutable reference passed to targets created before runtime resolution. */
export interface RuntimeTargetRuntimeRef {
  /** Resolved runtime currently executing registered targets. */
  current?: ResolvedRuntimeEngine
  /** Last flow result produced by an inline runtime target execution. */
  result?: unknown
}

/** Factory that materializes a runtime target for a resolved runtime. */
export type RegisteredRuntimeTargetFactory = (
  runtimeRef: RuntimeTargetRuntimeRef,
) => RuntimeTarget

const runtimeTargets = new Map<string, RegisteredRuntimeTargetFactory>()

/** Register or replace a process-local runtime target factory. */
export function registerRuntimeTarget(
  targetName: string,
  factory: RegisteredRuntimeTargetFactory,
): void {
  runtimeTargets.set(targetName, factory)
}

/** Materialize all process-local runtime targets against one runtime ref. */
export function runtimeTargetMap(
  runtimeRef: RuntimeTargetRuntimeRef,
): RuntimeTargetMap {
  return Object.freeze(
    Object.fromEntries(
      [...runtimeTargets.entries()].map(([name, factory]) => [
        name,
        factory(runtimeRef),
      ]),
    ),
  )
}
