# Crux Core (@crux/core)

SDK-agnostic AI orchestration toolkit for TypeScript. See README.md for full API docs, ARCHITECTURE.md for internal module map.

## Key APIs by Subpath

- **`@crux/core`** — `prompt()`, `context()`, `createPrompts()`, `createContexts()`, `config()`
- **`/testing`** — `evaluatePrompt()`, `evaluateContext()`, `flowEvaluation()`
- **`/ai-agent`** — AI SDK agent instruction resolution
- **`/devtools`** — `withDevtools()` plugin, `enableDevtools()`
- **`/observability`** — canonical graph contract, schemas, runtime emitters, transports
- **`/flow`** — `flow()`, `signalFlow()`, `cancelFlow()`, `executeFlow()` (suspendable/resumable)
- **`/memory`** — `memory()`, `memoryBlock()`, `recentMessages()`, `workingState()`, `episodes()`, `facts()`, `procedures()`, `CruxStore`
- **`/embedding`** — `embedding()` (dense or sparse vector primitive)
- **`/indexing`** — `indexer()` (chunk + embed + write documents to a CruxStore)
- **`/retrieval`** — `retriever()`, `reranker()` (text query → scored hits, `asContext()`, `asTools()`)
- **`/compaction`** — `summarizeMessages()`, `createSlidingWindow()`, `createBudgetManager()`, `extractKeyFacts()`
- **`/scoring`** — `llmJudge()`, pre-built metrics
- **`/agent`** — `agent()`, `parallel()`, `pipeline()`, `consensus()`, `swarm()`, `blackboard()`, `handoff()`, `delegate()`
- **`/store`** — `CruxStore` interface, `inMemoryCruxStore()`
- **`/plan` + `/tasks`** — `plan()`, `tasklist()`, `planAgent()`, `createPlanTool()`
- **`/index`** — project index contracts, schemas, serializers, and source metadata helpers
- **`/lint`** — index lint contracts and rule registry metadata
- **`/runtime-bridge`** — local devtools bridge contracts for runtime resources
- **`/safety`** — `guardrail()`/`constraint()` authoring, the per-call `createSafety()` session (the only execution path), `createSafetyPlugin()`

React bindings live in **`@crux/react`** (`CruxProvider`, hooks, transports, `@crux/react/server`). Source indexing lives in **`@crux/indexer`**. The local Go runtime lives in **`@crux/local`**.

## Composition Patterns

- `createPipeline()` — sequential chaining with context accumulation
- `createParallel()` — concurrent agents with typed record results
- `createConsensus()` — voting with quorum
- `createSwarm()` — peer-to-peer LLM-routed transfer
- `blackboard()` — shared typed state between agents
- `handoff()` — schema-validated agent transfer
- `delegate()` — callable agent-as-tool

## Testing & Evaluation

- `evaluatePrompt()` — test prompt output quality
- `evaluateContext()` — test context assembly
- `flowEvaluation()` — case × config matrix evaluation for flows
- Run: `pnpm --filter @crux/core test -- --run`
- Evals: `packages/backend/evals/` directory

## Plugin System

- Plugins implement `CruxPlugin` interface
- `mergeRuntime()` for composing plugin state
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
