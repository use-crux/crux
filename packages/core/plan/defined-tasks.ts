/**
 * Helpers for materializing keyed `task()` definitions into task rows.
 *
 * The public `task()` helper is intentionally pure. These helpers keep the
 * persistence path separate from the larger task-list lifecycle implementation.
 *
 * @module
 */

import type { AddTaskInput, TaskResultSchema, TaskSpec, TaskSpecRecord, TasksHandle } from './types'

/** Convert a keyed task definition into the task creation input shape. */
export function taskSpecToAddInput(taskId: string, spec: TaskSpec<TaskResultSchema | undefined>): AddTaskInput {
  return {
    id: taskId,
    label: spec.label,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(spec.assignee !== undefined ? { assignee: spec.assignee } : {}),
    ...(spec.metadata !== undefined ? { metadata: spec.metadata } : {}),
  }
}

/** Persist all initial task definitions onto a newly created task ledger. */
export async function addInitialTasks(handle: TasksHandle, items: TaskSpecRecord | undefined): Promise<void> {
  if (items === undefined) return
  for (const [taskId, spec] of Object.entries(items)) {
    await handle.add(taskSpecToAddInput(taskId, spec))
  }
}
