/**
 * Task definition helper for canonical Plans & Tasks.
 *
 * `task()` is pure: it describes an initial task item for `tasks({ items })`
 * and never writes to storage by itself. Phase 3 deepens its schema inference;
 * this phase establishes the canonical public name and data shape.
 *
 * @module
 */

import type { TaskResultSchema, TaskSpec, TaskSpecOptions } from './types'

/**
 * Define a task item for a task ledger.
 *
 * @param label - Human-readable task label.
 * @param options - Optional description, assignment, result schema, and metadata.
 * @returns An immutable task specification.
 *
 * @example
 * ```ts
 * const research = task('Research launch channels', {
 *   description: 'Find partner and community launch options.',
 * })
 * ```
 */
export function task<const TResultSchema extends TaskResultSchema | undefined = undefined>(
  label: string,
  options: TaskSpecOptions<TResultSchema> = {},
): TaskSpec<TResultSchema> {
  return Object.freeze({
    label,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.assignee !== undefined ? { assignee: options.assignee } : {}),
    ...(options.result !== undefined ? { result: options.result } : {}),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
  })
}
