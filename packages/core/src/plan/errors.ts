/**
 * Typed task lifecycle errors for Plans & Tasks.
 *
 * Error constructors are pure factory functions that return structural `Error`
 * values. Callers can branch on `error.name` plus the stable structured fields
 * instead of matching human-readable messages.
 *
 * @module
 */

/** Stable names for task lifecycle errors. */
export type TaskLifecycleErrorName =
  | 'TaskListNotFoundError'
  | 'TaskNotFoundError'
  | 'DuplicateTaskIdError'
  | 'TaskRemovedError'
  | 'TaskListDiscardedError'
  | 'InvalidTaskTransitionError'
  | 'TaskResultValidationError'
  | 'TaskJsonValueError'

/** Common structured fields carried by task lifecycle errors. */
export interface TaskLifecycleErrorDetails {
  /** The task list involved in the failed operation. */
  readonly taskListId: string
  /** The task involved in the failed operation, when the operation targets one. */
  readonly taskId?: string
}

/** Shared structural shape for task lifecycle errors. */
export type TaskLifecycleError<TName extends TaskLifecycleErrorName = TaskLifecycleErrorName> = Error &
  TaskLifecycleErrorDetails & {
    readonly name: TName
  }

/** Structural error thrown when a task-list mutation targets a list that does not exist. */
export type TaskListNotFoundError = TaskLifecycleError<'TaskListNotFoundError'>

/** Structural error thrown when a task mutation targets a task that does not exist. */
export type TaskNotFoundError = TaskLifecycleError<'TaskNotFoundError'> & {
  readonly taskId: string
}

/** Structural error thrown when a new task would reuse an existing or removed task ID. */
export type DuplicateTaskIdError = TaskLifecycleError<'DuplicateTaskIdError'> & {
  readonly taskId: string
}

/** Structural error thrown when a task mutation targets a soft-removed task. */
export type TaskRemovedError = TaskLifecycleError<'TaskRemovedError'> & {
  readonly taskId: string
}

/** Structural error thrown when a mutation targets a discarded task list. */
export type TaskListDiscardedError = TaskLifecycleError<'TaskListDiscardedError'>

/** Structural error thrown when a task lifecycle method attempts an invalid status transition. */
export type InvalidTaskTransitionError = TaskLifecycleError<'InvalidTaskTransitionError'> & {
  readonly taskId: string
  /** The task status before the rejected transition. */
  readonly from: string
  /** The requested task status, when the operation changes status. */
  readonly to?: string
}

/** Structural error thrown when a schema-backed task result fails validation. */
export type TaskResultValidationError = TaskLifecycleError<'TaskResultValidationError'> & {
  readonly taskId: string
}

/** Structural error thrown when task data that would be persisted is not JSON-safe. */
export type TaskJsonValueError = TaskLifecycleError<'TaskJsonValueError'>

/** Build a structural task lifecycle error with stable fields. */
function taskLifecycleError<TName extends TaskLifecycleErrorName, TDetails extends TaskLifecycleErrorDetails>(
  name: TName,
  message: string,
  details: TDetails,
): TaskLifecycleError<TName> & TDetails {
  return Object.assign(Error(message), details, { name })
}

/** Create a `TaskListNotFoundError`. */
export function TaskListNotFoundError(taskListId: string): TaskListNotFoundError {
  return taskLifecycleError('TaskListNotFoundError', `Task list not found: ${taskListId}`, { taskListId })
}

/** Create a `TaskNotFoundError`. */
export function TaskNotFoundError(taskListId: string, taskId: string): TaskNotFoundError {
  return taskLifecycleError('TaskNotFoundError', `Task not found: ${taskId} in list ${taskListId}`, {
    taskListId,
    taskId,
  })
}

/** Create a `DuplicateTaskIdError`. */
export function DuplicateTaskIdError(taskListId: string, taskId: string): DuplicateTaskIdError {
  return taskLifecycleError('DuplicateTaskIdError', `Duplicate task ID: ${taskId} in list ${taskListId}`, {
    taskListId,
    taskId,
  })
}

/** Create a `TaskRemovedError`. */
export function TaskRemovedError(taskListId: string, taskId: string): TaskRemovedError {
  return taskLifecycleError('TaskRemovedError', `Task has been removed: ${taskId} in list ${taskListId}`, {
    taskListId,
    taskId,
  })
}

/** Create a `TaskListDiscardedError`. */
export function TaskListDiscardedError(taskListId: string): TaskListDiscardedError {
  return taskLifecycleError('TaskListDiscardedError', `Task list has been discarded: ${taskListId}`, { taskListId })
}

/** Create an `InvalidTaskTransitionError`. */
export function InvalidTaskTransitionError(
  taskListId: string,
  taskId: string,
  from: string,
  to?: string,
): InvalidTaskTransitionError {
  const target = to === undefined ? 'the requested state' : `"${to}"`
  return taskLifecycleError(
    'InvalidTaskTransitionError',
    `Cannot transition task ${taskId} from "${from}" to ${target}`,
    {
      taskListId,
      taskId,
      from,
      to,
    },
  )
}

/** Create a `TaskResultValidationError`. */
export function TaskResultValidationError(
  taskListId: string,
  taskId: string,
  message = 'Task result failed validation',
): TaskResultValidationError {
  return taskLifecycleError('TaskResultValidationError', message, {
    taskListId,
    taskId,
  })
}

/** Create a `TaskJsonValueError`. */
export function TaskJsonValueError(
  taskListId: string,
  taskId: string | undefined,
  message = 'Task value must be JSON-safe',
): TaskJsonValueError {
  return taskLifecycleError('TaskJsonValueError', message, {
    taskListId,
    taskId,
  })
}
