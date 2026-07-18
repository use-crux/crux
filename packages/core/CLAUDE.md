# Crux Core (@use-crux/core)

SDK-agnostic AI orchestration toolkit for TypeScript. See README.md for full API docs, ARCHITECTURE.md for internal module map.

## Key APIs by Subpath

- **`@use-crux/core`** — `prompt()`, `context()`, `createPrompts()`, `createContexts()`, `config()`
- **`/ai-agent`** — SDK-agnostic agent prompt instruction resolution
- **`/devtools`** — `withDevtools()` plugin, `enableDevtools()`
- **`/observability`** — canonical graph contract, schemas, runtime emitters, transports
- **`/flow`** — `flow()`, `signalFlow()`, `cancelFlow()`, `executeFlow()` (suspendable/resumable)
- **`/memory`** — `memory()`, `memoryBlock()`, `recentMessages()`, `workingState()`, `episodes()`, `facts()`, `procedures()`
- **`/embedding`** — `embedding()` (dense or sparse vector primitive)
- **`/indexing`** — `indexer()` (chunk + embed + write documents to record/vector stores)
- **`/retrieval`** — `knowledgeBase()`, `retriever()`, `retrievalRecipe()` (indexed knowledge → scored hits, tools, grounding)
- **`/compaction`** — `summarizeMessages()`, `createSlidingWindow()`, `createBudgetManager()`, `extractKeyFacts()`
- **`/scoring`** — `judge()`, pre-built metrics; runtime enforcement uses `constraint.judge(...)` from `/safety`
- **`/eval`** — inert `evaluate()` definitions, typed Cases and Variants; execution is coordinated by `crux eval`
- **`/feedback`** — awaited, run-linked production feedback submissions
- **`/agent`** — `agent()`, `parallel()`, `pipeline()`, `consensus()`, `swarm()`, `blackboard()`, `handoff()`, `delegate()`
- **`/storage`** — `RecordStore`, `VectorStore`, `AssetStore`, `storage()`, `inMemoryStorage()`
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

## Documentation Requirement

Any API change MUST update:

1. **README.md** — public docs (88 sections)
2. **ARCHITECTURE.md** — internal module map and resolution pipeline
3. **apps/docs/content/docs/** — corresponding MDX reference/guide pages

These are NOT auto-generated. Manual sync is required.

## For Deep Details

- `README.md` — complete API reference with examples
- `ARCHITECTURE.md` — internal module map, resolution pipeline, memory stores, plan/task graph
