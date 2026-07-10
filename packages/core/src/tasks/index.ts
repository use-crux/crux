/**
 * `@use-crux/core/tasks` — Task primitives for AI agent work tracking.
 *
 * Re-exports task-specific APIs from the plan module. This is the canonical
 * import path for `tasks()` and `task()`.
 *
 * @module
 */

// Canonical factories
export { tasks } from '../plan/tasks'
export { task } from '../plan/task-spec'
export {
  DuplicateTaskIdError,
  InvalidTaskTransitionError,
  TaskJsonValueError,
  TaskListDiscardedError,
  TaskListNotFoundError,
  TaskNotFoundError,
  TaskRemovedError,
  TaskResultValidationError,
} from '../plan/errors'

// Helpers
export { deriveTaskListStatus } from '../plan/helpers'
export { CreationToolNotCreatedError, isCreationToolNotCreatedError } from '../types/tool'

// Types
export type {
  AddTaskInput,
  CancellableTaskStatus,
  Task,
  TaskEdit,
  TaskList,
  TaskListHandle,
  TaskListStatus,
  TaskSpec,
  TaskSpecOptions,
  TaskId,
  TaskResult,
  TaskResultSchema,
  TaskSpecRecord,
  TaskStatus,
  TasksHandle,
  TasksInput,
  TerminalTaskStatus,
} from '../plan/types'
export type {
  CreationTool,
  CreationToolNotCreatedError as CreationToolNotCreatedErrorType,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ToolDef,
} from '../types/tool'
export type { TaskListListOptions, TasksFactory } from '../plan/tasks'
export type { TasksToolOptions } from '../plan/creation-tools'
export type { TaskLifecycleError, TaskLifecycleErrorDetails, TaskLifecycleErrorName } from '../plan/errors'
