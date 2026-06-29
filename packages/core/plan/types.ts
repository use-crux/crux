/**
 * Plan and TaskList types for `@use-crux/core/plan`.
 *
 * Plans are freeform documents describing agent intent.
 * Task lists are structured work tracking with live status updates.
 * Both persist via `CruxStore` adapters.
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Status Types
// ─────────────────────────────────────────────────────────────────

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
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/** A task list — structured work tracking linked to an optional plan. */
export interface TaskList {
  id: string
  /** Optional association with a plan. */
  planId?: string
  status: TaskListStatus
  /**
   * Inline status counters for O(1) status derivation.
   * Populated on creation; lazy-migrated on first read for existing lists.
   * @since 0.20.0
   */
  counts?: import('./status').StatusCounts
  metadata?: Record<string, unknown>
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
  /** Structured result data from the completed task. */
  result?: unknown
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
  metadata?: Record<string, unknown>
}

/** Input for `updatePlan()`. All fields optional. */
export interface PlanUpdate {
  title?: string
  content?: string
  metadata?: Record<string, unknown>
}

/** Input for `tasklist()`. */
export interface CreateTaskListInput {
  planId?: string
  metadata?: Record<string, unknown>
}

/** Input for `addTask()`. Task ID is user-provided (meaningful strings like 'research'). */
export interface CreateTaskInput {
  /** User-provided meaningful ID (e.g., 'research', 'write-intro'). */
  id: string
  label: string
  description?: string
  assignee?: { agent?: string; model?: string }
}

/** Input for `updateTask()`. */
export interface TaskUpdate {
  status?: TaskStatus
  progress?: string
  assignee?: { agent?: string; model?: string }
  result?: unknown
  error?: string
  durationMs?: number
}

// ─────────────────────────────────────────────────────────────────
// Handle Types
// ─────────────────────────────────────────────────────────────────

/** Handle for managing a plan. Returned by `plan()`. Has data snapshot + methods. */
export interface PlanHandle extends Plan {
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

/** Fluent handle for managing a task list. Returned by `tasklist()`. */
export interface TaskListHandle {
  /** The task list's ID. */
  readonly id: string
  /** Add a new task. */
  addTask(input: CreateTaskInput): Promise<Task>
  /** Update a task's status/progress/result. Triggers auto-completion evaluation. */
  updateTask(taskId: string, update: TaskUpdate): Promise<Task>
  /** Soft-delete a task. Removed tasks don't count for auto-completion. */
  removeTask(taskId: string): Promise<void>
  /** Discard the entire list. Cancels pending/in_progress tasks. */
  discard(reason?: string): Promise<void>
  /** Get all non-removed tasks. */
  getTasks(): Promise<Task[]>
  /** Get the current list status (self-heals if stale). */
  getStatus(): Promise<TaskListStatus>
  /** Create a Context that injects the task list summary into the system message. */
  asContext(options?: {
    priority?: number
    renderContext?: (tasks: Task[]) => string
  }): import('../prompt/context-types').Context<import('zod').ZodType<{}>>
  /** Returns focused tools for task list management. */
  asTools(): Record<string, import('./agent').ToolDef>
  /** Create a TaskWorker handle scoped to a specific task. */
  worker(
    taskId: string,
    options?: {
      guidelines?: string
      renderContext?: (task: Task, allTasks: Task[]) => string
    },
  ): import('./agent').TaskWorker
}
