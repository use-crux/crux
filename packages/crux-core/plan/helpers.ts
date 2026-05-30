/**
 * Plan/TaskList helper functions.
 *
 * Internal utilities for auto-completion logic and key conventions.
 *
 * @module
 */

import type { Task, TaskListStatus, CancellableTaskStatus } from './types'

// ─────────────────────────────────────────────────────────────────
// Key Conventions
// ─────────────────────────────────────────────────────────────────

/** @internal */
export const PLAN_PREFIX = 'plan:' as const
/** @internal */
export const TASKLIST_PREFIX = 'tasklist:' as const
/** @internal */
export const TASK_PREFIX = 'task:' as const

/** @internal */
export const planKey = (id: string) => `${PLAN_PREFIX}${id}`
/** @internal */
export const taskListKey = (id: string) => `${TASKLIST_PREFIX}${id}`
/** @internal */
export const taskKey = (listId: string, taskId: string) => `${TASK_PREFIX}${listId}:${taskId}`
/** @internal */
export const taskPrefix = (listId: string) => `${TASK_PREFIX}${listId}:`

// ─────────────────────────────────────────────────────────────────
// Auto-Completion
// ─────────────────────────────────────────────────────────────────

/** Statuses that can be cancelled on discard. */
const CANCELLABLE: ReadonlySet<string> = new Set<CancellableTaskStatus>(['pending', 'in_progress'])

/**
 * Derive a task list's status from its tasks.
 *
 * Rules:
 * - All non-removed tasks `completed` or `skipped` → `'completed'`
 * - Any task `failed` AND no tasks `in_progress` → `'failed'`
 * - All tasks removed (empty active list) → `'completed'` (no work remaining)
 * - Otherwise → `'in_progress'`
 *
 * Note: `'discarded'` status is NOT derived — it's set explicitly via `discard()`.
 *
 * @param tasks - All tasks (including removed). Removed tasks are filtered out.
 * @returns The derived TaskListStatus (never returns 'discarded' or 'pending').
 */
export function deriveTaskListStatus(tasks: Task[]): TaskListStatus {
  const active = tasks.filter((t) => !t.removedAt)

  // No active tasks = no work remaining = completed
  if (active.length === 0) return 'completed'

  const allTerminal = active.every((t) => t.status === 'completed' || t.status === 'skipped')
  if (allTerminal) return 'completed'

  const anyFailed = active.some((t) => t.status === 'failed')
  const anyInProgress = active.some((t) => t.status === 'in_progress')

  if (anyFailed && !anyInProgress) return 'failed'

  return 'in_progress'
}

/**
 * Check if a task status is cancellable (pending or in_progress).
 *
 * @internal
 */
export function isCancellable(status: string): boolean {
  return CANCELLABLE.has(status)
}
