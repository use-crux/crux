/**
 * Domain hooks for plans, task lists, blackboards, and working memory.
 *
 * Built on top of `CruxTransport` — transport-agnostic reactive data access.
 * Use with `<CruxProvider>` to provide the transport.
 *
 * @module
 */

import type { Plan, TaskList, Task } from '@use-crux/core/plan'
import type { StoreEntry } from '@use-crux/core/store'
import { useCruxTransport } from './provider'

/** Key prefix helpers (must match plan/helpers.ts conventions) */
const planKey = (id: string) => `plan:${id}`
const taskListKey = (id: string) => `tasklist:${id}`
const taskPrefix = (listId: string) => `task:${listId}:`

/**
 * Subscribe to a plan by ID.
 *
 * @param planId - The plan ID, or `undefined` to skip.
 * @returns The plan, or `undefined` if loading/skipped/not found.
 */
export function usePlan(planId: string | undefined): Plan | undefined {
  const { useDocument } = useCruxTransport()
  const raw = useDocument(planId !== undefined ? planKey(planId) : undefined)
  if (raw == null) return undefined
  return raw as unknown as Plan
}

/**
 * Subscribe to a task list by ID or by association (e.g. planId).
 *
 * @param filter - A task list ID (string), a filter object (e.g. `{ planId }` or `{ 'metadata.threadId': 'abc' }`), or `undefined` to skip.
 * @returns The task list, or `undefined` if loading/skipped/not found.
 */
export function useTaskList(filter: string | Record<string, unknown> | undefined): TaskList | undefined {
  const { useDocument, useDocumentList } = useCruxTransport()

  // Direct ID lookup
  const isString = typeof filter === 'string'
  const directKey = isString ? taskListKey(filter) : undefined
  const directResult = useDocument(directKey)

  // Filter-based lookup (e.g. by planId)
  const isFilter = filter !== undefined && typeof filter === 'object'
  const filterPrefix = isFilter ? 'tasklist:' : undefined
  const filterOptions = isFilter ? { filter: filter as Record<string, unknown> } : undefined
  const listResult = useDocumentList(filterPrefix, filterOptions)

  if (isString) {
    if (directResult == null) return undefined
    return directResult as unknown as TaskList
  }

  if (isFilter) {
    if (!listResult || listResult.length === 0) return undefined
    return listResult[0].value as unknown as TaskList
  }

  return undefined
}

/**
 * Subscribe to tasks for a task list.
 *
 * Automatically excludes removed tasks (those with `removedAt` set).
 *
 * @param taskListId - The task list ID, or `undefined` to skip.
 * @returns Tasks array, or `undefined` if loading/skipped.
 */
export function useTasks(taskListId: string | undefined): Task[] | undefined {
  const { useDocumentList } = useCruxTransport()
  const prefix = taskListId !== undefined ? taskPrefix(taskListId) : undefined
  const raw = useDocumentList(prefix)

  if (raw === undefined) return undefined

  return raw.map((entry: StoreEntry) => entry.value as unknown as Task).filter((task: Task) => !task.removedAt)
}

/**
 * Subscribe to a blackboard's current state.
 *
 * @param id - The blackboard ID, or `undefined` to skip.
 * @returns The blackboard state, `null` if not found, or `undefined` if loading/skipped.
 */
export function useBlackboard<T = Record<string, unknown>>(id: string | undefined): T | null | undefined {
  const { useDocument } = useCruxTransport()
  const raw = useDocument(id ? `blackboard:${id}` : undefined)
  if (raw === null || raw === undefined) return raw
  // Blackboard stores state inside a 'content' JSON string wrapper
  const content = (raw as Record<string, unknown>).content
  if (typeof content === 'string') {
    try {
      return JSON.parse(content) as T
    } catch {
      return raw as unknown as T
    }
  }
  return raw as unknown as T
}

/**
 * Subscribe to a working memory's current state.
 *
 * @param id - The working memory ID, or `undefined` to skip.
 * @returns The working memory state, `null` if not found, or `undefined` if loading/skipped.
 */
export function useWorkingMemory<T = Record<string, unknown>>(id: string | undefined): T | null | undefined {
  const { useDocument } = useCruxTransport()
  const raw = useDocument(id ? `working:${id}` : undefined)
  if (raw === null || raw === undefined) return raw
  const content = (raw as Record<string, unknown>).content
  if (typeof content === 'string') {
    try {
      return JSON.parse(content) as T
    } catch {
      return raw as unknown as T
    }
  }
  return raw as unknown as T
}
