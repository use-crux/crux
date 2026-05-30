/**
 * Pure-function status machine for task lists.
 *
 * Derives TaskListStatus from counter sets in O(1)
 * instead of scanning all tasks on every mutation.
 *
 * @module
 */

import type { TaskStatus, TaskListStatus } from './types'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Counts of active (non-removed) tasks by status. Stored on the TaskList. */
export interface StatusCounts {
  readonly pending: number
  readonly in_progress: number
  readonly completed: number
  readonly failed: number
  readonly skipped: number
  readonly cancelled: number
}

/** Describes a task mutation's effect on status counts. */
export type StatusDelta =
  | { readonly type: 'add' }
  | { readonly type: 'update'; readonly from: TaskStatus; readonly to: TaskStatus }
  | { readonly type: 'remove'; readonly status: TaskStatus }

// ─────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────

/** Create a zero-initialized counter set. */
export function emptyCounts(): StatusCounts {
  return {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  }
}

/**
 * Derive TaskListStatus from counters. Pure, O(1).
 *
 * Rules (identical to the previous `deriveTaskListStatus` but on integers):
 * - All counts zero → 'completed' (no active work remaining)
 * - completed + skipped === total → 'completed'
 * - failed > 0 AND in_progress === 0 → 'failed'
 * - Otherwise → 'in_progress'
 *
 * Note: 'discarded' and 'pending' are never derived — set explicitly.
 */
export function deriveStatus(counts: StatusCounts): TaskListStatus {
  const total =
    counts.pending + counts.in_progress + counts.completed + counts.failed + counts.skipped + counts.cancelled

  if (total === 0) return 'completed'
  if (counts.completed + counts.skipped === total) return 'completed'
  if (counts.failed > 0 && counts.in_progress === 0) return 'failed'

  return 'in_progress'
}

/**
 * Apply a delta to a counter set. Returns a new object (no mutation). Pure, O(1).
 *
 * - `add`: new task always starts as 'pending'
 * - `update`: decrement `from`, increment `to`
 * - `remove`: decrement the task's current status
 *
 * Counts are clamped to >= 0 to prevent drift from going negative.
 */
export function applyCounts(counts: StatusCounts, delta: StatusDelta): StatusCounts {
  const next = { ...counts }

  switch (delta.type) {
    case 'add':
      next.pending = next.pending + 1
      break

    case 'update':
      next[delta.from] = Math.max(0, next[delta.from] - 1)
      next[delta.to] = next[delta.to] + 1
      break

    case 'remove':
      next[delta.status] = Math.max(0, next[delta.status] - 1)
      break
  }

  return next
}

/**
 * Rebuild counters from a full task array.
 *
 * Used for self-healing when counters may have drifted,
 * and for lazy migration of existing TaskLists without counts.
 */
export function rebuildCounts(tasks: ReadonlyArray<{ status: TaskStatus; removedAt?: number }>): StatusCounts {
  const counts = emptyCounts() as Record<TaskStatus, number>

  for (const task of tasks) {
    if (!task.removedAt) {
      counts[task.status] = (counts[task.status] ?? 0) + 1
    }
  }

  return counts as unknown as StatusCounts
}
