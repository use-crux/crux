/**
 * Runtime durable task target factory.
 *
 * `durableTask()` defines executable durable targets for Runtime Engine work
 * such as `flow.defer()` and `flow.after()`. It is intentionally separate from
 * the root `@use-crux/core` Plans & Tasks ledger `task()`, which describes plan
 * items and is not executable runtime work.
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
import { observe } from '../../observability'
import { taskDefinitionRef } from '../../observability/definition-ref'
import { registerRuntimeTarget } from './target-registry'

const RUNTIME_TASK_TARGET: unique symbol = Symbol('crux.runtime.task')

/** Context passed to a durable task target while a wake is leased. */
export interface RuntimeTaskContext {
  /** Leased runtime target context for advanced inspection. */
  readonly runtime: RuntimeTargetContext
  /** Lease proving this worker owns the task attempt. */
  readonly lease: Lease
}

/** Options for defining an executable durable task target. */
export interface RuntimeTaskOptions<TInput extends JsonValue = JsonValue> {
  /** Execute the durable task with JSON input persisted in the runtime store. */
  run(input: TInput, context: RuntimeTaskContext): Promise<unknown> | unknown
}

/**
 * Executable durable Runtime Engine task target.
 *
 * Values of this type can be passed to future `createRuntimeHandler({
 * targets })` artifacts and to `flow.defer()` / `flow.after()`. Plan ledger
 * task specs from the package root are deliberately not assignable.
 */
export interface RuntimeTaskTarget<TInput extends JsonValue = JsonValue> extends RuntimeTarget {
  /** Type-only brand that distinguishes durable tasks from plan ledger tasks. */
  readonly [RUNTIME_TASK_TARGET]: {
    readonly input: TInput
  }
  /** Durable task target name. */
  readonly name: string
  /** Runtime task targets always execute task work. */
  readonly kind: 'task'
}

/** Extract the input payload type accepted by a durable task target. */
export type RuntimeTaskInput<TTarget> = TTarget extends RuntimeTaskTarget<infer TInput>
  ? TInput
  : never

/**
 * Define an executable durable task target.
 *
 * Import this factory from `@use-crux/core/runtime`:
 *
 * ```ts
 * import { durableTask, type RuntimeTaskContext } from '@use-crux/core/runtime'
 *
 * export const embedDocument = durableTask('embed-document', {
 *   run: async (input: { documentId: string }, context: RuntimeTaskContext) => {
 *     void context.lease
 *     const { documentId } = input
 *     await embed(documentId)
 *   },
 * })
 * ```
 *
 * The package root also exports a Plans & Tasks ledger `task()` for plan item
 * definitions. That factory is intentionally unrelated and cannot be passed to
 * runtime APIs such as `flow.defer()`.
 */
export function durableTask<const TName extends string, TInput extends JsonValue = JsonValue>(
  name: TName,
  options: RuntimeTaskOptions<TInput>,
): RuntimeTaskTarget<TInput> {
  const targetId = name as unknown as RuntimeTargetId
  const target: RuntimeTaskTarget<TInput> = Object.freeze({
    name,
    targetId,
    kind: 'task' as const,
    [RUNTIME_TASK_TARGET]: undefined as unknown as {
      readonly input: TInput
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
      const work = context.work.work
      // `durableTask()` requires `name`, so this ref is always canonical.
      // `openSpan` opens an implicit run when no ambient context exists (a
      // fresh serverless/edge invocation delivering a wake), so this is safe
      // without any host-specific wiring.
      const span = observe.openSpan({
        name: 'task.operation',
        primitive: 'task.operation',
        definitionRefs: [taskDefinitionRef(name)],
        attributes: {
          taskName: name,
          taskId: work.taskId,
          workId: context.work.workId,
          attempt: context.work.attempt,
        },
      })
      try {
        await span.withContext(() =>
          options.run(work.input as TInput, {
            runtime: context,
            lease: context.lease,
          }),
        )
        span.end({ attributes: { status: 'success' } })
        return { status: 'completed' }
      } catch (error) {
        span.error(error, { status: 'error' })
        throw error
      }
    },
  }) as RuntimeTaskTarget<TInput>
  registerRuntimeTarget(name, () => target)
  return target
}
