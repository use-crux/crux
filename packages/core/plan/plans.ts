/**
 * Plan lifecycle and command-handle functions.
 *
 * The public `plan()` factory persists a freeform intent document and returns
 * a command handle for reading, updating, context, and tools.
 *
 * @module
 */

import type { Plan, PlanHandle, CreatePlanInput, PlanUpdate, JsonValue } from './types'
import { PLAN_PREFIX, metadataFilter, planKey } from './helpers'
import { getRuntime, resolveStore } from '../runtime/runtime'
import { observe } from '../observability'
import { getExecutionContext } from '../runtime/execution-context'
import { planAgent } from './agent'
import { createPlanCreationTool, type PlanToolOptions } from './creation-tools'
import { assertTaskJsonValue } from './task-values'

/** Options for listing plans. */
export interface PlanListOptions {
  /** Match plans by exact metadata fields. */
  metadata?: Record<string, JsonValue>
  /** Maximum number of plans to return. */
  limit?: number
  /** Store cursor returned by a previous paginated list call. */
  cursor?: string
}

/** Callable plan factory plus static plan helpers. */
export interface PlanFactory {
  /**
   * Create a new plan and return a command handle.
   *
   * @param input - Plan title, content, and metadata.
   * @returns A handle for reading and updating the created plan.
   *
   * @example
   * ```ts
   * const p = await plan({
   *   title: 'Cloud Migration Guide',
   *   content: '## Objective\nWrite a comprehensive guide...',
   * })
   * ```
   */
  (input: CreatePlanInput): Promise<PlanHandle>

  /** Create a command handle for an existing plan ID without reading storage. */
  ref(planId: string): PlanHandle

  /** List plans from the configured store. */
  list(options?: PlanListOptions): Promise<Plan[]>

  /** Create a focused tool; call `created()` after execution to access the handle. */
  tool(options?: PlanToolOptions): import('../types/tool').CreationTool<PlanHandle>
}

async function createPlan(input: CreatePlanInput): Promise<PlanHandle> {
  const span = observe.openSpan({
    name: 'plan.create',
    family: 'plan',
    primitive: 'plan.operation',
    attributes: {
      operation: 'create',
      title: input.title,
      hasContent: input.content !== undefined && input.content.length > 0,
      metadataKeys: input.metadata ? Object.keys(input.metadata).sort() : [],
    },
  })
  const store = resolveStore()
  const now = Date.now()
  const data: Plan = {
    id: crypto.randomUUID(),
    title: input.title,
    content: input.content ?? '',
    version: 1,
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  }
  if (input.metadata !== undefined) {
    assertTaskJsonValue(input.metadata, {
      taskListId: `plan:${data.id}`,
      field: 'plan metadata',
    })
  }

  try {
    await span.withContext(async () => {
      await store.set(planKey(data.id), data as unknown as Record<string, unknown>)
      emitPlanArtifact(span.spanId, 'create', data)
    })
    const ctx = getExecutionContext()
    getRuntime().instrumentationHooks?.onPlanCreated?.({
      planId: data.id,
      title: data.title,
      contentPreview: data.content.slice(0, 200),
      traceId: ctx?.traceId,
    })
    span.end({
      operation: 'create',
      planId: data.id,
      title: data.title,
      version: data.version,
      hasContent: data.content.length > 0,
      traceId: ctx?.traceId,
    })
    return createPlanHandle(data.id)
  } catch (error) {
    span.error(error, { operation: 'create', title: input.title })
    throw error
  }
}

/** Canonical plan primitive. */
export const plan: PlanFactory = Object.assign(createPlan, {
  ref: createPlanHandle,
  list: listPlans,
  tool: (options?: PlanToolOptions) => createPlanCreationTool(createPlan, options),
})

/**
 * Create a command handle for an existing plan.
 *
 * The handle is intentionally not a data snapshot. It carries only the plan ID
 * plus commands that read or mutate the current store state.
 *
 * @internal
 */
export function createPlanHandle(planId: string): PlanHandle {
  return {
    id: planId,

    async update(update: PlanUpdate): Promise<Plan> {
      return updatePlan(planId, update)
    },

    async get(): Promise<Plan | null> {
      return getPlan(planId)
    },

    asContext(options?: { priority?: number; mode?: 'full' | 'reference'; renderContext?: (plan: Plan) => string }) {
      const agent = planAgent(planId, {
        context: options?.mode,
        renderContext: options?.renderContext,
      })
      return agent.asContext({ priority: options?.priority })
    },

    asTools() {
      const agent = planAgent(planId)
      return agent.asTools()
    },
  }
}

/**
 * Get a plan by ID.
 *
 * @param planId - The plan's ID.
 * @returns The plan, or `null` if not found.
 */
export async function getPlan(planId: string): Promise<Plan | null> {
  const store = resolveStore()
  const raw = await store.get(planKey(planId))
  if (!raw) return null
  return raw as unknown as Plan
}

/** List persisted plans, optionally filtered by metadata. */
export async function listPlans(options?: PlanListOptions): Promise<Plan[]> {
  const result = await resolveStore().list(PLAN_PREFIX, {
    cursor: options?.cursor,
    limit: options?.limit,
    filter: metadataFilter(options?.metadata),
  })
  return result.entries.map((entry) => entry.value as unknown as Plan)
}

/**
 * Update a plan.
 *
 * Version increments when `title` or `content` changes.
 *
 * @param planId - The plan's ID.
 * @param update - Fields to update.
 * @returns The updated plan.
 * @throws If the plan does not exist.
 */
export async function updatePlan(planId: string, update: PlanUpdate): Promise<Plan> {
  const span = observe.openSpan({
    name: 'plan.update',
    family: 'plan',
    primitive: 'plan.operation',
    attributes: {
      operation: 'update',
      planId,
      changes: planUpdateChanges(update),
    },
  })
  const store = resolveStore()
  try {
    const existing = await getPlan(planId)
    if (!existing) {
      throw new Error(`Plan not found: ${planId}`)
    }

    const contentChanged = update.title !== undefined || update.content !== undefined
    if (update.metadata !== undefined) {
      assertTaskJsonValue(update.metadata, {
        taskListId: `plan:${planId}`,
        field: 'plan metadata',
      })
    }

    const updated: Plan = {
      ...existing,
      ...(update.title !== undefined && { title: update.title }),
      ...(update.content !== undefined && { content: update.content }),
      ...(update.metadata !== undefined && { metadata: update.metadata }),
      version: contentChanged ? existing.version + 1 : existing.version,
      updatedAt: Date.now(),
    }

    await span.withContext(async () => {
      await store.set(planKey(planId), updated as unknown as Record<string, unknown>)
      emitPlanArtifact(span.spanId, 'update', updated)
    })

    const changes = planUpdateChanges(update)
    const ctx = getExecutionContext()
    getRuntime().instrumentationHooks?.onPlanUpdated?.({
      planId,
      version: updated.version,
      changes,
      traceId: ctx?.traceId,
    })

    span.end({
      operation: 'update',
      planId,
      version: updated.version,
      changes,
      traceId: ctx?.traceId,
    })
    return updated
  } catch (error) {
    span.error(error, { operation: 'update', planId, changes: planUpdateChanges(update) })
    throw error
  }
}

function planUpdateChanges(update: PlanUpdate): string[] {
  const changes: string[] = []
  if (update.title !== undefined) changes.push('title')
  if (update.content !== undefined) changes.push('content')
  if (update.metadata !== undefined) changes.push('metadata')
  return changes
}

function emitPlanArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  operation: 'create' | 'update',
  data: Plan,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      primitive: 'plan.operation',
      operation,
      planId: data.id,
      title: data.title,
      version: data.version,
      content: data.content,
      contentPreview: data.content.slice(0, 500),
      metadata: data.metadata,
    },
    attributes: {
      primitive: 'plan.operation',
      operation,
      planId: data.id,
      title: data.title,
      version: data.version,
      hasContent: data.content.length > 0,
      metadataKeys: data.metadata ? Object.keys(data.metadata).sort() : [],
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'plan.operation', operation, planId: data.id },
  })
}
