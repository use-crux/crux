# @use-crux/react

## 0.4.0

### Patch Changes

- Updated dependencies [01ce116]
- Updated dependencies [cdc9c16]
- Updated dependencies [d2b64b4]
- Updated dependencies [78592f0]
- Updated dependencies [3b0fb37]
- Updated dependencies [643751b]
- Updated dependencies [dcee4fa]
- Updated dependencies [0ba939b]
- Updated dependencies [4b29d0c]
- Updated dependencies [fa1c979]
- Updated dependencies [41cf753]
- Updated dependencies [8927775]
  - @use-crux/core@0.4.0

## 0.3.0

### Minor Changes

- 5a164be: Stabilize Plan & Tasks task-list state handling: duplicate IDs, removed tasks, discarded lists, terminal transitions, pending/cancelled status derivation, and stale counter repair now resolve through typed lifecycle errors and row-derived state.

  Cut over the experimental Plans & Tasks API to the canonical `plan()`, `tasks()`, and `task()` surface. Plan and task handles are command handles with `get()`/`list()` reads, existing entities are bound with `plan.ref()` and `tasks.ref()`, creation tools live at `plan.tool()` and `tasks.tool()` with safe `created()` accessors, and the old `tasklist`, top-level agent/tool factories, and first-match task-list lookup exports are removed from public entrypoints.

  Add typed task definitions for `tasks({ items })`: keyed `task()` specs now infer literal task IDs for reads, lifecycle methods, and workers, infer schema-backed `complete()` result payloads, validate completed results at runtime, and reject non-JSON plan/task metadata, list metadata filters, and task results before persistence.

  Tighten the final beta contract with root-level task lifecycle error exports, schema-input completion typing for transforming result schemas, JSON guard coverage for dropped object properties, and consistent plan-list metadata filtering.

  Align React and devtools with the canonical beta surface: React hooks now expose `usePlan()` and `useTasks()` with ID-or-handle inputs and no public `useTaskList()` alias, while local/devtools plan details project canonical task activity with core task statuses and separate progress messages.

  Rewrite the public Plans & Tasks docs around the final beta API, including `plan()`, `tasks()`, `task()`, handle methods, dynamic vs defined ledgers, status derivation, lifecycle errors, React hooks, and guidance on when to use `flow()` or an external durable runner.

### Patch Changes

- 53b04a3: Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

  Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

  Document the single-turn provider bundle authoring path in adapter package READMEs.

- Updated dependencies [2cd8c52]
- Updated dependencies [890d660]
- Updated dependencies [53b04a3]
- Updated dependencies [5477724]
- Updated dependencies [a9fd8f9]
- Updated dependencies [fd4b17f]
- Updated dependencies [5a164be]
  - @use-crux/core@0.3.0

## 0.2.0

### Minor Changes

- 96fb6b7: Prepare the first npm release under the `@use-crux` package scope.

  Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
  troubleshooting guidance.

  Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
  worker process is still running.

### Patch Changes

- Updated dependencies [96fb6b7]
  - @use-crux/core@0.2.0
