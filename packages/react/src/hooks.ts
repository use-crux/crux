/**
 * Domain hooks for plans, task lists, blackboards, and working memory.
 *
 * Built on top of `CruxTransport` — transport-agnostic reactive data access.
 * Use with `<CruxProvider>` to provide the transport.
 *
 * @module
 */

import type { Plan, PlanHandle, Task, TasksHandle } from '@use-crux/core/plan'
import type { StoreEntry } from '@use-crux/core/store'
import { useCruxTransport } from './provider'

/** Key prefix helpers (must match plan/helpers.ts conventions) */
const planKey = (id: string) => `plan:${id}`
const taskPrefix = (listId: string) => `task:${listId}:`

type EntityRef<THandle extends { readonly id: string }> = string | THandle | undefined

function refId<THandle extends { readonly id: string }>(ref: EntityRef<THandle>): string | undefined {
  if (ref === undefined) return undefined
  return typeof ref === 'string' ? ref : ref.id
}

/**
 * Subscribe to a plan by ID or canonical `PlanHandle`.
 *
 * @param plan - The plan ID, a `PlanHandle`, or `undefined` to skip.
 * @returns The plan, or `undefined` if loading/skipped/not found.
 */
export function usePlan(plan: EntityRef<PlanHandle>): Plan | undefined {
  const { useDocument } = useCruxTransport()
  const planId = refId(plan)
  const raw = useDocument(planId !== undefined ? planKey(planId) : undefined)
  if (raw == null) return undefined
  return raw as unknown as Plan
}

/**
 * Subscribe to tasks for a canonical tasks ledger by ID or `TasksHandle`.
 *
 * Automatically excludes removed tasks (those with `removedAt` set).
 *
 * @param tasks - The task-list ID, a `TasksHandle`, or `undefined` to skip.
 * @returns Tasks array, or `undefined` if loading/skipped.
 */
export function useTasks(tasks: EntityRef<TasksHandle>): Task[] | undefined {
  const { useDocumentList } = useCruxTransport()
  const taskListId = refId(tasks)
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
