/**
 * Type-level contract for the Plans & Tasks beta public API.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the contract.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { plan, task, tasks } from '../plan'
import { task as taskFromTasks, tasks as tasksFromTasks } from '../tasks'
import { plan as planFromRoot, task as taskFromRoot, tasks as tasksFromRoot } from '..'
import type { Plan, PlanHandle, TaskSpec, TasksHandle } from '../plan'

// @ts-expect-error — `tasklist` was removed from the public beta API.
import { tasklist } from '../tasks'
// @ts-expect-error — `planAgent` is available through plan handles, not as a public top-level export.
import { planAgent } from '../plan'
// @ts-expect-error — task-list agents are available through task handles, not as public top-level exports.
import { taskListAgent } from '../tasks'
// @ts-expect-error — worker handles are created from `tasks().worker()`.
import { taskWorker } from '../tasks'
// @ts-expect-error — creation tools live at `plan.tool()`.
import { createPlanTool } from '../plan'
// @ts-expect-error — creation tools live at `tasks.tool()`.
import { createTaskListTool } from '../tasks'
// @ts-expect-error — list task ledgers with `tasks.list({ plan })`.
import { getTaskListByPlan } from '../tasks'

expectTypeOf(plan).toEqualTypeOf(planFromRoot)
expectTypeOf(tasks).toEqualTypeOf(tasksFromTasks)
expectTypeOf(tasks).toEqualTypeOf(tasksFromRoot)
expectTypeOf(task).toEqualTypeOf(taskFromTasks)
expectTypeOf(task).toEqualTypeOf(taskFromRoot)

const spec = task('Research')
expectTypeOf(spec).toEqualTypeOf<TaskSpec>()

const planHandle = plan.ref('plan_123')
expectTypeOf(planHandle).toEqualTypeOf<PlanHandle>()

plan.list({ metadata: { threadId: 'thread-1', nested: { phase: 1 } } })
// @ts-expect-error — plan list metadata filters must be JSON-safe.
plan.list({ metadata: { fn: () => undefined } })

// @ts-expect-error — PlanHandle is a command handle, not a stale Plan snapshot.
const snapshot: Plan = planHandle
void snapshot

const taskHandle = tasks.ref('tasks_123')
expectTypeOf(taskHandle).toEqualTypeOf<TasksHandle>()

tasks.list({ metadata: { threadId: 'thread-1' } })
// @ts-expect-error — task list metadata filters must be JSON-safe.
tasks.list({ metadata: { big: 1n } })

const definedWorkPromise = tasks({
  items: {
    research: task('Research', {
      result: z.object({ sources: z.array(z.string()) }),
    }),
    draft: task('Draft announcement'),
  },
})
type DefinedWork = Awaited<typeof definedWorkPromise>
declare const definedWork: DefinedWork

definedWork.worker('research')
definedWork.getTask('draft')
definedWork.start('research')
definedWork.complete('research', { sources: [] })
definedWork.complete('draft', { markdown: 'Draft copy' })

// @ts-expect-error — defined handles reject unknown task IDs.
definedWork.worker('bad-id')
// @ts-expect-error — defined handles reject unknown task IDs on reads.
definedWork.getTask('bad-id')
// @ts-expect-error — defined handles reject unknown task IDs on lifecycle methods.
definedWork.complete('bad-id', { sources: [] })
// @ts-expect-error — result payloads come from the matching task schema.
definedWork.complete('research', { markdown: 'wrong shape' })
// @ts-expect-error — defined handles do not accidentally opt into dynamic additions.
definedWork.add({ id: 'extra', label: 'Extra task' })

const dynamicWorkPromise = tasks()
type DynamicWork = Awaited<typeof dynamicWorkPromise>
declare const dynamicWork: DynamicWork

dynamicWork.worker('any-id')
dynamicWork.complete('any-id', { anything: 'json-safe' })

// @ts-expect-error — dynamic task results must still be JSON-safe.
dynamicWork.complete('any-id', 1n)
// @ts-expect-error — task metadata must be JSON-safe.
task('Bad metadata', { metadata: { fn: () => undefined } })
// @ts-expect-error — result schema output must be JSON-safe.
task('Bad result', { result: z.object({ createdAt: z.date() }) })
