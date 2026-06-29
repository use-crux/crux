/**
 * Canonical creation tools for Plans & Tasks.
 *
 * These helpers produce focused AI SDK-compatible tools while keeping captured
 * creation results behind a safe `created()` accessor.
 *
 * @module
 */

import { z } from 'zod'
import type { CreationTool, JsonObject } from '../types/tool'
import { CreationToolNotCreatedError } from '../types/tool'
import type { CreatePlanInput, PlanHandle, TaskListHandle, TasksInput } from './types'

/** Options for `plan.tool()`. */
export interface PlanToolOptions {
  /** Optional structure guidance included in the tool description. */
  template?: string
  /** Called after the tool successfully creates a plan. */
  onCreated?: (handle: PlanHandle) => void
}

/** Options for `tasks.tool()`. */
export interface TasksToolOptions {
  /** Associate the created task ledger with this plan handle or plan ID. */
  plan?: TasksInput['plan']
  /** Default task ledger title. */
  title?: string
  /** Optional task authoring guidance included in the tool description. */
  template?: string
  /** Called after the tool successfully creates a task ledger. */
  onCreated?: (handle: TaskListHandle) => void
}

/** Create the canonical plan creation tool. */
export function createPlanCreationTool(
  createPlan: (input: CreatePlanInput) => Promise<PlanHandle>,
  options: PlanToolOptions = {},
): CreationTool<PlanHandle> {
  let created: PlanHandle | undefined
  const template = options.template ? `\n\nThe plan should follow this structure:\n${options.template}` : ''

  return {
    created() {
      if (!created) throw CreationToolNotCreatedError('plan')
      return created
    },
    description: `Create a new plan document. A plan captures the intent and approach for a piece of work.${template}\n\nReturns the created plan ID and current version.`,
    parameters: z.object({
      title: z.string().describe('Plan title, e.g. "Cloud Migration Guide".'),
      content: z
        .string()
        .optional()
        .describe('Plan content in markdown. Describe the objective, approach, and key considerations.'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Key-value metadata, e.g. { threadId: "abc", priority: "high" }.'),
    }),
    async execute(args: Record<string, unknown>): Promise<string> {
      const handle = await createPlan({
        title: args.title as string,
        content: args.content as string | undefined,
        metadata: args.metadata as JsonObject | undefined,
      })
      created = handle
      options.onCreated?.(handle)
      const data = await handle.get()
      return JSON.stringify({
        id: handle.id,
        title: data?.title,
        version: data?.version,
      })
    },
  }
}

/** Create the canonical task-ledger creation tool. */
export function createTasksCreationTool(
  createTasks: (input?: TasksInput) => Promise<TaskListHandle>,
  options: TasksToolOptions = {},
): CreationTool<TaskListHandle> {
  let created: TaskListHandle | undefined
  const template = options.template ? `\n\nWhen creating tasks:\n${options.template}` : ''

  return {
    created() {
      if (!created) throw CreationToolNotCreatedError('tasks')
      return created
    },
    description: `Create a new task ledger for tracking work items.${template}\n\nReturns the task ledger ID and initial status.`,
    parameters: z.object({
      title: z.string().optional().describe('Task ledger title. Omit to use the configured default title.'),
      planId: z
        .string()
        .optional()
        .describe('Associate with a plan by its ID. Omit to use the configured plan, when provided.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Key-value metadata, e.g. { threadId: "abc" }.'),
    }),
    async execute(args: Record<string, unknown>): Promise<string> {
      const handle = await createTasks({
        plan: (args.planId as string | undefined) ?? options.plan,
        title: (args.title as string | undefined) ?? options.title,
        metadata: args.metadata as JsonObject | undefined,
      })
      created = handle
      options.onCreated?.(handle)
      const data = await handle.get()
      return JSON.stringify({
        id: handle.id,
        status: data?.status,
        planId: data?.planId,
      })
    },
  }
}
