/**
 * Plan and TaskList types for `@use-crux/core/plan`.
 *
 * Plans are freeform documents describing agent intent.
 * Task lists are structured work tracking with live status updates.
 * Both persist via configured `RecordStore` adapters.
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Status Types
// ─────────────────────────────────────────────────────────────────

import type { JsonObject, JsonValue } from '../storage'
import type { TaskCompleteArgs, TaskId, TaskSpecRecord } from './task-definition-types'

export type { JsonObject, JsonPrimitive, JsonValue } from '../storage'
export type {
  TaskCompleteArgs,
  TaskId,
  TaskResult,
  TaskResultSchema,
  TaskSpec,
  TaskSpecOptions,
  TaskSpecRecord,
} from './task-definition-types'

/** Status of a task list. */
export type TaskListStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'discarded'

/** Status of an individual task. */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled'

/** Terminal task statuses — tasks in these states won't change. */
export type TerminalTaskStatus = Extract<TaskStatus, 'completed' | 'failed' | 'skipped' | 'cancelled'>

/** Task statuses that can be cancelled on discard. */
export type CancellableTaskStatus = Extract<TaskStatus, 'pending' | 'in_progress'>

// ─────────────────────────────────────────────────────────────────
// Entity Types
// ─────────────────────────────────────────────────────────────────

/** A plan document — freeform content describing agent intent. */
export interface Plan {
  id: string
  title: string
  /** Freeform content — markdown, prose, structured notes. */
  content: string
  /** Increments on title/content changes. */
  version: number
  metadata?: JsonObject
  createdAt: number
  updatedAt: number
}

/** A task list — structured work tracking linked to an optional plan. */
export interface TaskList {
  id: string
  /** Optional association with a plan. */
  planId?: string
  /** Optional human-readable task ledger title. */
  title?: string
  status: TaskListStatus
  /**
   * Inline status counters for O(1) status derivation.
   * Populated on creation; lazy-migrated on first read for existing lists.
   * @since 0.20.0
   */
  counts?: import('./status').StatusCounts
  metadata?: JsonObject
  createdAt: number
  updatedAt: number
  /** Set when all tasks complete. */
  completedAt?: number
  /** Set when the list is discarded. */
  discardedAt?: number
  /** Reason provided when discarding. */
  discardReason?: string
}

/** An individual task within a task list. */
export interface Task {
  id: string
  taskListId: string
  label: string
  description?: string
  status: TaskStatus
  /** Human-readable progress message (e.g., "Writing section 2..."). */
  progress?: string
  /** Which agent/model is assigned to this task. */
  assignee?: { agent?: string; model?: string }
  /** User metadata stored with this task. */
  metadata?: JsonObject
  /** Structured result data from the completed task. */
  result?: JsonValue
  /** Error message if the task failed. */
  error?: string
  /** How long the task took in milliseconds. */
  durationMs?: number
  createdAt: number
  updatedAt: number
  /** Set when the task is soft-deleted via removeTask(). */
  removedAt?: number
}

// ─────────────────────────────────────────────────────────────────
// Input Types (user-facing, excludes computed fields)
// ─────────────────────────────────────────────────────────────────

/** Input for `plan()`. Only user-settable fields. */
export interface CreatePlanInput {
  title: string
  content?: string
  metadata?: JsonObject
}

/** Input for `updatePlan()`. All fields optional. */
export interface PlanUpdate {
  title?: string
  content?: string
  metadata?: JsonObject
}

/** Input for the canonical `tasks()` task-ledger factory. */
export interface TasksInput<TItems extends TaskSpecRecord | undefined = undefined> {
  /** Associate this task ledger with a plan handle or plan ID. */
  plan?: PlanHandle | string
  /** Human-readable task ledger title. */
  title?: string
  /** Initial task definitions keyed by their stable task ID. */
  items?: TItems
  metadata?: JsonObject
}

/** Input for the internal task-list creation path. */
export interface CreateTaskListInput {
  planId?: string
  title?: string
  metadata?: JsonObject
}

/** Input for `TasksHandle.add()`. Task ID is user-provided (meaningful strings like 'research'). */
export interface AddTaskInput {
  /** User-provided meaningful ID (e.g., 'research', 'write-intro'). */
  id: string
  label: string
  description?: string
  assignee?: { agent?: string; model?: string }
  metadata?: JsonObject
}

/** @internal */
export type CreateTaskInput = AddTaskInput

/** Non-status task fields that can be edited after creation. */
export interface TaskEdit {
  label?: string
  description?: string
  assignee?: { agent?: string; model?: string }
  metadata?: JsonObject
}

/** Input for `updateTask()`. */
export interface TaskUpdate {
  status?: TaskStatus
  label?: string
  description?: string
  progress?: string
  assignee?: { agent?: string; model?: string }
  metadata?: JsonObject
  result?: JsonValue
  error?: string
  durationMs?: number
}

// ─────────────────────────────────────────────────────────────────
// Handle Types
// ─────────────────────────────────────────────────────────────────

/**
 * Command handle for an existing plan.
 *
 * A plan handle intentionally contains only the stable entity ID and commands.
 * It does not embed a stale `Plan` snapshot; call `get()` when current plan
 * data is needed.
 */
export interface PlanHandle {
  /** The plan's stable ID. */
  readonly id: string
  /** Update the plan in the store. Returns the updated Plan data. */
  update(update: PlanUpdate): Promise<Plan>
  /** Re-read the latest plan from the store. */
  get(): Promise<Plan | null>
  /** Create a Context that injects plan content into the system message. */
  asContext(options?: {
    priority?: number
    mode?: 'full' | 'reference'
    renderContext?: (plan: Plan) => string
  }): import('../prompt/context-types').Context<import('zod').ZodType<{}>>
  /** Returns focused tools for plan interaction. */
  asTools(): Record<string, import('./agent').ToolDef>
}

/**
 * Command handle for a task ledger.
 *
 * Returned by `tasks()` or `tasks.ref()`. The handle carries only the stable
 * task-list ID plus commands; call `get()` or `list()` to read current data.
 */
export interface TasksHandle<TItems extends TaskSpecRecord | undefined = undefined> {
  /** The task list's ID. */
  readonly id: string
  /** Read the current task-list entity. */
  get(): Promise<TaskList | null>
  /** List tasks, excluding removed rows unless explicitly requested. */
  list(options?: { includeRemoved?: boolean }): Promise<Task[]>
  /** Read one active task by ID. Removed tasks return `null`. */
  getTask(taskId: TaskId<TItems>): Promise<Task | null>
  /** Add a new task. */
  add(input: TItems extends TaskSpecRecord ? never : AddTaskInput): Promise<Task>
  /** Edit non-status task fields. */
  edit(taskId: TaskId<TItems>, patch: TaskEdit): Promise<Task>
  /** Mark a pending task as in progress. */
  start(taskId: TaskId<TItems>): Promise<Task>
  /** Store a human-readable progress message without changing status. */
  progress(taskId: TaskId<TItems>, message: string): Promise<Task>
  /** Mark a task completed, optionally storing a result. */
  complete<TTaskId extends TaskId<TItems>>(
    taskId: TTaskId,
    ...args: TaskCompleteArgs<TItems, TTaskId>
  ): Promise<Task>
  /** Mark a task failed with an error message. */
  fail(taskId: TaskId<TItems>, error: string): Promise<Task>
  /** Mark a task skipped. */
  skip(taskId: TaskId<TItems>, reason?: string): Promise<Task>
  /** Mark a task cancelled. */
  cancel(taskId: TaskId<TItems>, reason?: string): Promise<Task>
  /** Soft-delete a task. Removed tasks don't count for auto-completion. */
  remove(taskId: TaskId<TItems>): Promise<void>
  /** Discard the entire list. Cancels pending/in_progress tasks. */
  discard(reason?: string): Promise<void>
  /** Create a Context that injects the task list summary into the system message. */
  asContext(options?: {
    priority?: number
    renderContext?: (tasks: Task[]) => string
  }): import('../prompt/context-types').Context<import('zod').ZodType<{}>>
  /** Returns focused tools for task list management. */
  asTools(): Record<string, import('./agent').ToolDef>
  /** Create a TaskWorker handle scoped to a specific task. */
  worker(
    taskId: TaskId<TItems>,
    options?: {
      guidelines?: string
      renderContext?: (task: Task, allTasks: Task[]) => string
    },
  ): import('./agent').TaskWorker
}

/** @internal */
export type TaskListHandle = TasksHandle
