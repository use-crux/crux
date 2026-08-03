# Crux Core (@use-crux/core)

SDK-agnostic AI orchestration toolkit for TypeScript. See README.md for the npm package overview, apps/docs for user-facing documentation, and ARCHITECTURE.md for the internal module map.

## Key APIs by Subpath

- **`@use-crux/core`** — `prompt()`, `context()`, `createPrompts()`, `createContexts()`, `config()`
- **`/ai-agent`** — SDK-agnostic agent prompt instruction resolution
- **`/devtools`** — `withDevtools()` plugin, `enableDevtools()`
- **`/observability`** — canonical graph contract, schemas, runtime emitters, transports
- **`/flow`** — `flow()`, `signalFlow()`, `cancelFlow()`, `executeFlow()` (suspendable/resumable)
- **`/effect`** — `effect()`, receipts, recovery, `rollbackOnError()`, `rollback()`, reconciliation
- **`/memory`** — `memory()`, `memoryBlock()`, `workingState()`, `episodes()`, `facts()`, `procedures()`
- **`/thread`** — `thread()`, immutable hydrated history, branches, edits, redaction/deletion, commit receipts, and devtools topology
- **`/embedding`** — `embedding()` (dense or sparse vector primitive)
- **`/indexing`** — `indexer()` (chunk + embed + write documents to record/search stores)
- **`/retrieval`** — `knowledgeBase()`, `retriever()`, `retrievalRecipe()`, `expandRelations()`, `globalSearch()` (indexed knowledge → scored hits, tools, grounding)
- **`/knowledge`** — canonical Connected Knowledge home: `knowledgeBase()` + `view()`, `relate()` + built-ins, `assertions()` + `resolve()`, `communities()`, `knowledgeModel()`, storage conformance suite
- **`/scoring`** — `judge()`, pre-built metrics; runtime enforcement uses `constraint.judge(...)` from `/safety`
- **`/eval`** — inert `evaluate()` definitions, typed Cases and Variants; execution is coordinated by `crux eval`
- **`/feedback`** — awaited, run-linked production feedback submissions
- **`/agent`** — `agent()`, `parallel()`, `pipeline()`, `consensus()`, `swarm()`, `blackboard()`, `handoff()`, `delegate()`
- **`/storage`** — `RecordStore`, `SearchStore`, `AssetStore`, `storage()`, `inMemoryStorage()`
- **`/plan` + `/tasks`** — `plan()`, `tasks()`, `task()`, handle contexts, handle tools, and workers
- **`/index`** — project index contracts, schemas, serializers, and source metadata helpers
- **`/lint`** — index lint contracts and rule registry metadata
- **`/runtime-bridge`** — local devtools bridge contracts for runtime resources
- **`/safety`** — `guardrail()`/`constraint()` authoring, the per-call `createSafety()` session (the only execution path), `createSafetyPlugin()`
- **`/adapter/tool`** — `toolMiddleware()`/`approvalMiddleware()` authoring, app-facing approval helpers, the per-call `createToolLifecycle()` session (the only execution path for the tool lifecycle)

React bindings live in **`@use-crux/react`** (`CruxProvider`, hooks, transports, `@use-crux/react/server`). Source indexing lives in **`@use-crux/indexer`**. The local Go runtime lives in **`@use-crux/local`**.

## Composition Patterns

- `createPipeline()` — sequential chaining with context accumulation
- `createParallel()` — concurrent agents with typed record results
- `createConsensus()` — voting with quorum
- `createSwarm()` — peer-to-peer LLM-routed transfer
- `blackboard()` — shared typed state between agents
- `handoff()` — schema-validated agent transfer
- `delegate()` — callable agent-as-tool

## Testing & Evaluation

- `evaluate()` from `@use-crux/core/eval` — author inert Evals over callable production tasks
- `crux eval` — discover and run Evals; `runEval()` from `/eval/node` is the programmatic coordinator
- Run unit tests: `pnpm --filter @use-crux/core test -- --run`
- Keep project Evals in `evals/**/*.eval.ts` files with one default export each

## Plugin System

- Plugins implement `CruxPlugin` interface
- `mergeHooks()` for composing plugin state
- `withDevtools()` is the reference plugin implementation

## Documentation Policy

- **apps/docs/content/docs/** is the canonical home for detailed user-facing
  guides and API reference. Update the corresponding MDX pages when public
  behavior or APIs change.
- **README.md** is the npm landing page: package positioning, installation,
  a concise quick start, and links into the full docs. Update it only when that
  landing-page story changes, not for every API change.
- **ARCHITECTURE.md** documents implementation boundaries, the internal module
  map, and resolution pipelines. Update it when those architectural contracts
  change, not as a routine API-change checklist item.

These files are not auto-generated. Keep each one current for the role it owns.

## For Deep Details

- `README.md` — npm package overview and quick start
- `ARCHITECTURE.md` — internal module map, resolution pipeline, memory stores, plan/task graph
- `apps/docs/content/docs/` — detailed user guides and API reference
