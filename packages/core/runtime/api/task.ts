/**
 * Runtime durable task target factory.
 *
 * This `task()` lives only on `@use-crux/core/runtime`. It defines executable
 * durable targets for Runtime Engine work such as `flow.defer()` and
 * `flow.after()`. It is intentionally separate from the root
 * `@use-crux/core` Plans & Tasks ledger `task()`, which describes plan items
 * and is not executable runtime work.
 *
 * @module
 */

import type { JsonValue } from '../../storage'
import type { Lease } from '../ports/leases'
import type { RuntimeTargetId } from '../ports/ids'
import type {
  RuntimeTarget,
  RuntimeTargetContext,
  RuntimeTargetOutcome,
} from '../engine/kernel'
import { registerRuntimeTarget } from './target-registry'

const RUNTIME_TASK_TARGET: unique symbol = Symbol('crux.runtime.task')

/** Context passed to a runtime task target while a wake is leased. */
export interface RuntimeTaskContext {
  /** Leased runtime target context for advanced inspection. */
  readonly runtime: RuntimeTargetContext
  /** Lease proving this worker owns the task attempt. */
  readonly lease: Lease
}

/** Options for defining an executable durable runtime task target. */
export interface RuntimeTaskOptions<
  TInput extends JsonValue = JsonValue,
  TOutput = unknown,
> {
  /** Execute the durable task with JSON input persisted in the runtime store. */
  run(input: TInput, context: RuntimeTaskContext): Promise<TOutput> | TOutput
}

/**
 * Executable durable Runtime Engine task target.
 *
 * Values of this type can be passed to future `createRuntimeHandler({
 * targets })` artifacts and to `flow.defer()` / `flow.after()`. Plan ledger
 * task specs from the package root are deliberately not assignable.
 */
export interface RuntimeTaskTarget<
  TInput extends JsonValue = JsonValue,
  TOutput = unknown,
> extends RuntimeTarget {
  /** Type-only brand that distinguishes runtime tasks from plan ledger tasks. */
  readonly [RUNTIME_TASK_TARGET]: {
    readonly input: TInput
    readonly output: TOutput
  }
  /** Durable task target name. */
  readonly name: string
  /** Runtime task targets always execute task work. */
  readonly kind: 'task'
}

/** Extract the input payload type accepted by a runtime task target. */
export type RuntimeTaskInput<TTarget> = TTarget extends RuntimeTaskTarget<
  infer TInput,
  unknown
>
  ? TInput
  : never

/**
 * Define an executable durable runtime task target.
 *
 * Import this factory from `@use-crux/core/runtime`:
 *
 * ```ts
 * import { task } from '@use-crux/core/runtime'
 *
 * export const embedDocument = task('embed-document', {
 *   run: async ({ documentId }) => {
 *     await embed(documentId)
 *   },
 * })
 * ```
 *
 * The package root also exports a Plans & Tasks ledger `task()` for plan item
 * definitions. That factory is intentionally unrelated and cannot be passed to
 * runtime APIs such as `flow.defer()`.
 */
export function task<
  const TName extends string,
  TInput extends JsonValue = JsonValue,
  TOutput = unknown,
>(
  name: TName,
  options: RuntimeTaskOptions<TInput, TOutput>,
): RuntimeTaskTarget<TInput, TOutput> {
  const targetId = name as unknown as RuntimeTargetId
  const target: RuntimeTaskTarget<TInput, TOutput> = Object.freeze({
    name,
    targetId,
    kind: 'task' as const,
    [RUNTIME_TASK_TARGET]: undefined as unknown as {
      readonly input: TInput
      readonly output: TOutput
    },
    async execute(context: RuntimeTargetContext): Promise<RuntimeTargetOutcome> {
      if (context.work.work.kind !== 'task.run') {
        return {
          status: 'blocked',
          error: {
            code: 'TARGET_NOT_FOUND',
            message: `Runtime task \`${name}\` received work kind \`${context.work.work.kind}\`.`,
            at: new Date(),
          },
        }
      }
      await options.run(context.work.work.input as TInput, {
        runtime: context,
        lease: context.lease,
      })
      return { status: 'completed' }
    },
  }) as RuntimeTaskTarget<TInput, TOutput>
  registerRuntimeTarget(name, () => target)
  return target
}
