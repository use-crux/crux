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
import type { FlowResult } from '../../flow/types'

/** Shared mutable reference passed to targets created before runtime resolution. */
export interface RuntimeTargetRuntimeRef {
  /** Resolved runtime currently executing registered targets. */
  current?: ResolvedRuntimeEngine
  /** Observed flow result produced by an inline runtime target execution. */
  flowResult?: FlowResult<unknown>
}

/** Factory that materializes a runtime target for a resolved runtime. */
export type RegisteredRuntimeTargetFactory = (
  runtimeRef: RuntimeTargetRuntimeRef,
) => RuntimeTarget

const runtimeTargets = new Map<string, RegisteredRuntimeTargetFactory>()
const duplicateRuntimeTargetWarnings = new Set<string>()
const runtimeTargetFactorySymbol = Symbol.for(
  '@use-crux/core/runtime-target-factory',
)

/** Bind an executable factory to an exported target without exposing it publicly. @internal */
export function bindRuntimeTargetFactory<TTarget extends object>(
  target: TTarget,
  factory: RegisteredRuntimeTargetFactory,
): TTarget {
  Object.defineProperty(target, runtimeTargetFactorySymbol, {
    value: factory,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return target
}

/** Read the executable factory carried by an explicitly imported target. @internal */
export function runtimeTargetFactoryFor(
  target: object,
): RegisteredRuntimeTargetFactory | undefined {
  const factory = Reflect.get(target, runtimeTargetFactorySymbol) as unknown
  return typeof factory === 'function'
    ? (factory as RegisteredRuntimeTargetFactory)
    : undefined
}

/** Register or replace a process-local runtime target factory. */
export function registerRuntimeTarget(
  targetName: string,
  factory: RegisteredRuntimeTargetFactory,
): void {
  const existing = runtimeTargets.get(targetName)
  if (
    existing &&
    existing !== factory &&
    !duplicateRuntimeTargetWarnings.has(targetName)
  ) {
    duplicateRuntimeTargetWarnings.add(targetName)
    console.warn(
      `[crux] durable target name "${targetName}" was registered more than once with different definitions; durable target names must be unique and the last registration wins.`,
    )
  }
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
