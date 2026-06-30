/**
 * Plan/TaskList helper functions.
 *
 * Internal utilities for auto-completion logic and key conventions.
 *
 * @module
 */

import type { Task, TaskListStatus, CancellableTaskStatus, JsonValue, JsonObject } from './types'
import { deriveStatus, rebuildCounts } from './status'

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

/** Assert metadata filter keys are flat and return the original filter. @internal */
export function metadataFilter(metadata?: Record<string, JsonValue>): Record<string, JsonValue> | undefined {
  if (!metadata) return undefined
  for (const key of Object.keys(metadata)) {
    if (key.includes('.')) {
      throw new Error(`Metadata filter keys cannot contain ".": ${key}`)
    }
  }
  return metadata
}

/** Match public metadata filters without relying on nested adapter filters. @internal */
export function matchesMetadataFilter(
  metadata: JsonObject | undefined,
  filter: Record<string, JsonValue> | undefined,
): boolean {
  if (!filter) return true
  if (!metadata) return false
  return Object.entries(filter).every(([key, expected]) => jsonEqual(metadata[key], expected))
}

function jsonEqual(left: JsonValue | undefined, right: JsonValue): boolean {
  if (left === right) return true
  return JSON.stringify(left) === JSON.stringify(right)
}

// ─────────────────────────────────────────────────────────────────
// Auto-Completion
// ─────────────────────────────────────────────────────────────────

/** Statuses that can be cancelled on discard. */
const CANCELLABLE: readonly CancellableTaskStatus[] = ['pending', 'in_progress']

/**
 * Derive a task list's status from its task rows.
 *
 * Rules:
 * - Removed tasks are ignored.
 * - Empty active list -> `completed`.
 * - Otherwise, status follows the canonical counter derivation.
 *
 * `discarded` is explicit whole-list state and is never derived here.
 *
 * @param tasks - All tasks (including removed). Removed tasks are filtered out.
 * @returns The derived task-list status.
 */
export function deriveTaskListStatus(tasks: Task[]): TaskListStatus {
  return deriveStatus(rebuildCounts(tasks))
}

/**
 * Check if a task status is cancellable (pending or in_progress).
 *
 * @internal
 */
export function isCancellable(status: string): boolean {
  return CANCELLABLE.includes(status as CancellableTaskStatus)
}
