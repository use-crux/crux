/**
 * Shared runtime entry target normalization.
 *
 * Generated and hand-written runtime entries may pass concrete runtime targets
 * or lightweight `{ name }` handles. This module resolves both forms to the
 * kernel target map and fails loudly when a name cannot be materialized.
 *
 * @module
 */

import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from '../api/target-registry'
import { createRuntimeError } from '../engine/errors'
import type { RuntimeTarget, RuntimeTargetMap } from '../engine/kernel'

/** Runtime target accepted by generated, hand-written, or adapter entry files. */
export type RuntimeHandlerTarget =
  | RuntimeTarget
  | {
      /** Stable target name returned by `flow()` handles and `durableTask()`. */
      readonly name: string
    }

/** Options for resolving handler targets into a kernel map. */
export interface NormalizeRuntimeHandlerTargetsOptions {
  /** Exported `flow()` handles and `durableTask()` targets. */
  readonly targets: readonly RuntimeHandlerTarget[]
  /** Mutable runtime reference used by process-local target factories. */
  readonly runtimeRef: RuntimeTargetRuntimeRef
  /** User-facing entry label included in diagnostics. */
  readonly entry?: string
}

/** Resolve handler target declarations into the kernel's executable target map. */
export function normalizeRuntimeHandlerTargets(
  options: NormalizeRuntimeHandlerTargetsOptions,
): RuntimeTargetMap {
  const registeredTargets = runtimeTargetMap(options.runtimeRef)
  const entries: Array<[string, RuntimeTarget]> = []
  const seen = new Set<string>()
  const entry = options.entry ?? 'runtime entry'

  for (const target of options.targets) {
    const name = targetName(target)
    if (seen.has(name)) throw duplicateTargetError(name, entry)
    seen.add(name)

    const runtimeTarget = isRuntimeTarget(target)
      ? target
      : registeredTargets[name]
    if (!runtimeTarget) throw unresolvedTargetError(name, entry)
    entries.push([name, runtimeTarget])
  }

  return Object.freeze(Object.fromEntries(entries))
}

function targetName(target: RuntimeHandlerTarget): string {
  return 'name' in target ? target.name : target.targetId
}

function isRuntimeTarget(target: RuntimeHandlerTarget): target is RuntimeTarget {
  return (
    'targetId' in target &&
    'kind' in target &&
    'execute' in target &&
    typeof target.execute === 'function'
  )
}

function duplicateTargetError(name: string, entry: string): never {
  throw createRuntimeError({
    code: 'TARGET_DUPLICATE',
    whatFailed: `Runtime target \`${name}\` is declared more than once.`,
    why: `${entry} needs one stable target for each durable name.`,
    whatStillWorks:
      'Other uniquely named runtime targets can still be discovered.',
    nextStep:
      'Rename one target or remove the duplicate export before creating the runtime handler.',
  })
}

function unresolvedTargetError(name: string, entry: string): never {
  throw createRuntimeError({
    code: 'TARGET_NOT_FOUND',
    whatFailed: `Runtime target \`${name}\` could not be resolved by ${entry}.`,
    why: 'The entry received only a target name, but no process-local runtime target factory exists for that name.',
    whatStillWorks:
      'Concrete `durableTask()` targets and exported `flow()` handles in the same entry can still run.',
    nextStep:
      `Pass the exported target object for \`${name}\` directly or run \`crux runtime generate\` so the entry imports it.`,
  })
}
