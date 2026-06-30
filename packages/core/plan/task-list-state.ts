/**
 * Task-list row reads and read-model repair.
 *
 * Task rows are the source of truth for active work. The task-list `counts`
 * field is cache data and is rebuilt here after mutations and on reads.
 *
 * @module
 */

import type { JsonObject, RecordStore } from '../storage'
import { taskListKey, taskPrefix } from './helpers'
import { deriveStatus, rebuildCounts } from './status'
import type { StatusCounts } from './status'
import type { Task, TaskList, TaskListStatus } from './types'

/** Get all task rows, including soft-removed tasks, for a task list. */
export async function getAllTasks(store: RecordStore, taskListId: string): Promise<Task[]> {
  const result = await store.list(taskPrefix(taskListId))
  return result.entries.map((entry) => entry.value as unknown as Task)
}

/** Get active task rows for a task list. */
export async function getActiveTasks(store: RecordStore, taskListId: string): Promise<Task[]> {
  const tasks = await getAllTasks(store, taskListId)
  return tasks.filter((task) => !task.removedAt)
}

/** Return whether two count snapshots differ. */
function countsChanged(previous: StatusCounts | undefined, next: StatusCounts): boolean {
  return (
    !previous ||
    previous.pending !== next.pending ||
    previous.in_progress !== next.in_progress ||
    previous.completed !== next.completed ||
    previous.failed !== next.failed ||
    previous.skipped !== next.skipped ||
    previous.cancelled !== next.cancelled
  )
}

/** Derive status from task rows while preserving the empty-new-list `pending` state. */
function deriveStatusFromTaskRows(list: TaskList, tasks: readonly Task[], counts: StatusCounts): TaskListStatus {
  if (tasks.length === 0 && list.status === 'pending') return 'pending'
  return deriveStatus(counts)
}

/**
 * Rebuild the task-list read model from task rows.
 *
 * Stored counts are cache data. This repair path is used after mutations and on
 * reads so stale counters cannot override visible task rows.
 */
export async function repairTaskListState(
  store: RecordStore,
  taskListId: string,
): Promise<TaskList | null> {
  const rawList = await store.get(taskListKey(taskListId))
  if (!rawList) return null

  const list = rawList as unknown as TaskList
  if (list.status === 'discarded') return list

  const tasks = await getAllTasks(store, taskListId)
  const counts = rebuildCounts(tasks)
  const status = deriveStatusFromTaskRows(list, tasks, counts)
  const completedAt = status === 'completed' ? (list.completedAt ?? Date.now()) : undefined
  const shouldPersist = status !== list.status || countsChanged(list.counts, counts) || completedAt !== list.completedAt

  const nextList: TaskList = shouldPersist
    ? taskListWithDerivedState(list, status, counts, completedAt)
    : list

  if (shouldPersist) {
    await store.put(taskListKey(taskListId), nextList as unknown as JsonObject)
  }

  return nextList
}

function taskListWithDerivedState(
  list: TaskList,
  status: TaskListStatus,
  counts: StatusCounts,
  completedAt: number | undefined,
): TaskList {
  const { completedAt: _previousCompletedAt, ...rest } = list
  return {
    ...rest,
    status,
    counts,
    ...(completedAt !== undefined ? { completedAt } : {}),
    updatedAt: Date.now(),
  }
}
