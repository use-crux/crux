/**
 * Task-ledger lifecycle and task management functions.
 *
 * Task lists track structured work items with live status updates.
 * The public `tasks()` factory returns a command handle for reading current
 * state, mutating individual tasks, exposing focused tools, or binding a
 * worker to a specific task.
 *
 * @module
 */

import type { JsonObject } from '../store/types'
import type { JsonValue } from '../types/tool'
import type {
  Task,
  TaskList,
  TaskListHandle,
  TaskListStatus,
  CreateTaskInput,
  CreateTaskListInput,
  TasksInput,
  TaskUpdate,
  TaskSpecRecord,
  TasksHandle,
} from './types'
import { TASKLIST_PREFIX, isCancellable, metadataFilter, taskKey, taskListKey } from './helpers'
import { emptyCounts, rebuildCounts } from './status'
import { resolveStore } from '../runtime/runtime'
import { observe } from '../observability'
import { getExecutionContext } from '../runtime/execution-context'
import { taskListAgent, taskWorker } from './agent'
import { createTasksCreationTool, type TasksToolOptions } from './creation-tools'
import { addInitialTasks } from './defined-tasks'
import { DuplicateTaskIdError, TaskListNotFoundError } from './errors'
import { assertMutableTask, assertMutableTaskList, assertValidTaskStatusUpdate } from './lifecycle'
import { getActiveTasks, getAllTasks, repairTaskListState } from './task-list-state'
import { assertTaskJsonValue, parseTaskCompletionResult } from './task-values'

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

/** Options for listing task ledgers. */
export interface TaskListListOptions {
  /** Match task ledgers associated with this plan handle or plan ID. */
  plan?: import('./types').PlanHandle | string
  /** Match task ledgers by exact metadata fields. */
  metadata?: Record<string, JsonValue>
  /** Maximum number of task ledgers to return. */
  limit?: number
  /** Store cursor returned by a previous paginated list call. */
  cursor?: string
}

/** Callable task-ledger factory plus static task-ledger helpers. */
export interface TasksFactory {
  /**
   * Create a task ledger and return a canonical command handle.
   *
   * `tasks()` is the public factory for Plans & Tasks work ledgers. Pass a plan
   * handle or plan ID to associate the ledger with an existing plan, or omit
   * `plan` to use tasks independently.
   *
   * @param input - Optional plan association, title, and metadata.
   * @returns A `TasksHandle` for task lifecycle commands.
   *
   * @example
   * ```ts
   * const work = await tasks({ plan: p, title: 'Launch tasks' })
   * await work.add({ id: 'research', label: 'Research launch channels' })
   * await work.complete('research', { channels: ['partners'] })
   * ```
   */
  <const TItems extends TaskSpecRecord | undefined = undefined>(input?: TasksInput<TItems>): Promise<TasksHandle<TItems>>

  /**
   * Create a command handle for an existing task ledger ID.
   *
   * `tasks.ref()` does not read storage. It is useful for rebinding handles
   * across server requests, background jobs, and UI actions.
   */
  ref(taskListId: string): TaskListHandle

  /** List task ledgers from the configured store. */
  list(options?: TaskListListOptions): Promise<TaskList[]>

  /**
   * Create a focused tool that creates a task ledger.
   *
   * After the tool executes successfully, call `created()` to access the
   * resulting handle.
   */
  tool(options?: TasksToolOptions): import('../types/tool').CreationTool<TaskListHandle>
}

/**
 * Create a task ledger and return a canonical command handle.
 *
 * `tasks()` is the public factory for Plans & Tasks work ledgers. Pass a plan
 * handle or plan ID to associate the ledger with an existing plan, or omit
 * `plan` to use tasks independently.
 *
 * @param input - Optional plan association, title, and metadata.
 * @returns A `TasksHandle` for task lifecycle commands.
 *
 * @example
 * ```ts
 * const work = await tasks({ plan: p, title: 'Launch tasks' })
 * await work.add({ id: 'research', label: 'Research launch channels' })
 * await work.complete('research', { channels: ['partners'] })
 * ```
 */
async function createTasks<const TItems extends TaskSpecRecord | undefined = undefined>(
  input: TasksInput<TItems> = {} as TasksInput<TItems>,
): Promise<TasksHandle<TItems>> {
  const handle = await createTaskList({
    planId: typeof input.plan === 'string' ? input.plan : input.plan?.id,
    title: input.title,
    metadata: input.metadata,
  }, input.items)
  await addInitialTasks(handle, input.items)
  return handle as TasksHandle<TItems>
}

/** Canonical task-ledger primitive. */
export const tasks: TasksFactory = Object.assign(createTasks, {
  ref: createHandle,
  list: listTaskLists,
  tool: (options?: TasksToolOptions) => createTasksCreationTool(createTasks, options),
})

/** @internal */
export async function tasklist(input: CreateTaskListInput): Promise<TaskListHandle> {
  return createTaskList(input)
}

/**
 * Create the persisted task-ledger row behind `tasks()`.
 *
 * The ledger is persisted immediately with status `pending`; eager creation
 * avoids races between concurrent task additions.
 *
 * @param input - Internal plan ID association, title, and metadata.
 * @param taskSpecs - Optional typed task definitions carried by the returned handle.
 * @returns A command handle for the created task ledger.
 */
async function createTaskList(
  input: CreateTaskListInput,
  taskSpecs?: TaskSpecRecord,
): Promise<TaskListHandle> {
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
    title: input.title,
    status: 'pending',
    counts: emptyCounts(),
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  }
  if (input.metadata !== undefined) {
    assertTaskJsonValue(input.metadata, {
      taskListId: id,
      field: 'task list metadata',
    })
  }

  try {
    await span.withContext(async () => {
      await store.set(taskListKey(id), list as unknown as JsonObject)
      emitTaskArtifact(span.spanId, 'tasklist.create', list)
    })
    const ctx = getExecutionContext()
    span.end({
      operation: 'tasklist.create',
      taskListId: id,
      planId: input.planId,
      status: list.status,
      traceId: ctx?.traceId,
    })
    return createHandle(id, taskSpecs)
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
  return repairTaskListState(resolveStore(), taskListId)
}

/** List persisted task ledgers, optionally filtered by plan and metadata. */
export async function listTaskLists(options?: TaskListListOptions): Promise<TaskList[]> {
  const planId = typeof options?.plan === 'string' ? options.plan : options?.plan?.id
  const result = await resolveStore().list(TASKLIST_PREFIX, {
    cursor: options?.cursor,
    limit: options?.limit,
    filter: {
      ...(planId !== undefined ? { planId } : {}),
      ...(metadataFilter(options?.metadata) ?? {}),
    },
  })
  const repaired = await Promise.all(
    result.entries.map((entry) => repairTaskListState(resolveStore(), (entry.value as unknown as TaskList).id)),
  )
  return repaired.filter((list): list is TaskList => list !== null)
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
  return repairTaskListState(store, list.id)
}

/** Create a TaskListHandle for a given task list ID. @internal */
export function createHandle(taskListId: string, taskSpecs?: TaskSpecRecord): TaskListHandle {
  const legacy = {
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
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      }
      if (input.metadata !== undefined) {
        assertTaskJsonValue(input.metadata, {
          taskListId,
          taskId: input.id,
          field: 'task metadata',
        })
      }

      try {
        const rawList = await store.get(taskListKey(taskListId))
        const list = rawList as unknown as TaskList
        assertMutableTaskList(list, taskListId)

        await span.withContext(async () => {
          const inserted = await store.setIfAbsent(taskKey(taskListId, input.id), task as unknown as JsonObject)
          if (!inserted) throw DuplicateTaskIdError(taskListId, input.id)
          emitTaskArtifact(span.spanId, 'add', task)
        })
        const ctx = getExecutionContext()
        await repairTaskListState(store, taskListId)
        span.end({
          operation: 'add',
          taskListId,
          taskId: task.id,
          status: task.status,
          traceId: ctx?.traceId,
        })
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
        const [rawList, raw] = await Promise.all([
          store.get(taskListKey(taskListId)),
          store.get(taskKey(taskListId, taskId)),
        ])
        const list = rawList as unknown as TaskList | null
        assertMutableTaskList(list, taskListId)

        const task = raw as unknown as Task | null
        assertMutableTask(task, taskListId, taskId)
        assertValidTaskStatusUpdate(task, update.status)
        if (update.metadata !== undefined) {
          assertTaskJsonValue(update.metadata, {
            taskListId,
            taskId,
            field: 'task metadata',
          })
        }
        if (update.result !== undefined) {
          assertTaskJsonValue(update.result, {
            taskListId,
            taskId,
            field: 'result',
          })
        }

        const updated: Task = {
          ...task,
          ...(update.status !== undefined && { status: update.status }),
          ...(update.label !== undefined && { label: update.label }),
          ...(update.description !== undefined && { description: update.description }),
          ...(update.progress !== undefined && { progress: update.progress }),
          ...(update.assignee !== undefined && { assignee: update.assignee }),
          ...(update.metadata !== undefined && { metadata: update.metadata }),
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
        await repairTaskListState(store, taskListId)
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
        span.error(error, {
          operation: 'update',
          taskListId,
          taskId,
          nextStatus: update.status,
        })
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
        const [rawList, raw] = await Promise.all([
          store.get(taskListKey(taskListId)),
          store.get(taskKey(taskListId, taskId)),
        ])
        const list = rawList as unknown as TaskList | null
        assertMutableTaskList(list, taskListId)

        const task = raw as unknown as Task | null
        assertMutableTask(task, taskListId, taskId)

        const previousStatus = task.status
        task.removedAt = Date.now()
        task.updatedAt = Date.now()
        await span.withContext(async () => {
          await store.set(taskKey(taskListId, taskId), task as unknown as JsonObject)
          emitTaskArtifact(span.spanId, 'remove', task)
        })
        const ctx = getExecutionContext()
        await repairTaskListState(store, taskListId)
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
          throw TaskListNotFoundError(taskListId)
        }

        const list = rawList as unknown as TaskList
        if (list.status === 'discarded') {
          span.end({
            operation: 'tasklist.discard',
            taskListId,
            discarded: true,
            alreadyDiscarded: true,
          })
          return
        }

        const now = Date.now()
        const tasks = await getAllTasks(store, taskListId)
        const activeTasks = tasks.filter((t) => !t.removedAt)
        const completedCount = activeTasks.filter((t) => t.status === 'completed').length
        const remainingCount = activeTasks.filter((t) => isCancellable(t.status)).length
        const nextTasks = tasks.map((task) =>
          !task.removedAt && isCancellable(task.status)
            ? {
                ...task,
                status: 'cancelled' as const,
                updatedAt: now,
              }
            : task,
        )
        const nextList: TaskList = {
          ...list,
          status: 'discarded',
          counts: rebuildCounts(nextTasks),
          discardedAt: now,
          discardReason: reason,
          updatedAt: now,
        }

        await span.withContext(async () => {
          await store.set(taskListKey(taskListId), nextList as unknown as JsonObject)
          await Promise.all(
            nextTasks.map((task) => store.set(taskKey(taskListId, task.id), task as unknown as JsonObject)),
          )
          emitTaskArtifact(span.spanId, 'tasklist.discard', nextList)
        })

        const ctx = getExecutionContext()
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
      return getActiveTasks(resolveStore(), taskListId)
    },

    async getStatus(): Promise<TaskListStatus> {
      return (await repairTaskListState(resolveStore(), taskListId))?.status ?? 'pending'
    },

    asContext(options?: { priority?: number; renderContext?: (tasks: Task[]) => string }) {
      const agent = taskListAgent(taskListId, {
        renderContext: options?.renderContext,
      }, taskSpecs)
      return agent.asContext({ priority: options?.priority })
    },

    asTools() {
      const agent = taskListAgent(taskListId, undefined, taskSpecs)
      return agent.asTools()
    },

    worker(
      taskId: string,
      options?: {
        guidelines?: string
        renderContext?: (task: Task, allTasks: Task[]) => string
      },
    ) {
      return taskWorker(taskListId, taskId, options, taskSpecs)
    },
  }

  return {
    id: taskListId,

    async get() {
      return getTaskList(taskListId)
    },

    async list(options?: { includeRemoved?: boolean }) {
      return options?.includeRemoved ? getAllTasks(resolveStore(), taskListId) : getActiveTasks(resolveStore(), taskListId)
    },

    async getTask(taskId: string) {
      const raw = await resolveStore().get(taskKey(taskListId, taskId))
      const task = raw as unknown as Task | null
      if (!task || task.removedAt) return null
      return task
    },

    add(input: CreateTaskInput) {
      return legacy.addTask(input)
    },

    edit(taskId: string, patch: import('./types').TaskEdit) {
      return legacy.updateTask(taskId, patch)
    },

    start(taskId: string) {
      return legacy.updateTask(taskId, { status: 'in_progress' })
    },

    progress(taskId: string, message: string) {
      return legacy.updateTask(taskId, { progress: message })
    },

    async complete(taskId: string, result?: JsonValue) {
      const parsedResult = parseTaskCompletionResult({
        taskListId,
        taskId,
        spec: taskSpecs?.[taskId],
        result,
      })
      return legacy.updateTask(taskId, { status: 'completed', result: parsedResult })
    },

    fail(taskId: string, error: string) {
      return legacy.updateTask(taskId, { status: 'failed', error })
    },

    skip(taskId: string, reason?: string) {
      return legacy.updateTask(taskId, { status: 'skipped', progress: reason })
    },

    cancel(taskId: string, reason?: string) {
      return legacy.updateTask(taskId, { status: 'cancelled', progress: reason })
    },

    remove(taskId: string) {
      return legacy.removeTask(taskId)
    },

    discard(reason?: string) {
      return legacy.discard(reason)
    },

    asContext: legacy.asContext,
    asTools: legacy.asTools,
    worker: legacy.worker,
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
