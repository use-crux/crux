/**
 * Task definition helper for canonical Plans & Tasks.
 *
 * `task()` is pure: it describes an initial task item for `tasks({ items })`
 * and never writes to storage by itself. When a result schema is provided,
 * completion payloads are inferred from that schema and validated before they
 * are persisted.
 *
 * @module
 */

import type { TaskResultSchema, TaskSpec, TaskSpecOptions } from './types'

/**
 * Define a task item for a task ledger.
 *
 * Use `task()` when task IDs are known ahead of time and callers should get
 * type-safe IDs plus schema-backed completion results from `tasks({ items })`.
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
