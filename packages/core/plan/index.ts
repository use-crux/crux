/**
 * `@crux/core/plan` — Plan and TaskList primitives for AI agent work tracking.
 *
 * Plans are freeform documents describing what an agent intends to do.
 * Task lists are structured work tracking with live status updates.
 * Both persist via `CruxStore` adapters.
 *
 * @module
 */

// Plan CRUD
export { plan, getPlan, updatePlan } from './plans'

// TaskList lifecycle
export { tasklist, getTaskList, getTaskListByPlan, createHandle } from './tasks'

// Agent integration
export { planAgent, taskListAgent, taskWorker, createPlanTool, createTaskListTool } from './agent'
export type { ToolDef, CreationTool, PlanAgent, PlanAgentOptions, PlanContextMode } from './agent'
export type { TaskListAgent, TaskListAgentOptions } from './agent'
export type { TaskWorker, TaskWorkerOptions } from './agent'

// Helpers
export { deriveTaskListStatus } from './helpers'

// Types
export type {
  Plan,
  PlanHandle,
  PlanUpdate,
  CreatePlanInput,
  TaskList,
  TaskListStatus,
  TaskListHandle,
  CreateTaskListInput,
  Task,
  TaskStatus,
  TaskUpdate,
  CreateTaskInput,
  TerminalTaskStatus,
  CancellableTaskStatus,
} from './types'
