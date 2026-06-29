/**
 * `@use-crux/core/tasks` — Task list primitives for AI agent work tracking.
 *
 * Re-exports task-specific APIs from the plan module.
 * This provides the canonical `@use-crux/core/tasks` import path.
 *
 * @module
 */

// TaskList lifecycle
export { tasklist, getTaskList, getTaskListByPlan, createHandle } from '../plan/tasks'
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

// Agent integration
export { taskListAgent, taskWorker, createTaskListTool } from '../plan/agent'

// Helpers
export { deriveTaskListStatus } from '../plan/helpers'

// Types
export type {
  TaskList,
  TaskListStatus,
  TaskListHandle,
  CreateTaskListInput,
  Task,
  TaskStatus,
  TaskUpdate,
  CreateTaskInput,
  TerminalTaskStatus,
  CancellableTaskStatus,
} from '../plan/types'
export type { TaskLifecycleError, TaskLifecycleErrorDetails, TaskLifecycleErrorName } from '../plan/errors'

export type { TaskListAgent, TaskListAgentOptions, TaskWorker, TaskWorkerOptions } from '../plan/agent'
