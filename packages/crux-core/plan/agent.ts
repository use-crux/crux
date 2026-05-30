/**
 * Agent integration primitives for Plans and TaskLists.
 *
 * Three agent handles for different roles:
 * - `planAgent()` — plan document management (read/update)
 * - `taskListAgent()` — task list oversight (list/add/update/remove/discard)
 * - `taskWorker()` — single-task assignment (start/progress/complete/fail)
 *
 * Plus standalone creation tools:
 * - `createPlanTool()` — create new plans
 * - `createTaskListTool()` — create new task lists
 *
 * Following LLM tool best practices:
 * - Multiple focused tools (not single tool with action param)
 * - `.describe()` on every Zod property
 * - Self-contained descriptions (pass the "intern test")
 * - Known values offloaded (e.g., taskId bound in worker tools)
 *
 * @module
 */

import { z } from 'zod'
import type { Context } from '../types'
import type { ToolDef, CreationTool } from '../types/tool'
import type { Plan, PlanHandle, Task, TaskStatus, TaskListHandle } from './types'
import { context } from '../context'
import { plan as createPlanFn, getPlan, updatePlan, createPlanHandle } from './plans'
import { tasklist as createTaskListFn } from './tasks'
import { createHandle } from './tasks'

export type { ToolDef, CreationTool } from '../types/tool'

// ─────────────────────────────────────────────────────────────────
// Plan Agent
// ─────────────────────────────────────────────────────────────────

/** How to inject plan context into the system message. */
export type PlanContextMode = 'full' | 'reference'

/** Options for `planAgent()`. */
export interface PlanAgentOptions {
  /** How to inject context: `'full'` (default) injects content, `'reference'` injects metadata only. */
  context?: PlanContextMode
  /** Override the default context rendering. Receives the plan, returns markdown string. */
  renderContext?: (plan: Plan) => string
}

/** Agent handle for a specific plan. */
export interface PlanAgent {
  readonly planId: string
  /** Create a Context that injects plan content into the system message. */
  asContext(options?: { priority?: number }): Context<z.ZodType<{}>>
  /** Returns focused tools for plan interaction. Pick which to expose. */
  asTools(): {
    getPlan: ToolDef
    updatePlan: ToolDef
  }
}

/**
 * Create an agent handle for an existing plan.
 *
 * @param planId - The plan's ID.
 * @param options - Context mode and render overrides.
 * @returns A `PlanAgent` with `asContext()` and `asTools()`.
 *
 * @example
 * ```ts
 * const agent = planAgent(plan.id)
 *
 * // Context: inject plan into system message
 * prompt({ use: [agent.asContext()] })
 *
 * // Tools: expose to LLM (pick which ones)
 * const { getPlan, updatePlan } = agent.asTools()
 * prompt({ tools: { getPlan } })  // read-only
 * ```
 */
export function planAgent(planId: string, options?: PlanAgentOptions): PlanAgent {
  const contextMode: PlanContextMode = options?.context ?? 'full'

  return {
    planId,

    asContext(ctxOptions?: { priority?: number }): Context<z.ZodType<{}>> {
      return context({
        id: `plan:${planId}`,
        description: `Plan context for ${planId}`,
        priority: ctxOptions?.priority ?? 80,
        system: async () => {
          const plan = await getPlan(planId)
          if (!plan) return ''

          if (options?.renderContext) return options.renderContext(plan)

          if (contextMode === 'reference') {
            return `## Plan: ${plan.title} (v${plan.version})\nUse the \`getPlan\` tool to read the full content.`
          }

          return `## Plan: ${plan.title} (v${plan.version})\n${plan.content}`
        },
      })
    },

    asTools() {
      return {
        getPlan: {
          description: `Read the current plan "${planId}". Returns the plan document with title, content, version number, and metadata. Use this to understand what work needs to be done.`,
          parameters: z.object({}),
          async execute(): Promise<string> {
            const plan = await getPlan(planId)
            if (!plan) return JSON.stringify({ error: 'Plan not found' })
            return JSON.stringify(plan)
          },
        },

        updatePlan: {
          description: `Update the plan "${planId}". Provide the fields you want to change. Version increments automatically when title or content changes.`,
          parameters: z.object({
            title: z.string().optional().describe('New plan title. Omit to keep current.'),
            content: z.string().optional().describe('New plan content (markdown). Omit to keep current.'),
            metadata: z.record(z.string(), z.unknown()).optional().describe('Key-value metadata to set on the plan.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            const update: Record<string, unknown> = {}
            if (args.title !== undefined) update.title = args.title
            if (args.content !== undefined) update.content = args.content
            if (args.metadata !== undefined) update.metadata = args.metadata
            const updated = await updatePlan(planId, update)
            return JSON.stringify({ ok: true, version: updated.version })
          },
        },
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// TaskList Agent
// ─────────────────────────────────────────────────────────────────

/** Options for `taskListAgent()`. */
export interface TaskListAgentOptions {
  /** Override the default context rendering. Receives all active tasks, returns markdown string. */
  renderContext?: (tasks: Task[]) => string
}

/** Agent handle for a specific task list. */
export interface TaskListAgent {
  readonly taskListId: string
  /** Create a Context that injects the task list summary into the system message. */
  asContext(options?: { priority?: number }): Context<z.ZodType<{}>>
  /** Returns focused tools for task list management. Pick which to expose. */
  asTools(): {
    listTasks: ToolDef
    addTask: ToolDef
    updateTask: ToolDef
    removeTask: ToolDef
    discardTaskList: ToolDef
  }
}

/** Map task status to a display icon. */
const STATUS_ICON: Record<TaskStatus, string> = {
  completed: '✓',
  in_progress: '⟳',
  pending: '○',
  failed: '✕',
  skipped: '⊖',
  cancelled: '✕',
}

/**
 * Create an agent handle for an existing task list.
 *
 * @param taskListId - The task list's ID.
 * @param options - Render overrides.
 * @returns A `TaskListAgent` with `asContext()` and `asTools()`.
 *
 * @example
 * ```ts
 * const agent = taskListAgent(taskList.id)
 *
 * // Monitor only:
 * const { listTasks } = agent.asTools()
 *
 * // Full management:
 * const tools = agent.asTools()
 * prompt({ tools })
 * ```
 */
export function taskListAgent(taskListId: string, options?: TaskListAgentOptions): TaskListAgent {
  const handle = createHandle(taskListId)

  return {
    taskListId,

    asContext(ctxOptions?: { priority?: number }): Context<z.ZodType<{}>> {
      return context({
        id: `tasklist:${taskListId}`,
        description: `Task list context for ${taskListId}`,
        priority: ctxOptions?.priority ?? 80,
        system: async () => {
          const tasks = await handle.getTasks()
          if (tasks.length === 0) return ''

          if (options?.renderContext) return options.renderContext(tasks)

          const completedCount = tasks.filter((t) => t.status === 'completed').length
          const lines = tasks.map((t) => renderTaskLine(t))
          return `## Tasks (${completedCount}/${tasks.length})\n${lines.join('\n')}`
        },
      })
    },

    asTools() {
      return {
        listTasks: {
          description: `List all active tasks in task list "${taskListId}". Returns an array of tasks with id, label, status, progress, assignee, and timestamps. Removed tasks are excluded.`,
          parameters: z.object({}),
          async execute(): Promise<string> {
            const tasks = await handle.getTasks()
            return JSON.stringify(tasks)
          },
        },

        addTask: {
          description: `Add a new task to task list "${taskListId}". Provide a unique task ID and a human-readable label. The task starts with status "pending".`,
          parameters: z.object({
            taskId: z.string().describe('Unique identifier for the task, e.g. "research" or "write-intro".'),
            label: z.string().describe('Human-readable task label, e.g. "Research cloud migration sources".'),
            description: z.string().optional().describe('Detailed description of what this task involves.'),
            assignee: z
              .object({
                agent: z.string().optional().describe('Name of the agent assigned to this task.'),
                model: z.string().optional().describe('Model to use for this task, e.g. "claude-sonnet-4-20250514".'),
              })
              .optional()
              .describe('Agent and model assignment for this task.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            const task = await handle.addTask({
              id: args.taskId as string,
              label: args.label as string,
              description: args.description as string | undefined,
              assignee: args.assignee as { agent?: string; model?: string } | undefined,
            })
            return JSON.stringify(task)
          },
        },

        updateTask: {
          description: `Update an existing task in task list "${taskListId}". Change its status, progress message, assignee, or record results/errors.`,
          parameters: z.object({
            taskId: z.string().describe('ID of the task to update.'),
            status: z
              .enum(['pending', 'in_progress', 'completed', 'failed', 'skipped'])
              .optional()
              .describe('New task status. Use "in_progress" when starting, "completed" when done, "failed" on error.'),
            progress: z
              .string()
              .optional()
              .describe('Human-readable progress message, e.g. "Drafting section 2 of 5...".'),
            assignee: z
              .object({
                agent: z.string().optional().describe('Name of the agent assigned.'),
                model: z.string().optional().describe('Model to use.'),
              })
              .optional()
              .describe('Reassign this task to a different agent/model.'),
            result: z.unknown().optional().describe('Structured result data when task completes.'),
            error: z.string().optional().describe('Error message when task fails.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            const update: Record<string, unknown> = {}
            if (args.status !== undefined) update.status = args.status
            if (args.progress !== undefined) update.progress = args.progress
            if (args.assignee !== undefined) update.assignee = args.assignee
            if (args.result !== undefined) update.result = args.result
            if (args.error !== undefined) update.error = args.error
            const task = await handle.updateTask(args.taskId as string, update)
            return JSON.stringify({ ok: true, status: task.status })
          },
        },

        removeTask: {
          description: `Remove a task from task list "${taskListId}". The task is soft-deleted (marked with removedAt) and excluded from auto-completion calculations.`,
          parameters: z.object({
            taskId: z.string().describe('ID of the task to remove.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            await handle.removeTask(args.taskId as string)
            return JSON.stringify({ ok: true })
          },
        },

        discardTaskList: {
          description: `Discard the entire task list "${taskListId}". All pending and in-progress tasks are cancelled. Completed tasks are preserved. This action cannot be undone.`,
          parameters: z.object({
            reason: z
              .string()
              .optional()
              .describe('Why the task list is being discarded, e.g. "User changed direction".'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            await handle.discard(args.reason as string | undefined)
            return JSON.stringify({ ok: true })
          },
        },
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Task Worker — single-task assignment for worker agents
// ─────────────────────────────────────────────────────────────────

/** Options for `taskWorker()`. */
export interface TaskWorkerOptions {
  /** Override the default context rendering. Receives the assigned task and all tasks. */
  renderContext?: (task: Task, allTasks: Task[]) => string
  /** Override the default guidelines text. */
  guidelines?: string
}

/** Agent handle scoped to a single assigned task. */
export interface TaskWorker {
  readonly taskListId: string
  readonly taskId: string
  /** Create a Context that injects this task's assignment and guidelines. */
  asContext(options?: { priority?: number }): Context<z.ZodType<{}>>
  /** Returns focused tools for task lifecycle. No taskId needed — it's bound. */
  asTools(): {
    startTask: ToolDef
    reportProgress: ToolDef
    completeTask: ToolDef
    failTask: ToolDef
  }
}

const DEFAULT_GUIDELINES = [
  'Call `startTask` when you begin working on this task.',
  'Use `reportProgress` to report what you are doing as you work.',
  'Call `completeTask` when finished, optionally providing a structured result.',
  'Call `failTask` if you encounter an unrecoverable issue, with an error message.',
].join('\n- ')

/**
 * Create an agent handle scoped to a single assigned task.
 *
 * Injects the task assignment and guidelines into the system message,
 * and provides focused tools (start, progress, complete, fail) that
 * don't require a taskId — it's bound at creation.
 *
 * @param taskListId - The task list's ID.
 * @param taskId - The specific task's ID.
 * @param options - Render and guidelines overrides.
 * @returns A `TaskWorker` with `asContext()` and `asTools()`.
 *
 * @example
 * ```ts
 * const worker = taskWorker(taskList.id, 'write-intro')
 * prompt({
 *   use: [planAgent.asContext(), worker.asContext()],
 *   tools: worker.asTools(),
 * })
 * ```
 */
export function taskWorker(taskListId: string, taskId: string, options?: TaskWorkerOptions): TaskWorker {
  const handle = createHandle(taskListId)

  return {
    taskListId,
    taskId,

    asContext(ctxOptions?: { priority?: number }): Context<z.ZodType<{}>> {
      return context({
        id: `task-worker:${taskListId}:${taskId}`,
        description: `Task assignment for ${taskId}`,
        priority: ctxOptions?.priority ?? 95,
        system: async () => {
          const tasks = await handle.getTasks()
          const task = tasks.find((t) => t.id === taskId)
          if (!task) return ''

          if (options?.renderContext) return options.renderContext(task, tasks)

          const assigneeStr = task.assignee
            ? ` (assigned to ${task.assignee.agent ?? 'you'}${task.assignee.model ? ` / ${task.assignee.model}` : ''})`
            : ''

          const guidelines = options?.guidelines ?? DEFAULT_GUIDELINES

          return [
            `## Your Assignment`,
            `**Task:** ${task.label}${assigneeStr}`,
            task.description ? `**Description:** ${task.description}` : '',
            `**Status:** ${task.status}`,
            task.progress ? `**Progress:** ${task.progress}` : '',
            '',
            `## Guidelines`,
            `- ${guidelines}`,
          ]
            .filter(Boolean)
            .join('\n')
        },
      })
    },

    asTools() {
      return {
        startTask: {
          description: `Mark your assigned task "${taskId}" as in-progress. Call this when you begin working.`,
          parameters: z.object({}),
          async execute(): Promise<string> {
            await handle.updateTask(taskId, { status: 'in_progress' })
            return JSON.stringify({ ok: true, status: 'in_progress' })
          },
        },

        reportProgress: {
          description: `Report progress on your assigned task "${taskId}". Provide a human-readable message describing what you've done or are currently doing.`,
          parameters: z.object({
            message: z
              .string()
              .describe(
                'What you are currently doing or have accomplished, e.g. "Found 5 relevant sources, now synthesizing findings."',
              ),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            await handle.updateTask(taskId, {
              progress: args.message as string,
            })
            return JSON.stringify({ ok: true })
          },
        },

        completeTask: {
          description: `Mark your assigned task "${taskId}" as completed. Optionally provide a structured result summarizing what was accomplished.`,
          parameters: z.object({
            result: z
              .unknown()
              .optional()
              .describe('Structured result data, e.g. { sourceCount: 12, summary: "..." }.'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            await handle.updateTask(taskId, {
              status: 'completed',
              result: args.result,
            })
            return JSON.stringify({ ok: true, status: 'completed' })
          },
        },

        failTask: {
          description: `Mark your assigned task "${taskId}" as failed. Provide an error message explaining what went wrong.`,
          parameters: z.object({
            error: z
              .string()
              .describe('What went wrong, e.g. "API rate limited after 3 retries" or "Source data not available".'),
          }),
          async execute(args: Record<string, unknown>): Promise<string> {
            await handle.updateTask(taskId, {
              status: 'failed',
              error: args.error as string,
            })
            return JSON.stringify({ ok: true, status: 'failed' })
          },
        },
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Standalone Creation Tools
// ─────────────────────────────────────────────────────────────────

/**
 * Create a standalone tool for creating new plans.
 *
 * Use this when no plan exists yet — the agent creates one.
 * After creation, use `planAgent()` for ongoing management.
 *
 * @param options - Optional template to guide the plan structure.
 * @returns A tool definition compatible with AI SDK.
 */
export function createPlanTool(options?: {
  template?: string
  onCreated?: (handle: PlanHandle) => void
}): CreationTool<PlanHandle> {
  const templateStr = options?.template ? `\n\nThe plan should follow this structure:\n${options.template}` : ''

  const tool: CreationTool<PlanHandle> = {
    created: undefined,
    description: `Create a new plan document. A plan describes the intent and approach for a piece of work.${templateStr}\n\nReturns the created plan with a generated ID and version 1.`,
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
      const handle = await createPlanFn({
        title: args.title as string,
        content: args.content as string | undefined,
        metadata: args.metadata as Record<string, unknown> | undefined,
      })
      tool.created = handle
      options?.onCreated?.(handle)
      return JSON.stringify({
        id: handle.id,
        title: handle.title,
        version: handle.version,
      })
    },
  }
  return tool
}

/**
 * Create a standalone tool for creating new task lists.
 *
 * Use this when no task list exists yet — the agent creates one.
 * After creation, use `taskListAgent()` for ongoing management.
 *
 * @param options - Optional template to guide task creation.
 * @returns A tool definition compatible with AI SDK.
 */
export function createTaskListTool(options?: {
  template?: string
  onCreated?: (handle: TaskListHandle) => void
}): CreationTool<TaskListHandle> {
  const templateStr = options?.template ? `\n\nWhen creating tasks:\n${options.template}` : ''

  const tool: CreationTool<TaskListHandle> = {
    created: undefined,
    description: `Create a new task list for tracking work items.${templateStr}\n\nReturns the task list ID.`,
    parameters: z.object({
      planId: z
        .string()
        .optional()
        .describe('Associate with a plan by its ID. Optional — task lists can exist independently.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Key-value metadata, e.g. { threadId: "abc" }.'),
    }),
    async execute(args: Record<string, unknown>): Promise<string> {
      const handle = await createTaskListFn({
        planId: args.planId as string | undefined,
        metadata: args.metadata as Record<string, unknown> | undefined,
      })
      tool.created = handle
      options?.onCreated?.(handle)
      const status = await handle.getStatus()
      return JSON.stringify({ id: handle.id, status, planId: args.planId })
    },
  }
  return tool
}

// ─────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────

/** Render a single task as a status line for context injection. */
function renderTaskLine(task: Task): string {
  const icon = STATUS_ICON[task.status] ?? '?'
  let line = `${icon} ${task.label} — ${task.status}`
  if (task.progress) {
    line += ` "${task.progress}"`
  }
  if (task.assignee?.agent) {
    line += ` [${task.assignee.agent}]`
  }
  return line
}
