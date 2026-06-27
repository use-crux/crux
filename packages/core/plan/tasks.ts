/**
 * TaskList lifecycle and task management functions.
 *
 * Task lists track structured work items with live status updates.
 * Auto-completion evaluates list status after every task mutation.
 * Self-healing corrects stale status on read.
 *
 * @module
 */

import type { JsonObject } from '../store/types'
import type {
  Task,
  TaskList,
  TaskListHandle,
  TaskListStatus,
  CreateTaskInput,
  CreateTaskListInput,
  TaskUpdate,
} from './types'
import { taskListKey, taskKey, taskPrefix, deriveTaskListStatus, isCancellable } from './helpers'
import { emptyCounts, applyCounts, deriveStatus, rebuildCounts } from './status'
import type { StatusCounts } from './status'
import { getRuntime, resolveStore } from '../runtime/runtime'
import { observe } from '../observability'
import { getExecutionContext } from '../runtime/execution-context'
import { taskListAgent, taskWorker } from './agent'

/**
 * Create a task list and return a handle for managing tasks.
 *
 * The list is persisted immediately with status `'pending'`.
 * No lazy creation — avoids race conditions from concurrent `addTask()` calls.
 *
 * @param input - Optional planId association and metadata.
 * @returns A `TaskListHandle` for fluent task management.
 *
 * @example
 * ```ts
 * const taskList = await tasklist({ planId: plan.id })
 * await taskList.addTask({ id: 'research', label: 'Research sources' })
 * await taskList.updateTask('research', { status: 'completed' })
 * ```
 */
export async function tasklist(input: CreateTaskListInput): Promise<TaskListHandle> {
  const span = observe.openSpan({
    name: 'tasklist.create',
    family: 'task',
    primitive: 'task.operation',
    attributes: {
      operation: 'tasklist.create',
      planId: input.planId,
      metadataKeys: input.metadata ? Object.keys(input.metadata).sort() : [],
    },
  })
  const store = resolveStore()
  const now = Date.now()
  const id = crypto.randomUUID()

  const list: TaskList = {
    id,
    planId: input.planId,
    status: 'pending',
    counts: emptyCounts(),
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await span.withContext(async () => {
      await store.set(taskListKey(id), list as unknown as JsonObject)
      emitTaskArtifact(span.spanId, 'tasklist.create', list)
    })
    const ctx = getExecutionContext()
    getRuntime().instrumentationHooks?.onTaskListCreated?.({
      taskListId: id,
      planId: input.planId,
      traceId: ctx?.traceId,
    })
    span.end({
      operation: 'tasklist.create',
      taskListId: id,
      planId: input.planId,
      status: list.status,
      traceId: ctx?.traceId,
    })
    return createHandle(id)
  } catch (error) {
    span.error(error, { operation: 'tasklist.create', planId: input.planId })
    throw error
  }
}

/**
 * Get a task list by ID. Self-heals stale status.
 *
 * @param taskListId - The task list's ID.
 * @returns The task list with correct derived status, or `null` if not found.
 */
export async function getTaskList(taskListId: string): Promise<TaskList | null> {
  const store = resolveStore()
  const raw = await store.get(taskListKey(taskListId))
  if (!raw) return null

  const list = raw as unknown as TaskList

  // Self-heal: if status is not 'discarded', verify it matches derived status
  if (list.status !== 'discarded') {
    // Lazy-migrate counters if missing
    if (!list.counts) {
      const tasks = await getAllTasks(taskListId)
      if (tasks.length > 0) {
        list.counts = rebuildCounts(tasks)
        const derived = deriveStatus(list.counts)
        if (derived !== list.status) {
          list.status = derived
          if (derived === 'completed' && !list.completedAt) {
            list.completedAt = Date.now()
          }
        }
        list.updatedAt = Date.now()
        await store.set(taskListKey(taskListId), list as unknown as JsonObject)
      }
    }
  }

  return list
}

/**
 * Find a task list associated with a plan.
 *
 * @param planId - The plan's ID.
 * @returns The first task list with this planId, or `null`.
 */
export async function getTaskListByPlan(planId: string): Promise<TaskList | null> {
  const store = resolveStore()
  const result = await store.list('tasklist:', { filter: { planId } })
  if (result.entries.length === 0) return null

  const list = result.entries[0].value as unknown as TaskList
  return list
}

// ─────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────

/** Get all tasks (including removed) for a task list. */
async function getAllTasks(taskListId: string): Promise<Task[]> {
  const store = resolveStore()
  const result = await store.list(taskPrefix(taskListId))
  return result.entries.map((e) => e.value as unknown as Task)
}

/** Get active (non-removed) tasks for a task list. */
async function getActiveTasks(taskListId: string): Promise<Task[]> {
  const all = await getAllTasks(taskListId)
  return all.filter((t) => !t.removedAt)
}

/**
 * Ensure counts exist on a task list (lazy migration for pre-counter data).
 * Returns the counts, rebuilding from a full scan if needed.
 */
async function ensureCounts(taskListId: string, list: TaskList): Promise<StatusCounts> {
  if (list.counts) return list.counts
  // Lazy migration: rebuild from full scan (one-time O(n) per list)
  const tasks = await getAllTasks(taskListId)
  const counts = rebuildCounts(tasks)
  list.counts = counts
  return counts
}

/**
 * Apply a counter delta and update the task list status.
 * O(1) — no full task scan. Verifies terminal transitions with a full scan.
 */
async function applyStatusDelta(taskListId: string, delta: Parameters<typeof applyCounts>[1]): Promise<void> {
  const store = resolveStore()
  const rawList = await store.get(taskListKey(taskListId))
  if (!rawList) return

  const list = rawList as unknown as TaskList
  if (list.status === 'discarded') return

  const currentCounts = await ensureCounts(taskListId, list)
  let newCounts = applyCounts(currentCounts, delta)
  const derived = deriveStatus(newCounts)

  // Terminal transitions (completed/failed): verify with full scan
  if ((derived === 'completed' || derived === 'failed') && derived !== list.status) {
    const tasks = await getAllTasks(taskListId)
    newCounts = rebuildCounts(tasks)
  }

  list.counts = newCounts
  const newStatus = deriveStatus(newCounts)

  if (newStatus !== list.status) {
    const previousStatus = list.status
    list.status = newStatus
    if (newStatus === 'completed' && !list.completedAt) {
      list.completedAt = Date.now()
    }
    list.updatedAt = Date.now()
    await store.set(taskListKey(taskListId), list as unknown as JsonObject)

    if (newStatus === 'completed' && previousStatus !== 'completed') {
      const total =
        newCounts.pending +
        newCounts.in_progress +
        newCounts.completed +
        newCounts.failed +
        newCounts.skipped +
        newCounts.cancelled
      const ctx = getExecutionContext()
      getRuntime().instrumentationHooks?.onTaskListCompleted?.({
        taskListId,
        totalTasks: total,
        durationMs: list.completedAt! - list.createdAt,
        traceId: ctx?.traceId,
      })
    }
  } else {
    // Counts changed but status didn't — still persist counts
    list.counts = newCounts
    list.updatedAt = Date.now()
    await store.set(taskListKey(taskListId), list as unknown as JsonObject)
  }
}

/** Create a TaskListHandle for a given task list ID. @internal */
export function createHandle(taskListId: string): TaskListHandle {
  return {
    id: taskListId,

    async addTask(input: CreateTaskInput): Promise<Task> {
      const span = observe.openSpan({
        name: 'task.add',
        family: 'task',
        primitive: 'task.operation',
        attributes: {
          operation: 'add',
          taskListId,
          taskId: input.id,
          label: input.label,
          assignee: input.assignee,
        },
      })
      const store = resolveStore()
      const now = Date.now()
      const task: Task = {
        id: input.id,
        taskListId,
        label: input.label,
        description: input.description,
        status: 'pending',
        assignee: input.assignee,
        createdAt: now,
        updatedAt: now,
      }

      try {
        await span.withContext(async () => {
          await store.set(taskKey(taskListId, input.id), task as unknown as JsonObject)
          emitTaskArtifact(span.spanId, 'add', task)
        })
        const ctx = getExecutionContext()
        getRuntime().instrumentationHooks?.onTaskAdded?.({
          taskListId,
          taskId: task.id,
          label: task.label,
          assignee: task.assignee,
          traceId: ctx?.traceId,
        })
        await applyStatusDelta(taskListId, { type: 'add' })
        span.end({ operation: 'add', taskListId, taskId: task.id, status: task.status, traceId: ctx?.traceId })
        return task
      } catch (error) {
        span.error(error, { operation: 'add', taskListId, taskId: input.id })
        throw error
      }
    },

    async updateTask(taskId: string, update: TaskUpdate): Promise<Task> {
      const span = observe.openSpan({
        name: 'task.update',
        family: 'task',
        primitive: 'task.operation',
        attributes: {
          operation: 'update',
          taskListId,
          taskId,
          nextStatus: update.status,
          hasResult: update.result !== undefined,
          hasError: update.error !== undefined,
        },
      })
      const store = resolveStore()
      try {
        const raw = await store.get(taskKey(taskListId, taskId))
        if (!raw) {
          throw new Error(`Task not found: ${taskId} in list ${taskListId}`)
        }

        const task = raw as unknown as Task
        const updated: Task = {
          ...task,
          ...(update.status !== undefined && { status: update.status }),
          ...(update.progress !== undefined && { progress: update.progress }),
          ...(update.assignee !== undefined && { assignee: update.assignee }),
          ...(update.result !== undefined && { result: update.result }),
          ...(update.error !== undefined && { error: update.error }),
          ...(update.durationMs !== undefined && {
            durationMs: update.durationMs,
          }),
          updatedAt: Date.now(),
        }

        await span.withContext(async () => {
          await store.set(taskKey(taskListId, taskId), updated as unknown as JsonObject)
          emitTaskArtifact(span.spanId, 'update', updated)
        })
        const ctx = getExecutionContext()
        getRuntime().instrumentationHooks?.onTaskUpdated?.({
          taskListId,
          taskId,
          status: updated.status,
          progress: updated.progress,
          durationMs: updated.durationMs,
          traceId: ctx?.traceId,
        })
        if (update.status !== undefined && update.status !== task.status) {
          await applyStatusDelta(taskListId, {
            type: 'update',
            from: task.status,
            to: update.status,
          })
        }
        span.end({
          operation: 'update',
          taskListId,
          taskId,
          status: updated.status,
          progress: updated.progress,
          durationMs: updated.durationMs,
          traceId: ctx?.traceId,
        })
        return updated
      } catch (error) {
        span.error(error, { operation: 'update', taskListId, taskId, nextStatus: update.status })
        throw error
      }
    },

    async removeTask(taskId: string): Promise<void> {
      const span = observe.openSpan({
        name: 'task.remove',
        family: 'task',
        primitive: 'task.operation',
        attributes: {
          operation: 'remove',
          taskListId,
          taskId,
        },
      })
      const store = resolveStore()
      try {
        const raw = await store.get(taskKey(taskListId, taskId))
        if (!raw) {
          span.end({ operation: 'remove', taskListId, taskId, removed: false, reason: 'not_found' })
          return
        }

        const task = raw as unknown as Task
        if (task.removedAt) {
          span.end({
            operation: 'remove',
            taskListId,
            taskId,
            removed: false,
            reason: 'already_removed',
            previousStatus: task.status,
          })
          return
        }
        const previousStatus = task.status
        task.removedAt = Date.now()
        task.updatedAt = Date.now()
        await span.withContext(async () => {
          await store.set(taskKey(taskListId, taskId), task as unknown as JsonObject)
          emitTaskArtifact(span.spanId, 'remove', task)
        })
        const ctx = getExecutionContext()
        getRuntime().instrumentationHooks?.onTaskRemoved?.({
          taskListId,
          taskId,
          traceId: ctx?.traceId,
        })
        await applyStatusDelta(taskListId, { type: 'remove', status: previousStatus })
        span.end({
          operation: 'remove',
          taskListId,
          taskId,
          removed: true,
          previousStatus,
          traceId: ctx?.traceId,
        })
      } catch (error) {
        span.error(error, { operation: 'remove', taskListId, taskId })
        throw error
      }
    },

    async discard(reason?: string): Promise<void> {
      const span = observe.openSpan({
        name: 'tasklist.discard',
        family: 'task',
        primitive: 'task.operation',
        attributes: {
          operation: 'tasklist.discard',
          taskListId,
          hasReason: reason !== undefined,
          reasonPreview: reason?.slice(0, 500),
        },
      })
      const store = resolveStore()
      try {
        const rawList = await store.get(taskListKey(taskListId))
        if (!rawList) {
          span.end({ operation: 'tasklist.discard', taskListId, discarded: false, reason: 'not_found' })
          return
        }

        const now = Date.now()
        const list = rawList as unknown as TaskList
        list.status = 'discarded'
        list.discardedAt = now
        list.discardReason = reason
        list.updatedAt = now
        await span.withContext(async () => {
          await store.set(taskListKey(taskListId), list as unknown as JsonObject)
          emitTaskArtifact(span.spanId, 'tasklist.discard', list)
        })

        // Cancel pending/in_progress tasks
        const tasks = await getAllTasks(taskListId)
        const activeTasks = tasks.filter((t) => !t.removedAt)
        const completedCount = activeTasks.filter((t) => t.status === 'completed').length
        const remainingCount = activeTasks.filter((t) => isCancellable(t.status)).length

        for (const task of tasks) {
          if (!task.removedAt && isCancellable(task.status)) {
            task.status = 'cancelled'
            task.updatedAt = now
            await store.set(taskKey(taskListId, task.id), task as unknown as JsonObject)
          }
        }

        const ctx = getExecutionContext()
        getRuntime().instrumentationHooks?.onTaskListDiscarded?.({
          taskListId,
          reason,
          completedCount,
          remainingCount,
          traceId: ctx?.traceId,
        })
        span.end({
          operation: 'tasklist.discard',
          taskListId,
          discarded: true,
          completedCount,
          remainingCount,
          traceId: ctx?.traceId,
        })
      } catch (error) {
        span.error(error, { operation: 'tasklist.discard', taskListId })
        throw error
      }
    },

    async getTasks(): Promise<Task[]> {
      return getActiveTasks(taskListId)
    },

    async getStatus(): Promise<TaskListStatus> {
      const store = resolveStore()
      const rawList = await store.get(taskListKey(taskListId))
      if (!rawList) return 'pending'

      const list = rawList as unknown as TaskList

      // Discarded is explicit — don't override
      if (list.status === 'discarded') return 'discarded'

      // Use counters if available (O(1))
      if (list.counts) {
        const total =
          list.counts.pending +
          list.counts.in_progress +
          list.counts.completed +
          list.counts.failed +
          list.counts.skipped +
          list.counts.cancelled
        // Empty list with pending status is valid (no tasks added yet)
        if (total === 0) return list.status

        const derived = deriveStatus(list.counts)
        // Self-heal if stored status is stale
        if (derived !== list.status) {
          list.status = derived
          if (derived === 'completed' && !list.completedAt) {
            list.completedAt = Date.now()
          }
          list.updatedAt = Date.now()
          await store.set(taskListKey(taskListId), list as unknown as JsonObject)
        }
        return derived
      }

      // Fallback for pre-counter data: full scan + lazy migration
      const tasks = await getAllTasks(taskListId)
      if (tasks.length === 0) return list.status

      const derived = deriveTaskListStatus(tasks)

      // Self-heal and migrate to counters
      list.counts = rebuildCounts(tasks)
      if (derived !== list.status) {
        list.status = derived
        if (derived === 'completed' && !list.completedAt) {
          list.completedAt = Date.now()
        }
      }
      list.updatedAt = Date.now()
      await store.set(taskListKey(taskListId), list as unknown as JsonObject)

      return derived
    },

    asContext(options?: { priority?: number; renderContext?: (tasks: Task[]) => string }) {
      const agent = taskListAgent(taskListId, {
        renderContext: options?.renderContext,
      })
      return agent.asContext({ priority: options?.priority })
    },

    asTools() {
      const agent = taskListAgent(taskListId)
      return agent.asTools()
    },

    worker(
      taskId: string,
      options?: {
        guidelines?: string
        renderContext?: (task: Task, allTasks: Task[]) => string
      },
    ) {
      return taskWorker(taskListId, taskId, options)
    },
  }
}

function emitTaskArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  operation: string,
  value: Task | TaskList,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: taskArtifactPreview(operation, value),
    attributes: taskArtifactAttributes(operation, value),
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: taskArtifactAttributes(operation, value),
  })
}

function taskArtifactPreview(operation: string, value: Task | TaskList): JsonObject {
  if ('taskListId' in value) {
    return {
      primitive: 'task.operation',
      operation,
      taskListId: value.taskListId,
      taskId: value.id,
      label: value.label,
      status: value.status,
      progress: value.progress,
      assignee: value.assignee as JsonObject | undefined,
      resultPreview: value.result === undefined ? undefined : String(value.result).slice(0, 500),
      errorPreview: value.error === undefined ? undefined : String(value.error).slice(0, 500),
    }
  }
  return {
    primitive: 'task.operation',
    operation,
    taskListId: value.id,
    planId: value.planId,
    status: value.status,
    counts: value.counts as JsonObject | undefined,
    metadata: value.metadata,
  }
}

function taskArtifactAttributes(operation: string, value: Task | TaskList): JsonObject {
  if ('taskListId' in value) {
    return {
      primitive: 'task.operation',
      operation,
      taskListId: value.taskListId,
      taskId: value.id,
      status: value.status,
      hasResult: value.result !== undefined,
      hasError: value.error !== undefined,
    }
  }
  return {
    primitive: 'task.operation',
    operation,
    taskListId: value.id,
    planId: value.planId,
    status: value.status,
  }
}
