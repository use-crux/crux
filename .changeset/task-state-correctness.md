---
'@use-crux/core': major
'@use-crux/react': major
---

Stabilize Plan & Tasks task-list state handling: duplicate IDs, removed tasks, discarded lists, terminal transitions, pending/cancelled status derivation, and stale counter repair now resolve through typed lifecycle errors and row-derived state.

Cut over the experimental Plans & Tasks API to the canonical `plan()`, `tasks()`, and `task()` surface. Plan and task handles are command handles with `get()`/`list()` reads, existing entities are bound with `plan.ref()` and `tasks.ref()`, creation tools live at `plan.tool()` and `tasks.tool()` with safe `created()` accessors, and the old `tasklist`, top-level agent/tool factories, and first-match task-list lookup exports are removed from public entrypoints.

Add typed task definitions for `tasks({ items })`: keyed `task()` specs now infer literal task IDs for reads, lifecycle methods, and workers, infer schema-backed `complete()` result payloads, validate completed results at runtime, and reject non-JSON plan/task metadata, list metadata filters, and task results before persistence.

Tighten the final beta contract with root-level task lifecycle error exports, schema-input completion typing for transforming result schemas, JSON guard coverage for dropped object properties, and consistent plan-list metadata filtering.

Align React and devtools with the canonical beta surface: React hooks now expose `usePlan()` and `useTasks()` with ID-or-handle inputs and no public `useTaskList()` alias, while local/devtools plan details project canonical task activity with core task statuses and separate progress messages.

Rewrite the public Plans & Tasks docs around the final beta API, including `plan()`, `tasks()`, `task()`, handle methods, dynamic vs defined ledgers, status derivation, lifecycle errors, React hooks, and guidance on when to use `flow()` or an external durable runner.
