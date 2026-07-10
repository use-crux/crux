# Plan & Tasks Beta Readiness Review

Date: 2026-06-27
Scope: `@use-crux/core/plan`, `@use-crux/core/tasks`, React hooks, local/devtools read models, and public docs.

## Verdict

The Plan & Tasks module is solving a real Crux problem: agents need a persistent, inspectable intent document and a live work ledger that can be injected into context, exposed as focused tools, and shown in devtools.

It should not become a durable workflow engine. Stable beta should define Plans & Tasks as coordination and observability primitives:

- A `Plan` records intent and can be revised.
- A `TaskList` records known work and aggregate state.
- A `Task` records assignment, progress, result, and terminal outcome.
- Tool/context helpers make these records usable by LLM orchestrators and workers.
- Execution guarantees such as scheduling, retries, exactly-once execution, replay, durable timers, and concurrency throttling belong to Crux `flow`, host queues, Inngest, Temporal, Convex, or user code.

The current shape is directionally right, but it is not beta-ready. The blockers are state correctness, unclear status semantics, docs/API drift, weak JSON/result typing, and split observability paths.

## Industry Research Takeaways

Sources reviewed:

- [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview) and [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [LangGraph workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)
- [OpenAI Agents orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration) and [Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Inngest docs](https://www.inngest.com/docs)
- [Temporal workflow execution](https://docs.temporal.io/workflow-execution)
- [CrewAI tasks](https://docs.crewai.com/concepts/tasks)
- [AutoGen teams](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)
- [Plan-and-Solve Prompting](https://arxiv.org/abs/2305.04091)
- [ReWOO](https://arxiv.org/abs/2305.18323)
- [LLMCompiler](https://arxiv.org/abs/2312.04511)

Patterns that matter for Crux:

| System | Relevant pattern | Implication for Crux |
| --- | --- | --- |
| LangGraph | Stateful graph runtime with persistence, human interrupts, memory, and debugging | Do not imply Plans & Tasks has graph-runtime guarantees. Instead, integrate cleanly with `flow` and external runners. |
| Mastra workflows | Explicit steps with input/output schemas, execution order, suspend/resume, and studio visibility | Task definitions and typed results are valuable, but scheduling should remain outside Plan & Tasks. |
| Temporal / Inngest | Durable event histories, replay, queues, rate limits, retries, concurrency controls | These are non-goals for this module unless Crux intentionally creates a separate durable runner. |
| OpenAI Agents / CrewAI / AutoGen | Tasks, specialists, handoffs, teams, and tracing around agent/tool activity | Crux should keep focused LLM tools and scoped worker handles. These are a real DX strength. |
| Plan-and-Solve / ReWOO / LLMCompiler | Plan first, execute subtasks, decouple reasoning from tool observations, dispatch work in parallel where possible | Crux should make plan -> task ledger -> worker context easy, but avoid binding to one orchestration strategy. |

The market split is consistent: workflow engines own execution, while agent frameworks expose task assignment, handoffs, scoped tools, and traceability. Crux should occupy the latter space for provider-agnostic context engineering.

## Current Module Shape

Core files:

- `packages/core/src/plan/types.ts`
- `packages/core/src/plan/plans.ts`
- `packages/core/src/plan/tasks.ts`
- `packages/core/src/plan/status.ts`
- `packages/core/src/plan/helpers.ts`
- `packages/core/src/plan/agent.ts`
- `packages/core/src/plan/index.ts`
- `packages/core/src/tasks/index.ts`

Public shape:

- `plan(input)` returns `PlanHandle`, which is a data snapshot plus `update`, `get`, `asContext`, and `asTools`.
- `tasklist(input)` returns `TaskListHandle`, which is a command handle with `addTask`, `updateTask`, `removeTask`, `discard`, `getTasks`, `getStatus`, `asContext`, `asTools`, and `worker`.
- `createPlanTool()` and `createTaskListTool()` capture their latest created handle on `.created`.
- `planAgent`, `taskListAgent`, and `taskWorker` provide focused tools and context injection.
- React exposes `usePlan`, `useTaskList`, and `useTasks`.
- Local/devtools has plan and task event read models.

Good current decisions:

- `@use-crux/core` stays provider-agnostic.
- Plans are freeform documents rather than pseudo-workflows.
- Focused tools are better than a single action-param tool.
- `taskWorker(taskId)` binds the task id, reducing LLM argument errors.
- Plans and tasks persist through `CruxStore`, which makes React hooks and devtools feasible.
- Context helpers make the primitive useful without forcing one orchestration framework.

## API and DX Issues

### Naming

`plan()` and `tasklist()` are concise, but they read more like values than creation functions. The docs also frequently use examples like:

```ts
const planAgent = planAgent(planTool.created!.id)
```

That has a temporal dead zone bug because the local const shadows the imported function. It is also a signal that the naming is too collision-prone in examples.

Recommendation:

- Add stable beta aliases: `createPlan`, `createTaskList`, `createPlanRef`, `createTaskListRef`.
- Keep `plan`, `tasklist`, `planAgent`, and `taskListAgent` as aliases through beta, but teach the stable docs with the clearer names.

### Handle Symmetry

`PlanHandle` is a data snapshot with methods. `TaskListHandle` is a command handle with only `id`. This asymmetry is easy to explain internally but surprising in user code.

Recommendation:

- Either make both handles command handles with `get()` for current state, or document the asymmetry explicitly.
- Prefer command handles for beta because stale snapshots are a common source of subtle bugs.

### Creation Tool Results

The `.created!` pattern is convenient but unsafe. It assumes the LLM called the tool and that the last tool call is the one the caller wants.

Recommendation:

- Keep `.created` for simple pipelines.
- Add a safe helper or result guard:

```ts
const planTool = createPlanTool()
await generate(planner, { tools: { createPlan: planTool } })
const plan = expectCreated(planTool, "createPlan")
```

or return execution metadata from prompt/tool runs so callers can read created entities without non-null assertions.

### Task List Creation

Docs show:

```ts
await tasklist({ planId: p.id, title: "Roadmap tasks", tasks: [...] })
```

but `CreateTaskListInput` only supports `planId` and `metadata`.

Recommendation:

- Either remove those docs before beta or implement `title` and initial `tasks`.
- Prefer implementing initial tasks because most agent planning flows naturally create a task set immediately after creating the plan.

### Task Identity

User-provided task ids are good for readability, worker binding, and logs. The missing piece is duplicate semantics.

Recommendation:

- Direct API: reject duplicate ids with a typed `DuplicateTaskIdError`, unless an explicit `mode: "upsert"` is provided.
- LLM tool: consider idempotent behavior when the duplicate has the same label/description, returning `{ ok: true, created: false, task }`. Return an error for conflicting duplicates.

### Plan to TaskList Cardinality

`getTaskListByPlan(planId)` returns the first matching list, while the model allows multiple lists per plan. This creates non-deterministic DX once multiple lists exist.

Recommendation:

- Pick a beta contract:
  - one list per plan, enforced by creation, or
  - many lists per plan, with `listTaskLists({ planId })` as the primary API.
- Prefer many lists only if the UI/docs have a story for phases, attempts, or agent teams. Otherwise enforce one list per plan for beta.

## Status Contract

The current status model is not stable enough:

- `TaskListStatus` includes `pending`, but `deriveStatus()` never derives `pending`.
- Docs say all pending tasks produce list `pending`, while reference docs say pending is never derived.
- `TaskStatus` includes `cancelled`, but the task update tool does not expose it.
- A list with only cancelled tasks derives `in_progress`.
- `discarded` is an explicit list lifecycle status, but mutations after discard are still allowed.

Recommended stable beta status rules:

```txt
TaskStatus:
  pending
  in_progress
  completed
  failed
  skipped
  cancelled

TaskListStatus:
  pending       no active task has started
  in_progress   at least one active task is in_progress
  completed     all active tasks are completed or skipped
  failed        at least one active task failed and none are in_progress
  cancelled     active tasks were cancelled without discarding the whole list
  discarded     explicit list-level abandon operation
```

If `cancelled` is too much surface for beta, remove task-level cancellation from the public update API and reserve cancellation for `discard()`. Do not leave it half-public.

Recommended empty-list rule:

- Newly created empty list: `pending`.
- All tasks removed after work existed: `completed` or `pending` must be explicitly decided. Current docs say `completed`; that is acceptable if documented as "no active work remains."

## Functional Bugs and Risks

These were reproduced against the current module behavior.

### Duplicate task ids corrupt counts

`addTask({ id: "a" })` followed by another `addTask({ id: "a" })` overwrites the stored task row but increments `pending` twice. Completing the visible task leaves the list stuck `in_progress`.

Cause:

- `addTask` writes `task:{list}:{id}` without checking for an existing task.
- `applyStatusDelta({ type: "add" })` always increments `pending`.

### Removed tasks can still be updated

After `removeTask("a")`, `updateTask("a", { status: "completed" })` succeeds and changes counters, even though `getTasks()` excludes the task.

Cause:

- `updateTask` checks existence but not `removedAt`.
- Count deltas still apply to removed tasks.

### Discarded lists still accept mutations

After `discard()`, `addTask()` can add a new active pending task to a discarded list. `getStatus()` returns `discarded`, but the list data and tasks are inconsistent.

Cause:

- `addTask`, `updateTask`, and `removeTask` do not guard list lifecycle.
- `applyStatusDelta` no-ops for discarded lists, hiding the inconsistency rather than preventing it.

### Cancelled tasks derive incorrectly

A list with a single `cancelled` task derives `in_progress`.

Cause:

- `deriveStatus()` only treats `completed + skipped === total` as completed.
- `cancelled` increments total but is neither failure nor success.

### Counter drift is persistent

`getStatus()` trusts `list.counts` when present. It only derives from counters, so drift can persist indefinitely. The terminal-transition full scan helps some paths but does not catch drift that prevents a terminal transition.

Recommendation:

- For beta, prefer correctness over O(1) counters. Rebuild counts from task rows after mutations and reads, or make counters a cache with revision/hash validation.
- If counters stay, centralize mutation in one function that loads the list, loads affected task rows, validates lifecycle, writes task changes, rebuilds counts, derives status, and then writes the list.

### Store mutation is not transactional

The `DataStore` interface exposes `get`, `set`, `delete`, and `list`; there is no compare-and-swap or transaction API. Current counter updates are read-modify-write sequences, so concurrent task mutations can lose deltas in real stores.

Recommendation:

- Do not make stored counters authoritative until there is a transaction/CAS capability or a replayable event model.
- Add a concurrency test store that delays reads/writes and proves beta behavior is consistent.

## Type-System Findings

The TypeScript surface is friendly but under-typed for beta.

### JSON Safety

`metadata` is `Record<string, unknown>` and `Task.result` is `unknown`, but `CruxStore` values are documented as JSON-shaped. In-memory JSON cloning can drop `undefined`/functions and throw on `BigInt` or cycles.

Recommendation:

- Export and reuse a `JsonValue` / `JsonObject` type for plan metadata, task metadata, and results.
- Add runtime validation at the API boundary for values that enter the store.
- Add type tests that reject functions, symbols, `BigInt`, and cyclic objects at the API layer where possible.

### Result Typing

Workers can complete tasks with arbitrary `unknown` results. That is flexible but not beta-grade for DX.

Recommendation:

- Add typed task definitions with schema-backed results:

```ts
const tasks = defineTasks({
  research: task({
    label: "Research sources",
    result: z.object({ sources: z.array(z.string()) }),
  }),
  draft: task({
    label: "Draft response",
    result: z.object({ markdown: z.string() }),
  }),
})

const list = await createTaskList({ planId: plan.id, tasks })
await list.updateTask("research", {
  status: "completed",
  result: { sources: ["https://example.com"] },
})
```

Beta does not need maximal type wizardry. It needs:

- task ids inferred as string literal unions;
- `worker("bad-id")` rejected when created from definitions;
- `completeTask` and `updateTask(... result ...)` typed from the task definition;
- runtime schema validation before storing model-supplied results.

### State Transitions

`TaskUpdate.status?: TaskStatus` allows arbitrary transitions. Some are probably useful during planning, but beta should define them.

Recommendation:

- Either validate transitions, or expose intent methods:
  - `startTask(taskId)`
  - `completeTask(taskId, result)`
  - `failTask(taskId, error)`
  - `skipTask(taskId, reason)`
  - `cancelTask(taskId, reason)`
- Keep `updateTask` for administrative edits if needed, but do not make it the only lifecycle API.

## Devtools and Observability Findings

The module's usefulness depends on live visibility. Current projection has a split path:

- Core emits canonical observability spans/artifacts for plan and task operations.
- Local/devtools `planDetails()` reads canonical resource activity for `plan`, but not for `task`.
- The same read model still reads legacy task events from the store.
- Status normalization maps `completed` to `done`, but maps `failed`, `skipped`, and `cancelled` to `pending`.
- Core task `progress` is a string message; devtools `PlanTask.progress` is numeric.
- UI types include hierarchy fields such as `parentId`, but core tasks do not define hierarchy.

Recommendation:

- Make one canonical projection path for beta.
- Include `ResourceActivity(ctx, "task")` in local plan detail projection, or deliberately emit legacy events from core again. Prefer canonical resource activity.
- Align status vocabulary across core, Go read model, and UI.
- Preserve progress message separately from numeric progress.
- Hide or postpone hierarchy UI unless core adds `parentId`, `order`, and/or `dependsOn`.

## Stable Beta API Proposal

Recommended user-facing beta imports:

```ts
import {
  createPlan,
  createPlanRef,
  createTaskList,
  createTaskListRef,
  defineTasks,
  task,
} from "@use-crux/core/tasks"
```

Example shape:

```ts
const plan = await createPlan({
  title: "Launch plan",
  content: "Investigate, draft, review, publish.",
})

const taskDefs = defineTasks({
  research: task({
    label: "Research launch channels",
    result: z.object({ channels: z.array(z.string()) }),
  }),
  draft: task({
    label: "Draft announcement",
    dependsOn: ["research"],
    result: z.object({ markdown: z.string() }),
  }),
})

const tasks = await createTaskList({
  planId: plan.id,
  title: "Launch tasks",
  tasks: taskDefs,
})

const worker = tasks.worker("research")
```

This does not need to replace the low-level dynamic API. The beta surface can support both:

- Dynamic mode: agents add/remove tasks as they discover work.
- Defined mode: the app declares known task ids and schemas upfront.

The docs should frame the choice clearly:

- Use dynamic mode for exploratory agents.
- Use defined mode when product UI, validation, or downstream code depends on known task ids/results.

## TDD Stabilization Plan

### Phase 0: Freeze the Contract

Decide these before implementation:

- Is there one task list per plan or many?
- Does a list with only pending tasks derive `pending` or `in_progress`?
- Is task-level `cancelled` public in beta?
- Are task hierarchy/dependencies in beta or post-beta?
- Are `plan()`/`tasklist()` the stable names or aliases?
- Is `PlanHandle` snapshot behavior intentional?

Output:

- One short contract doc in the public docs.
- Updated reference tables for status derivation and lifecycle errors.

### Phase 1: Red Tests for Correctness

Add behavior tests first against public APIs:

- `rejects duplicate task ids without changing visible tasks or counts`
- `does not let duplicate ids prevent list completion`
- `rejects updates to removed tasks`
- `does not change counts when updateTask is called on a removed task`
- `rejects addTask/updateTask/removeTask after discard`
- `discard is idempotent and leaves no active tasks`
- `derives pending when all tasks are pending` or whatever contract Phase 0 chooses
- `derives cancelled/failed/completed for cancelled tasks according to the contract`
- `getStatus self-heals when stored counters disagree with task rows`
- `concurrent add/update/remove operations cannot leave impossible counts`

Add type tests:

- JSON metadata/result accepts JSON values and rejects functions/BigInt.
- Defined task ids infer literal unions.
- Typed task results are enforced by `completeTask` and `updateTask`.
- Untyped dynamic mode remains ergonomic.

### Phase 2: Fix the State Machine

Implementation priorities:

- Introduce typed domain errors: `TaskNotFoundError`, `TaskListNotFoundError`, `DuplicateTaskIdError`, `TaskRemovedError`, `TaskListDiscardedError`, `InvalidTaskTransitionError`.
- Add a single internal lifecycle guard for every mutation.
- Validate duplicates before writing.
- Reject or explicitly no-op updates to removed tasks.
- Rebuild counts from active task rows after every mutation until store-level atomicity exists.
- Make `discard()` update task rows and list counts consistently.
- Make `getStatus()` a repair path, not a stale-counter reader.

### Phase 3: Improve Type and DX Surface

- Add `JsonValue`/`JsonObject` to the public type surface or import from the existing shared tool types.
- Add `createPlan` and `createTaskList` aliases.
- Add `createPlanRef`/`createTaskListRef` for existing ids.
- Add `getTask`, `listTaskLists`, and optionally `listPlans`.
- Add initial task creation to `createTaskList`.
- Add typed task definitions and result schemas.
- Add safe creation-tool result access.

### Phase 4: Unify Observability and UI

- Project canonical task resource activity into local `Plans` and `PlanDetail` endpoints.
- Normalize all SDK statuses without collapsing failures/cancellations into pending.
- Add local Go tests for completed, failed, skipped, cancelled, removed, and discarded tasks.
- Preserve progress strings as messages.
- Decide whether hierarchy is supported; either implement it in core or remove visible hierarchy affordances from beta UI.

### Phase 5: Docs and Examples

- Fix variable shadowing examples.
- Remove unsupported `title`/`tasks` docs or implement the API.
- Add "When to use Plans & Tasks vs Flow vs external durable runner."
- Add "Dynamic tasks vs defined tasks."
- Add "LLM tool idempotency and duplicate ids."
- Add "Status lifecycle reference."
- Ensure all docs examples typecheck or have a smoke test.

## Beta Release Gates

Before marking stable beta:

- `pnpm --filter @use-crux/core test`
- `pnpm --filter @use-crux/core typecheck`
- `pnpm --filter @use-crux/react test`
- `pnpm --filter @use-crux/react typecheck`
- `go test ./internal/devtools ./internal/store` from `packages/local`
- Docs examples compile or are covered by a docs smoke test.
- Devtools shows task lists created by canonical core observability, not only legacy hooks.
- No known state corruption bugs in duplicate, remove, discard, cancelled, or concurrent mutation paths.
- Changeset updated because API/runtime/docs behavior for npm users will change.

## Immediate Recommended Next PR

Do a narrow correctness PR before API expansion:

1. Add failing core tests for duplicate ids, removed task updates, post-discard mutation, cancelled derivation, and counter repair.
2. Replace counter-delta authority with rebuild-on-mutation/read.
3. Add lifecycle guards and duplicate checks.
4. Align docs status tables with the chosen contract.
5. Add or update one changeset because task runtime behavior changes for package users.

This reduces risk immediately and gives the beta API work a stable foundation.
