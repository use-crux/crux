/**
 * Task lifecycle assertions for Plans & Tasks.
 *
 * These helpers keep mutation code small while centralizing the state machine
 * rules that protect task-list data from invalid transitions.
 *
 * @module
 */

import type { Task, TaskList, TaskStatus, TerminalTaskStatus } from './types'
import {
  InvalidTaskTransitionError,
  TaskListDiscardedError,
  TaskListNotFoundError,
  TaskNotFoundError,
  TaskRemovedError,
} from './errors'

const TERMINAL_STATUSES: readonly TerminalTaskStatus[] = ['completed', 'failed', 'skipped', 'cancelled']

/**
 * Assert that a task list exists and accepts mutations.
 *
 * Reads are allowed on discarded lists, but all post-discard mutations must
 * fail with a typed `TaskListDiscardedError`.
 */
export function assertMutableTaskList(list: TaskList | null, taskListId: string): asserts list is TaskList {
  if (!list) throw TaskListNotFoundError(taskListId)
  if (list.status === 'discarded') throw TaskListDiscardedError(taskListId)
}

/**
 * Assert that a task exists and has not been soft-removed.
 *
 * Removed task rows remain in storage for auditability, but they are no longer
 * part of the active task API and must reject lifecycle mutations.
 */
export function assertMutableTask(task: Task | null, taskListId: string, taskId: string): asserts task is Task {
  if (!task) throw TaskNotFoundError(taskListId, taskId)
  if (task.removedAt) throw TaskRemovedError(taskListId, taskId)
}

/** Return whether a task status is terminal and immutable by default. */
export function isTerminalTaskStatus(status: TaskStatus): status is TerminalTaskStatus {
  return TERMINAL_STATUSES.includes(status as TerminalTaskStatus)
}

/**
 * Assert that a requested status update is valid for the current task status.
 *
 * `updateTask()` is the pre-beta generic mutation API, so it accepts display
 * field updates as well as lifecycle transitions. Status changes are limited to
 * the same lifecycle rules used by the focused task tools.
 */
export function assertValidTaskStatusUpdate(task: Task, nextStatus: TaskStatus | undefined): void {
  if (nextStatus === undefined || nextStatus === task.status) return

  if (isTerminalTaskStatus(task.status)) {
    throw InvalidTaskTransitionError(task.taskListId, task.id, task.status, nextStatus)
  }

  if (task.status === 'pending') {
    return
  }

  if (task.status === 'in_progress' && nextStatus !== 'pending') {
    return
  }

  throw InvalidTaskTransitionError(task.taskListId, task.id, task.status, nextStatus)
}
