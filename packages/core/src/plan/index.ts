/**
 * `@use-crux/core/plan` — Plan and Tasks primitives for AI agent work tracking.
 *
 * Plans are freeform documents describing what an agent intends to do.
 * Task lists are structured work tracking with live status updates.
 * Both persist via configured `RecordStore` adapters.
 *
 * @module
 */

// Canonical factories
export { plan } from './plans'
export { tasks } from './tasks'
export { task } from './task-spec'

export {
  DuplicateTaskIdError,
  InvalidTaskTransitionError,
  TaskJsonValueError,
  TaskListDiscardedError,
  TaskListNotFoundError,
  TaskNotFoundError,
  TaskRemovedError,
  TaskResultValidationError,
} from './errors'

// Helpers
export { deriveTaskListStatus } from './helpers'
export { CreationToolNotCreatedError, isCreationToolNotCreatedError } from '../types/tool'

// Types
export type {
  AddTaskInput,
  CreatePlanInput,
  CancellableTaskStatus,
  Plan,
  PlanHandle,
  PlanUpdate,
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
} from './types'
export type {
  CreationTool,
  CreationToolNotCreatedError as CreationToolNotCreatedErrorType,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ToolDef,
} from '../types/tool'
export type { PlanFactory, PlanListOptions } from './plans'
export type { TaskListListOptions, TasksFactory } from './tasks'
export type { PlanToolOptions, TasksToolOptions } from './creation-tools'
export type { TaskLifecycleError, TaskLifecycleErrorDetails, TaskLifecycleErrorName } from './errors'
