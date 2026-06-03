# Architecture

Internal implementation details of `@crux/core`. For usage documentation, see [README.md](./README.md).

## Public Naming Convention

Crux public APIs use names that describe the thing a user is declaring or doing:

- Use simple nouns for user-authored primitives: `prompt()`, `context()`, `agent()`, `flow()`, `embedding()`, `indexer()`, `retriever()`, `reranker()`, `memory()`, `workspace()`, `guardrail()`, `constraint()`, `blackboard()`, `handoff()`, `delegate()`, `registry()`, `planAgent()`, `taskListAgent()`, , and `taskWorker()`.
- Use provider-local noun exports in adapter packages. For example, `@crux/ai`, `@crux/openai`, and `@crux/google` all export `embedding()`. Consumers can alias at import sites when multiple providers are used in one file, e.g. `import { embedding as openAIEmbedding } from '@crux/openai'`.
- Use `createX()` for runtime infrastructure factories that produce machinery rather than domain definitions: transports, middleware, plugins, reporters, stores, adapter clients, pipelines, and other operational helpers.
- Use verbs for one-off operations: `generate()`, `stream()`, `retrieve()`, `indexDocuments()`, `signalFlow()`, `cancelFlow()`, and similar execution functions.
- Avoid `defineX()` for new public Crux APIs. The project is pre-launch, so naming changes are breaking changes rather than deprecated aliases.

This keeps the SDK readable at call sites: users define nouns once, execute verbs when work happens, and reach for `createX()` only when building infrastructure.

## Workspace Storage Model

`workspace()` is an injectable primitive, not a sandbox or host filesystem wrapper. It composes through the existing `InjectableEntry` path: `use: [ws]` expands to a manifest context plus safe file tools.

Workspace records use explicit storage capabilities:

- `DataStore` stores metadata, paths, MIME type, size, timestamps, previews, and small inline text/JSON.
- `BlobStore` stores binary and oversized payloads.

`VectorStore` is separate and only used by retrieval/search features. Core includes in-memory `DataStore`, `VectorStore`, and `BlobStore` implementations for tests and demos. Durable blob stores belong in adapters or userland implementations; object storage backends such as S3, R2, GCS, local disk, and app-owned file services should implement `BlobStore` instead of overloading `DataStore` with raw bytes.

Default mounts are `/workspace` and `/outputs`. Optional `/sources` mounts are configured explicitly by the app because source ownership can come from uploads, ingestion, MCP, retrieval, or app storage. Generated deliverables remain normal files under `/outputs`; there is no public artifact primitive in V1.

Instrumentation emits `workspace:operation` protocol events and `onWorkspaceOperation` hooks. Devtools can show workspace ids, namespaces, paths, operations, and file metadata from the protocol stream; OTel receives only privacy-safe attributes such as workspace id, operation, MIME type, size, status, and path hash.

## Module Map

```
@crux/core
├── define.ts           prompt() — .resolve(), .inspect(), schema merging
├── context.ts          Context class, createContexts()
├── prompts-tree.ts     createPrompts() — tree builder
├── plugin.ts           CruxPlugin interface, mergeRuntime(), applyPlugins()
├── configure.ts        configure() — registry, globals, plugin processing
├── resolve.ts          Resolution pipeline — system composition, token dropping
├── tools.ts            SDK-agnostic tool() helper and ToolDef re-exports
├── tokenizer.ts        Pluggable token counter (default: chars/4)
├── runtime.ts          CruxRuntime — single object for all global hooks/reporters (getRuntime/setRuntime)
├── middleware.ts        Hook type definitions (PromptMiddleware, InstrumentationHooks, etc.)
├── observability/
│   ├── index.ts        Barrel: canonical graph contract, schemas, ID helpers, observe runtime, transports
│   ├── contract.ts     Run, Span, SpanEvent, Edge, Artifact, RunDetail, and realtime notification types; branded IDs; taxonomies
│   ├── schema.ts       Zod schemas for graph records and batches
│   ├── ids.ts          Runtime-owned public graph ID helpers
│   ├── observe.ts      Non-blocking runtime emitters, manual/open run lifecycles for serverless resumes, AsyncLocalStorage context propagation, flush/shutdown
│   ├── errors.ts       Normalized observed error summaries, safe raw capture, stack/cause extraction, redaction, and truncation
│   ├── transport.ts    Transport interface plus in-memory and HTTP graph transports
│   ├── devtools.ts     withDevtools() plugin + enableDevtools() — installs the canonical observability transport
│   └── fixtures/       Shared TS/Go contract fixtures
├── tool-middleware.ts   ToolMiddleware, approvalMiddleware(), resumable approval helpers
├── orchestrate.ts      Shared adapter orchestration — generic OrchestrationSpec<T>, typed generate/stream/fallback/stream-wrap
├── messages.ts         Message type + helpers
├── routing/
│   ├── index.ts        Barrel: router(), cascade(), resolveModel(), error types
│   ├── router.ts       router() — classifier-based model selection with .select()/.with()
│   ├── cascade.ts      cascade() — sequential quality escalation with budget enforcement
│   ├── resolve.ts      resolveModel() — unwraps router/cascade/fallback _tag wrappers
│   └── errors.ts       CascadeExhaustedError, RouterClassifyError
├── testing.ts          internal runner support for CLI/devtools quality execution
├── quality/
│   └── index.ts        quality(), suite(), expect(), target(), cassette() — local suites, persisted experiments, variants, comparisons, baselines, feedback inbox/annotation records, feedback memory proposals, feedback-to-suite export, typed prompt/retriever/flow targets, and deterministic replay fixtures
├── catalog/
│   ├── index.ts        Project Catalog/state-plane contracts and validation schemas
│   ├── serializers.ts  Zod→JSON Schema, prompt/context/tool→Project Catalog metadata
│   └── source.ts       Source capture helpers
├── lint/
│   └── index.ts        Authored-graph lint contract types and schemas
├── runtime-bridge/
│   ├── index.ts        Runtime bridge command-plane schemas, manifest helpers, and client helpers
│   └── resources.ts    Inspectable resource registration for memory, blackboards, stores, and future runtime resources
├── embedding/
│   └── index.ts        embedding() — dense/sparse embedding primitive with batching, governance, and instrumentation
├── retrieval/
│   └── index.ts        retriever(), retrievalPipeline() — query-first retrieval plus advanced query-time RAG composition
├── storage/
│   └── index.ts        DataStore, VectorStore, BlobStore, storage(), and in-memory implementations
├── workspace/
│   └── index.ts        workspace(), workspaceToolNames() — durable mounted file tree, prompt injection, file tools, blob-backed binary/large payloads, canonical operation spans
├── indexing/
│   └── index.ts        indexer() + corpus() + indexingPipeline() — document transforms, structured/parent-child/semantic chunkers, stage cache, generation-aware promotion, source ledger sync, dry runs, and store writes
├── cost/
│   └── index.ts        withCostTracking(), modelPricing(), CostLimitError — per-call cost attribution and canonical budget spans
├── memory/
│   ├── index.ts        Barrel: memory(), memoryBlock(), recentMessages(), workingState(), episodes(), facts(), procedures()
│   ├── block-system.ts Block memory implementation
│   ├── types.ts        Memory types
│   └── utils.ts        Memory helpers
├── plan/
│   ├── index.ts        Barrel: plan, tasklist, agent primitives, types
│   ├── types.ts        Plan, TaskList, Task, status types, TaskListHandle
│   ├── plans.ts        plan(), getPlan(), updatePlan() — canonical plan.operation spans for mutations
│   ├── tasks.ts        tasklist(), getTaskList(), TaskListHandle — canonical task.operation spans for mutations
│   ├── agent.ts        planAgent(), taskListAgent(), taskWorker(), createPlanTool(), createTaskListTool(), ToolDef
│   └── helpers.ts      deriveTaskListStatus(), key conventions
├── tasks/
│   └── index.ts        Barrel: canonical @crux/core/tasks import (re-exports task APIs from plan/)
├── compaction/
│   ├── types.ts        GenerateTextFn, GenerateObjectFn (SDK-agnostic)
│   ├── summarize.ts    summarizeMessages() — stateless batch LLM summarization
│   ├── sliding-window.ts  createSlidingWindow() — rolling window with auto-eviction
│   ├── budget.ts       createBudgetManager() — advisory pressure tracking
│   └── extract.ts      extractKeyFacts() — structured extraction from conversations
├── scoring/
│   ├── judge.ts        llmJudge() — LLM-as-a-judge with CoT, rubrics, few-shot
│   ├── metrics.ts      Pre-built judges (relevance, faithfulness, coherence, etc.)
│   └── types.ts        JudgeConfig, JudgeResult, JudgeInstance, JudgeScoreOptions
├── flow/
│   ├── index.ts        Barrel — flow, signalFlow, cancelFlow, listFlows, createFlowId, executeFlow, evaluateFlow
│   ├── scope.ts        flow<T, TInput>(), FlowHandle<T, TInput>, FlowRunOptions<TInput>, FlowScope<TInput> — flow.input (typed), flow.results (auto-populated Record<string, unknown>), auto-pass (step fns accepting FlowScope receive it automatically), suspend/resume/cancel — throw-to-unwind pattern with CruxStore persistence
│   ├── executor.ts     Flow step execution (plain, tool-calling, multiturn)
│   └── evaluator.ts    Flow eval case × config matrix runner
├── agent/
│   ├── index.ts        Barrel: agent, AnyAgent, InferAgentInput, InferAgentOutput, composition utilities, blackboard, handoff, delegate
│   ├── agent.ts        agent(), isAgent(), AnyAgent, InferAgentInput, InferAgentOutput — frozen agent definition
│   ├── executor.ts     AgentExecutor interface — SDK-agnostic agent execution contract (includes maxSteps)
│   ├── parallel.ts     createParallel() — concurrent named agents with typed result record
│   ├── pipeline.ts     createPipeline() — sequential chaining with typed context accumulation (PipelineResult, StepName, StepOutput)
│   ├── consensus.ts    createConsensus() — voting with quorum validation (built on parallel)
│   ├── swarm.ts        createSwarm() — peer-to-peer routing via LLM-decided transfer tools
│   ├── create-compositions.ts  createCompositions(executor) — factory for adapter-bound utilities
├── retry.ts           executeWithRetry() — shared retry with backoff + fallback (used by flows + compositions)
├── validation-retry.ts  ValidationExhaustedError, ValidationRetryOptions — validation-feedback retry types
├── repair-json.ts     repairJsonText() — zero-cost JSON text repair (markdown fences, trailing commas, bracket extraction)
│   ├── blackboard.ts   blackboard() — shared typed scratchpad, per-field validation
│   ├── handoff.ts      handoff() — schema-validated inter-agent context transfer
│   └── delegate.ts     delegate() — handoff + subagent execution as callable tool
├── skill/
│   ├── index.ts        Barrel: skill.inline, skill.fromFile, skill.fromRegistry, registry, generateCatalog
│   ├── types.ts        Skill, SkillMeta, SkillReference, InlineSkillConfig, LazySkill, SkillLoadError
│   ├── loaders.ts      inlineSkill(), fileSkill() — create Skill objects from inline text or SKILL.md files
│   ├── frontmatter.ts  parseFrontmatter() — lightweight YAML frontmatter parser for SKILL.md
│   ├── catalog.ts      generateCatalog() — system prompt section listing available skills
│   ├── tools.ts        LoadSkill + LoadReference tool definitions, SkillActivationState, createSkillState()
│   ├── cache.ts        In-memory Map with TTL for registry skill caching (follows contextResolverCache pattern)
│   ├── registry.ts     registry(), skills.sh client, .well-known/agent-skills/ protocol, fetchFromSkillsSh()
│   ├── state.ts        Module-level SkillActivationState registry for cross-component state sharing
│   └── agent-kit.ts    createAgentSkillKit() — wiring helper for external agent frameworks (Convex Agent, Mastra, etc.)
├── safety/
│   ├── index.ts        Canonical safety barrel for @crux/core/safety (guardrails + constraints)
│   └── guardrail/
│       ├── index.ts        Barrel: guardrail, createGuardrailPipeline, createGuardrailPlugin, createStreamGuardrailTransform, evaluateGuardrail, GuardrailBlockedError
│       ├── types.ts        GuardrailContext, phase-conditional result types (InputGuardrailResult, OutputGuardrailResult, ChunkGuardrailResult), GuardrailStreamConfig, GuardrailAudit
│       ├── define.ts       guardrail() — frozen object factory (Object.freeze, _tag: 'Guardrail', captureSource), isGuardrail() type guard
│       ├── pipeline.ts     createGuardrailPipeline() — auto-splits by phase, sequential execution, redacted/transformed content flows forward, first block short-circuits
│       ├── plugin.ts       createGuardrailPlugin() — CruxPlugin wrapping generate() via middleware (input guards → next → output guards → audit)
│       ├── stream.ts       createStreamGuardrailTransform() — TransformStream with buffer strategies: 'none' (per-chunk, v0 LLM Suspense), 'full' (accumulate, v0 Autofixer)
│       ├── evaluate.ts     evaluateGuardrail() — test case matrix runner (input × expected action → pass/fail report)
│       └── errors.ts       GuardrailBlockedError — thrown on block
│   └── constraint/
│       ├── index.ts        Barrel: constraint, runConstraints, createConstraintPlugin, evaluateConstraint, ConstraintViolationError
│       ├── types.ts        ConstraintSeverity ('assert'|'suggest'), ConstraintCheckResult (discriminated union), ChunkCheckResult, ConstraintOutput<TSchema>, ConstraintContext, ConstraintAudit
│       ├── define.ts       constraint<TSchema>() — frozen object factory (Object.freeze, _tag: 'Constraint', captureSource), isConstraint() type guard
│       ├── runner.ts       runConstraints() — parallel-check combined-retry engine: Promise.all checks → combine feedback → regenerate → re-check. Assert drives retries, suggest is best-effort.
│       ├── plugin.ts       createConstraintPlugin() — CruxPlugin registering global constraints on CruxRuntime.globalConstraints
│       ├── evaluate.ts     evaluateConstraint() — test case matrix runner (output × expected pass → report)
│       └── errors.ts       ConstraintViolationError — thrown when assert constraints exhaust retries (carries all failing constraints)
└── adapter/
    └── index.ts        Adapter-facing orchestration contract helpers
```

## Runtime Profiles

Core primitives remain SDK-agnostic. Runtime packages may mirror core subpaths when they can preserve the same conceptual API while adding environment-specific plumbing. `@crux/convex` follows that pattern for `context`, `skill`, `memory`, and `tools`: unchanged APIs are re-exported, Convex-bound drop-ins keep the same public shape where possible, and genuinely Convex-specific runtime concepts use explicit names such as `convexAgent()` and `createCruxConvex()`.

This keeps core definitions portable while letting Convex code import from `@crux/convex/*` consistently.

## Error Observability Contract

Thrown execution failures are normalized at the observability boundary, not in individual UI surfaces. `observability/errors.ts` accepts `unknown`, preserves the distinction between thrown `Error` instances and thrown values, extracts `name`, `message`, `stack`, and bounded `cause` data when present, and converts raw data into a JSON-safe representation with circular references, long strings, deep objects, and common secret keys bounded or redacted.

`observe.span()` and `observe.openSpan().error()` use that normalizer to emit three layers:

- A compact `error` summary on `span:end` or `run:end` for filtering, status rollups, and list views.
- A `span:event` named `exception` with OpenTelemetry-style attributes such as exception type, message, and stack trace when available.
- `error.stack` and `error.raw` artifacts attached to the failing span when detail exists.

The Go read model promotes `span.Error`, `error.stack`, and `error.raw` into `inspection.errors`. Web devtools and the TUI render that inspection section before primitive-specific payloads, so tools, retrieval stages, generation calls, flow steps, eval cases, and custom spans get the same failure display whenever they use the canonical span contract.

Do not use exception evidence for ordinary control outcomes. Approval denial, guardrail block reports, constraint retries, retrieval zero hits, citation validation issues, cascade tier rejection, flow suspension/cancellation, and stream finish reasons are status, event, or artifact data unless user code actually throws. Runtime bridge and eval-runner failures that happen outside any span use the same normalized shape inside `command.error.details`.

## Indexing Pipeline

`indexingPipeline()` is the write-time document processing boundary. It deliberately sits between ingestion and retrieval:

```
CruxDocument
  -> document transforms
  -> chunker
  -> chunk transforms
  -> embeddings
  -> generation-scoped chunk/parent writes
  -> corpus source ledger
```

The pipeline is versioned through stage names, stage versions, explicit options, and optional fingerprints. `indexer().fingerprint()` includes the pipeline fingerprint, so `corpus.sync()` can reindex unchanged source text when the indexing meaning changes.

Built-in chunkers are intentionally separate strategies:

- `chunker.text()` and `chunker.structured()` preserve structured ingest provenance and produce searchable child chunks.
- `chunker.parentChild()` writes non-searchable parent records plus active searchable child chunks.
- `chunker.semantic()` supports embedding, model/custom, and hybrid segmentation inputs while still producing ordinary `CruxChunk` records.

Replacement is generation-aware. New chunks and parent records are written with a fresh `generationId` and `active: true`; only after the write succeeds does the indexer mark previous generations for the same source inactive. Retrievers add `_cruxRecordType: 'chunk'` and `active: true` filters so parent records and failed replacement generations do not leak into search results.

Pipeline caching is stage-level, not whole-indexer caching. When `cache: true` is configured, document transforms, chunking, and chunk transforms are cached by source hash, previous stage hash, stage identity, and stage fingerprint. `cache: 'bypass'` skips reads/writes for one call, while `cache: 'refresh'` recomputes and replaces cached outputs.

The source ledger stores the emitted `SourceStageRecord[]` for indexed sources. The same records flow through `index:end` and `corpus:source:*` instrumentation so devtools, CLI/TUI, and OTel can show stage counts, cache hits, chunk counts, parent counts, durations, and failures without inventing a parallel observability model.

## Resolution Pipeline

When an adapter calls `prompt.resolve(options)`, the resolution pipeline in `resolve.ts` runs:

```
Input validation (Zod)
  ↓
Flatten context entries (NEW — conditional context resolution)
  ├── Filter falsy entries (false/null/undefined)
  ├── Evaluate context-level `when` predicates
  ├── Evaluate `when()` wrapper predicates
  ├── Evaluate `match()` discriminators → select branch
  └── Output: active Context[] + excluded ExcludedContext[]
  ↓
Auto-escape string inputs (if enabled)
  ↓
Custom sanitize hook
  ↓
Input guard (Proxy) — wraps objects to throw on string interpolation
  ↓
System message assembly (with return type validation on systemFn)
  ├── Prompt's own system text (always included)
  ├── Active context contributions (resolved in `use` array order)
  │     └── Context resolver cache: skip systemFn() on cache hit (by contextId + inputHash)
  ├── Token budget enforcement (drop lowest-priority contexts)
  └── SystemBlock[] construction (per-block providerCache hints for adapters)
  ↓
Prompt text / messages resolution (with [object Object] safety net)
  ├── String prompt: resolve static or dynamic
  └── Messages array: inject context system + scan for [object Object]
  ↓
Provider adaptation
  ├── Match: exact provider > modelId prefix > '*' wildcard
  └── Apply: prepend/append system/prompt, override settings
  ↓
Settings merge
  config.settings < adapt.settings < call-site overrides
  ↓
Tool collection (only from active contexts)
  active context tools + prompt tools + call-site tools (last-write-wins)
  ↓
ResolvedPrompt { system, systemBlocks, prompt, messages, schema, tools, toolMiddleware, settings }
  ↓
Adapter execution
  prompt toolMiddleware + call-site toolMiddleware wrap final tools
  approvalMiddleware maps matched calls to resumable approval protocols (`@crux/ai` uses AI SDK; native adapters use Crux message metadata)
```

### Token-Aware Context Dropping

`composeSystem()` handles the token budget:

1. Prompt's own system text is always included and its tokens are subtracted from the budget.
2. Context contributions are collected in `use` array order.
3. When a budget is set, contexts are sorted by priority (ascending) and the lowest-priority ones are dropped first until the total fits.
4. Dropped contexts are tracked in the `InspectResult` with their source, text, token count, and priority.

The observability graph mirrors the same state. Resolved context artifacts use the canonical `context.contribution` artifact kind and carry source, state, inclusion, priority, token, cache, and injection metadata. Predicate failures and unmatched `match()` branches emit `state: "checked-not-included"` with `reason` and `branch` when available. Budgeted resolution emits a `prompt.budget` artifact containing `usedTokens`, `totalTokens`, and the dropped contribution payloads. These previews are the backend-owned contract for the Run Detail context-composition pane; HTTP and WebSocket layers should only serialize projected artifacts.

The tokenizer is pluggable via `setTokenizer()` or `configure({ tokenizer })`. The default estimates tokens as `Math.ceil(text.length / 4)`.

### Context Resolver Caching

`composeSystem()` includes a cache layer for expensive context resolvers:

1. Before calling `ctx.systemFn(input)`, if `ctx.cacheTtl > 0` and `ctx.id` is set, compute a cache key: `cache:ctx:{id}:{stableHash(inputFields)}`.
2. Check the module-level `Map<string, { text, expiresAt }>`. On hit, return cached text and fire `onContextCacheHit` instrumentation hook.
3. On miss, call `systemFn(input)`, store the result with TTL, and fire `onContextCacheMiss`.
4. Cache key only includes input fields declared in the context's `inputSchema` (sorted alphabetically), so unrelated prompt-level fields don't pollute the key.
5. Static string contexts silently skip caching (nothing to cache).

### Semantic Response Caching

`createSemanticCache()` lives in `cache/index.ts` and installs a `PromptMiddleware` runtime plugin. It wraps the shared orchestration layer rather than individual providers, so `@crux/ai`, `@crux/openai`, `@crux/google`, and `@crux/anthropic` all get the same behavior once they pass prompt metadata into `orchestrateGenerate()` / `orchestrateStream()`.

The cache is deliberately dense-only:

- Dense and sparse embeddings are vectorization primitives.
- Hybrid is retrieval composition over dense + sparse vectors.
- Semantic response caching needs one calibrated similarity score for a completed prompt result.
- Sparse/hybrid response-cache lookup is possible as custom policy, but it is not a safe default because fusion mode, sparse score shape, and adapter ranking behavior affect correctness.

Runtime flow:

1. Prompt opts in with `cache.semantic`.
2. The plugin resolves scope, version, output kind, effective TTL, and effective threshold.
3. Lookup embeds the prompt query override or resolved prompt text with a dense embedding.
4. Store lookup filters semantic-cache entries by namespace, prompt id, scope hash, version, and result kind.
5. Hits hydrate `{ text | object, _meta.semanticCache }`; stream hits use adapter-provided synthetic replay.
6. Misses call the provider, evaluate `shouldCache`, write the serialized result with TTL, and annotate mutable results with miss metadata.

Stores must explicitly advertise `capabilities().semanticCache.isolatedVectorNamespace === true`. This avoids silently querying a mixed memory/RAG vector namespace where unrelated vectors can crowd out cache entries before post-filtering.

### SystemBlock Construction

After composing the system string, `composeSystem()` also builds a `SystemBlock[]` array:

- Each non-skipped, non-dropped part becomes a `SystemBlock { source, text, providerCache }`.
- `providerCache` is read from the context's parsed `cache` option (true when `cache` is set).
- The prompt's own system block always has `providerCache: false`.
- `SystemBlock` is re-exported from `@crux/core` (alongside `ResolvedPrompt`) so adapter authors can annotate the `systemBlocks` field without reaching into internal modules.
- Adapters use `systemBlocks` to emit provider-native cache markers:
  - `@crux/anthropic`: Converts to `TextBlockParam[]` with `cache_control: { type: 'ephemeral' }` on blocks where `providerCache: true` (max 4 breakpoints).
  - `@crux/google`: `GoogleCacheManager` creates server-side `CachedContent` objects via `client.caches.create()` with SHA-256 content hashing for dedup. Cacheable blocks go into the server-side cache (`config.cachedContent`), non-cacheable blocks remain as `config.systemInstruction`. Handles concurrency dedup (promise sharing), TTL expiry, LRU eviction, and graceful error fallback.
  - `@crux/ai` (Vercel): Anthropic-only — converts blocks to `SystemModelMessage[]` with `providerOptions.anthropic.cacheControl` when the model is Anthropic.
  - OpenAI: No action needed — prefix caching is automatic with stable ordering.

### Conditional Context Resolution

`flattenContextEntries()` runs before system message assembly. It processes the `ContextEntry[]` from the `use` array:

1. **Falsy entries** (`false`, `null`, `undefined`) are filtered out.
2. **Plain contexts** with a `when` field have their predicate evaluated. If `false`, they are excluded.
3. **`ConditionalContext`** (from `when()` wrapper) has its predicate evaluated. If `false`, the wrapped context is excluded.
4. **`MatchSpec`** (from `match()`) evaluates its discriminator, selects the matching branch, and includes only those contexts.

Excluded contexts contribute nothing — no `systemFn` call, no tool contribution, no token counting. They are tracked in `InspectResult.excludedContexts[]` for observability.

Runtime observability distinguishes excluded context entries from budget-dropped entries: excluded entries are `checked-not-included`, while resolved entries removed by `composeSystem()` are `dropped-budget` entries in the `prompt.budget` artifact.

### Input Schema Merging

At definition time (`prompt`), input schemas from all context entries and the prompt itself are merged into a single Zod object schema:

- Context schemas are merged from all possible entries (including all `match` branches).
- Conditional contexts (via `when()`, `match()`, or context-level `when`) have their keys wrapped as `.optional()` in the merged schema, since they may not be active.
- If two contexts declare the same key, an error is thrown at definition time.
- The prompt's own fields silently override context fields (no error).
- The merged schema is used for input validation in `.resolve()`.

### Provider Adaptation

The `adapt` field on prompts supports three matching strategies, checked in order:

1. **Exact provider match** — `adapt.openai` when provider is `"openai"`
2. **Model ID prefix** — for OpenRouter-style routing where `modelId` is `"openai/gpt-4o"`, the prefix `"openai"` is extracted and matched
3. **Wildcard** — `adapt['*']` applies to all providers

Each adaptation can `prependSystem`, `appendSystem`, `prependPrompt`, `appendPrompt`, and override `settings`.

## Embedding Pipeline

`embedding()` is a first-class dense/sparse primitive, not a retrieval abstraction.

Provider-facing helpers sit above it:

- `@crux/ai` exposes `embedding()` for AI SDK embedding models
- `@crux/openai` exposes `embedding()` for direct OpenAI SDK usage
- `@crux/google` exposes `embedding()` for direct Google GenAI SDK usage
- `@crux/anthropic` stays generation-only on the direct SDK path

Execution model:

1. Validate config once at definition time.
2. Apply configured preprocessors in order.
3. Enforce the truncation policy. The default is fail-fast on `maxInputTokens`; character truncation must be explicit.
4. Check the embedding cache by policy-aware key when configured.
5. Split cache misses into chunks of `batch.maxSize`.
6. Run chunk requests with per-call `batch.concurrency` and optional cross-call `rateLimit.concurrency`.
7. Retry failed provider batches according to the configured retry policy.
8. Reassemble cached and provider results in original input order.
9. Aggregate optional `usage`, `cost`, cache, retry, truncation, and rate-limit metadata across chunks.
10. Emit a canonical `embedding.call` span once per top-level `embed()` or `embedMany()` call, including bounded output metadata artifacts and produced edges.
11. Emit legacy `onEmbedStart` and `onEmbedEnd` instrumentation hooks for compatibility.

Governance is intentionally on `embedding()` instead of retrievers/indexers. Preprocessing, truncation, retry, cache keys, and provider rate limits change the vectors being generated or the provider calls needed to generate them. Placing those policies on the primitive makes every consumer use the same behavior.

Cache keys include:

- embedding kind
- embedding name
- dense dimensions when present
- `maxInputTokens`
- preprocessor fingerprints
- truncation policy
- normalized input hash

Embedding cache access emits nested `cache.lookup` spans with cache namespace, hit/miss counts, write counts, and per-entry hit/miss events. Raw input text and raw vector values are never emitted to OTel. Devtools/CLI/TUI receive bounded embedding metadata such as cache hits, misses, retries, truncated counts, duration, dimensions, usage, and cost.

Hybrid search lives above this layer:

- dense-only vector stores handle `VectorStore.search({ dense })`
- sparse-only and hybrid-capable vector stores handle `VectorStore.search({ sparse })` and `VectorStore.search({ dense, sparse, fusion? })`
- Upstash is the reference `VectorStore` for dense + sparse + hybrid query composition

## Retrieval and Indexing Pipeline

Crux now treats document retrieval as a five-part stack:

1. **Embedding** — `@crux/core/embedding`
2. **Ingestion** — `@crux/ingest`
3. **Indexing** — `@crux/core/indexing`
4. **Corpus sync** — `corpus()` from `@crux/core/indexing`
5. **Retrieval** — `@crux/core/retrieval`

Those boundaries are deliberate:

- embeddings generate vectors
- ingestion loads raw sources into documents
- indexing turns documents into canonical stored chunks
- corpus sync tracks source state across repeated ingestion jobs
- retrieval turns text queries into scored hits, context, and tools
- reranking, when used, happens after raw retrieval and before context/tool rendering

This keeps hybrid support in the correct layer. Dense and sparse are embedding kinds. Hybrid is a retrieval strategy composed through `VectorStore.search({ dense, sparse, fusion })`, not a third embedding kind.

Advanced query-time composition lives in `retrievalPipeline(base, stages)`, not inside store adapters and not as more inline `retriever()` config. The pipeline returns a retriever-compatible object, so direct `retrieve()` and prompt `use: [pipeline]` composition continue to work. Manual `asContext()` and `asTools()` remain available for adapters that need already-expanded context/tool objects. Query stages such as `queryPlanner()` and `multiQuery()` transform typed planned queries before fanout. The fanout calls the base retriever once per planned query, then merges duplicate `namespace/sourceId/chunkId` hits with RRF. Hit stages such as `parentExpand()`, `compress()`, `diversify()`, and `decay()` operate on the merged candidates before final rendering.

Parent expansion relies on write-side metadata. Parent/child indexing writes `parent.key` onto child chunks using the indexer id, namespace, source id, and parent id. `parentExpand()` follows that key and enriches the child hit with parent content without replacing the child identity or score.

Retrieval observability writes the canonical graph directly. Direct retriever calls open `retrieval.query` spans with `retrieval.hits` artifacts and `retrieval.returned` edges. Retrieval pipelines open a parent `retrieval.query` span, fanout and each query/hit stage open `retrieval.stage` child spans, and stage outputs attach bounded `output` artifacts. Devtools and the TUI read the backend graph; OTel receives only privacy-safe metadata unless a caller explicitly configures redaction/content export.

Prompt composition uses a generic injectable `use` contract. Plain contexts still contribute system text, but richer primitives can inject context, tools, constraints, guardrails, and metadata in one resolution pass. `context({ use })` nests the same composition model, so product teams can build reusable contexts that bundle retrieval, grounding, memory, and coordination state without forcing prompt authors to call `asContext()` or `asTools()` manually.

Retrievers and retrieval pipelines are injectable. `use: [retriever]` or `use: [retrievalPipeline(...)]` makes retrieval context and/or tools available according to `inject: 'context' | 'tool' | 'both'`. Raw retrieval injection never enforces answer citations. Citation and provenance guarantees live in `grounding()` from `@crux/core/citations`, which wraps a retriever or pipeline, injects retrieved evidence, and contributes a citation constraint bound to the exact allowed hits for that generation.

Citation validation is exposed as pure APIs (`resolveCitations()`, `renderCitationContext()`) plus `citationConstraint()` for the generation retry loop. Structured citations are canonical. `resolveCitations()` owns the canonical `citation.check` span and bounded `citation.report` artifact, so citation validity, missing/ambiguous hits, quote failures, and valid/invalid counts are inspectable without UI-specific citation parsing.

TypeScript inference is treated as an architecture constraint, not a best-effort convenience. `@crux/core` owns a package-local `typecheck` task with strict `tsc`, compile-time API tests in `__type_tests__/`, and an AST-based explicit-`any` check. The explicit-`any` checker has a tracked legacy baseline so new production `any` usage cannot enter unnoticed; hardening work should shrink that baseline instead of adding broad assertions.

Workspace observability is centralized in the workspace `instrument()` helper. Public calls and workspace tools share the same `workspace.operation` spans, namespace hashing, and bounded result artifacts. The Go backend exposes these through the `workspace` resource activity projection, including linked artifacts and edges, so devtools/TUI readers do not need a workspace-specific tracing protocol.

Plan/task observability is owned by the mutation functions that persist state. `plan()` and `updatePlan()` emit `plan.operation` spans with JSON artifacts containing the plan id, title, version, content, content preview, and metadata; `tasklist()`, `addTask()`, `updateTask()`, `removeTask()`, and `discard()` emit `task.operation`. The Go backend exposes these through the `plan` and `task` resource activity projections and builds the Plans & Tasks read model from those artifacts, so runtime stores behind Convex/serverless boundaries do not need a separate direct enumeration path. Read helpers stay cheap and do not create spans unless a caller wraps them.

Skill loading emits `skill.load` spans from both `fileSkill()` and `resolveRegistrySkill()`, including parse/reference metadata, cache-hit/fetch source, instruction sizes, and bounded previews.

Security warnings remain advisory. Prompt resolution still logs configured warnings, and now emits `security.warning` spans with prompt id, field, pattern, and bounded preview. These spans should be rendered as dev diagnostics, not runtime failures.

`@crux/ingest` normalizes external sources into structured `IngestDocument` values. `parts` is the canonical parse output for text blocks, pages, tables, sheets, and JSON paths; `content` is derived from those parts for the current chunking and retrieval pipeline. This preserves document structure without forcing the indexer or retriever to understand every parser-specific detail.

Loaders expose two read modes. `load()` yields `{ ok: true, document } | { ok: false, ... }` so corpus sync can continue across source-level failures and write failed source records. `documents()` yields plain documents and throws on failure for tests, scripts, and fail-fast jobs.

`corpus()` sits next to `indexer()` because it is still write-side retrieval infrastructure. The indexer knows how to prepare and write chunks for a single operation. The corpus owns the source ledger around repeated operations: content hashes, metadata hashes, index-pipeline fingerprints, source status, stale-source policy, and dry-run planning. This keeps incremental sync explicit without pushing loader state into `@crux/ingest` or query semantics into `@crux/core/retrieval`.

Corpus and indexing observability write the canonical graph directly. `indexer().chunk()`, `indexer().indexDocuments()`, and `indexer().indexChunks()` open `indexing.pipeline` spans; document transforms, chunkers, and chunk transforms open child `indexing.pipeline` stage spans and attach bounded `indexing.report` artifacts with cache status, hashes, counts, and timings. `corpus().sync()` opens `corpus.sync`, records loader results as `ingest.parse` with `ingest.report`, nests indexing work below the corpus span, and attaches a `corpus.report` source-ledger summary artifact. Legacy instrumentation hooks still fire for compatibility, but the backend-owned graph is the source of truth for devtools and TUI rendering.

Parser execution emits `onIngestParseStart` and `onIngestParseEnd`. Devtools forwards those as `ingest:parse:start` and `ingest:parse:end`; the CLI/devtools server keeps them in a runtime ring buffer; `@crux/otel` maps them to `crux.ingest.parse` spans with hashed namespace/source identifiers.

## Middleware Pipeline

Three tiers of hooks handle cross-cutting concerns:

```
generate() / stream() call
  ↓
[1] Prompt Middleware (wraps the full call)
    ├── Optional user/plugin middleware
    └── User middleware (logging, timing, retries)
        ↓
[2] Adapter (generateObject / generateText)
        ↓
[3] Normalize _meta on result
        ↓
[4] Per-prompt hooks
    ├── onGenerate — fires on success
    └── onError — fires on failure
        ↓
Return result to caller
```

### Hook Types

All global hooks live in the `CruxRuntime` object (`runtime.ts`). Use `setRuntime()` to install atomically, `getRuntime()` to read:

| Hook                   | Scope          | Runtime field                       | Purpose                                               |
| ---------------------- | -------------- | ----------------------------------- | ----------------------------------------------------- |
| `PromptMiddleware`     | All prompts    | `runtime.middleware`                | Wrap every generate/stream call                       |
| `ResolveHook`          | Agent adapter  | `runtime.resolveHook`               | Observe `.resolve()` calls without generation         |
| `ExecutionHook`        | Agent adapter  | `runtime.executionHook`             | Observe model calls from agent frameworks             |
| `StreamProgressHook`   | Streaming      | `runtime.streamProgressHook`        | Live streaming metrics (TTFT, chunks)                 |
| `StreamStartHook`      | Streaming      | `runtime.streamStartHook`           | Eager hook before first chunk                         |
| `InstrumentationHooks` | All primitives | `runtime.instrumentationHooks`      | Observe memory, compaction, scoring, agent operations |
| `EvalReporter`         | Eval runs      | `runtime.evalReporter`              | Report eval start/case/end                            |
| `FlowEvalReporter`     | Flow eval runs | `runtime.flowEvalReporter`          | Report flow eval progress                             |
| `onPrepare`            | Single prompt  | `prompt({ hooks: { onPrepare } })`  | After system assembly, before generation              |
| `onGenerate`           | Single prompt  | `prompt({ hooks: { onGenerate } })` | After successful generation                           |
| `onError`              | Single prompt  | `prompt({ hooks: { onError } })`    | After failed generation                               |

### Plugin System (`plugin.ts`)

The plugin system enables composable hook installation. Three key functions:

| Function                             | Purpose                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `mergeRuntime(base, patch)`          | Compose two runtimes: fan-out for hooks, layered chaining for middleware, last-write-wins for observability transport |
| `applyPlugins(plugins, initial)`     | Process plugins in order, each seeing cumulative state. Returns merged runtime + dispose                              |
| `withDevtools()` / `withTelemetry()` | Built-in plugins returning `CruxPluginResult`                                                                         |

**Fan-out semantics**: When two plugins install the same hook (e.g., `onToolStart`), both handlers are called for every event. Neither can suppress the other.

**Layered middleware**: When two plugins install middleware, the later plugin wraps the earlier one. Calling `next()` in the outer middleware invokes the inner middleware.

**Plugin processing in `configure()`**:

1. If `devtools.serverUrl` is truthy, auto-prepend `withDevtools()` to the plugins array
2. Append user-provided `plugins`
3. Call `applyPlugins()` with the accumulated runtime
4. Set final runtime via `setRuntime()`
5. Plugin `dispose()` functions called in reverse order during `registry.dispose()`

### Chaining (Legacy)

The plugin system supersedes the previous manual chaining approach. `withDevtools()` now returns a `CruxPlugin` with hooks in `CruxPluginResult`. `enableDevtools()` remains for imperative use but delegates to the shared `buildDevtoolsRuntime()` function internally.

### Instrumentation Standard

All primitives emit events through `InstrumentationHooks` only. No primitive should reference `collector`, `getRuntime().collector`, or any reporter directly.

**Event flow for hook-based integrations:**

```
Primitive (memory, swarm, flow, etc.)
  → getRuntime().instrumentationHooks?.onXxx(event)
    → Fan-out to all installed plugin handlers
      → OTel handler: create spans
      → Custom handler: user-defined logic
```

Devtools tracing itself uses the canonical `@crux/core/observability` graph runtime. Built-in primitives write `run:start`, `span:start`, `span:event`, `artifact`, `edge`, `span:end`, and `run:end` records; the Go backend validates and persists those records, builds read models, and pushes subscription updates to the web UI and TUI.

**Rules:**

1. Primitives call `instrumentationHooks?.onXxx()` — never `collector.send()`
2. Hook events carry domain data only (flowId, status, durationMs, etc.)
3. Transport metadata (sessionId, traceId, timestamp) is added by handlers at call time from the active observability context.
4. The `RuntimeFlowSessionReporter` remains a public API for users who want manual flow reporting with rich metadata

## configure() Internals

`configure(options)` does the following in order:

1. **Extract flat lists** — Walk tree (via `_all` property or recursive traversal) or use arrays directly
2. **Compute namespace paths** — If trees were passed, map each prompt/context ID to its path in the tree (e.g., `'draft-edit' → ['editor', 'edit']`)
3. **Auto-collect contexts** — Deduplicate contexts from prompts' `use` arrays with explicitly passed contexts
4. **Validate** — All prompts must have an `id`, no duplicate IDs allowed
5. **Build indexes** — `byId: Map<string, Prompt>`, `tagIndex: Map<string, Prompt[]>`
6. **Apply globals** — `setTokenizer()`, `setRuntime()` for middleware if provided
7. **Build plugins array** — Auto-prepend `withDevtools()` if `devtools.serverUrl` is truthy, then append user `plugins`
8. **Apply plugins** — `applyPlugins()` processes in order, each receiving cumulative runtime. Final runtime set via `setRuntime()`
9. **Return frozen registry** — `get`, `find`, `list`, `byTag`, `byTags`, `tags`, `dispose` (dispose calls plugin cleanups in reverse order)

### Tree Walking

`extractPrompts()` and `extractContexts()` handle three input shapes:

- **Flat array** — Pass through directly
- **Object with `_all`** — Use the pre-computed flat list from `createPrompts()`/`createContexts()`
- **Plain nested object** — Recursively walk, collect leaves where `_tag === 'Prompt'` or `_tag === 'Context'`

`computePaths()` recursively traverses the tree, building path arrays as it descends. Each leaf's ID is mapped to its full path (e.g., `{ editor: { edit: promptInstance } }` → `'draft-edit' → ['editor', 'edit']`).

## createPrompts() / createContexts()

Both follow the same pattern:

1. Recursively walk the tree object
2. Validate every leaf is a Prompt/Context instance (check `_tag`)
3. Collect all leaves into a flat array
4. Attach as non-enumerable `_all` property (so it doesn't appear in tree iteration)
5. Deep-freeze the tree (all levels become read-only)

The result provides typed autocomplete at every nesting level while also exposing a flat list for iteration.

## Devtools Instrumentation

### Setup (`observability/devtools.ts`)

`withDevtools(options)` returns a `CruxPlugin` with name `'crux:devtools'`. Internally delegates to `buildDevtoolsRuntime()`:

1. Create the canonical HTTP observability transport — `createHttpObservabilityTransport(serverUrl)`
2. Configure `@crux/core/observability` to deliver graph record batches to the Go backend
3. Return `observabilityTransport` + `dispose()` that restores the previous observability runtime

`enableDevtools()` remains for imperative use — delegates to `buildDevtoolsRuntime()` and calls `setRuntime()` directly.

When used via `config({ devtools: { serverUrl } })`, `configure()` auto-prepends `withDevtools()` to the plugins array so devtools hooks are always installed first.

### Runtime Bridge (`runtime-bridge/index.ts`)

The Runtime Bridge is the local-dev command plane. It is intentionally separate from the observability and Project Catalog planes:

- Observability: runtime -> Go through `POST /api/observability/records`.
- Project Catalog snapshots: runtime -> Go through `POST /api/catalog/snapshot`.
- Runtime Bridge: Go -> runtime through typed `command.request` messages and `command.result` / `command.error` replies.

`@crux/core/runtime-bridge` owns the TypeScript schemas and inferred types for `runtime.hello`, `runtime.heartbeat`, `command.request`, `command.progress`, `command.result`, and `command.error`. `config()` starts a local Node WebSocket peer when `devtools.bridge` resolves to `transport: 'ws'`; the peer advertises derived capabilities, including `store.read` for the configured `CruxStore` and any inspectable resources registered by primitives. Memory and blackboard definitions register those resources as they are created, keeping user DX focused on composing primitives rather than manually wiring devtools stores. `eval.run` is part of the typed command contract and is executed by the Go bridge service through the embedded eval runner so quality persistence and observability reuse the existing eval path. Runtime peers must only advertise `eval.run` if they provide their own direct execution path. Bridge failures are logged as dev warnings and must never throw into user code. HTTP/framework transports are registered by integration packages such as `@crux/convex`; those endpoints derive their public URL from the framework request when possible, advertise request-scoped store capabilities, and convert malformed command bodies into structured `command.error` responses. `crux dev` auto-discovers framework HTTP peers from `CRUX_BRIDGE_URL`, `CONVEX_SITE_URL`, `CONVEX_URL`, or `NEXT_PUBLIC_CONVEX_URL` in the shell or project `.env.local` / `.env`, fetching `/crux/bridge` and registering the manifest-backed peer in Go. Go owns peer selection, command dispatch, subscriptions, and read-model side effects.

Resource Inspection is the product-facing Go service layered above the bridge. Web devtools, the TUI, CLI commands, and future IDE integrations ask Go for capabilities and resources through stable product-shaped calls such as `GET /api/resources/capabilities`, `GET /api/resources/{resourceId}`, and `GET /api/resources/{resourceId}/entries`. The service maps `blackboard:*`, `memory:*`, and `crux.store` requests to bridge `store.read` only when a live peer is available, otherwise it returns structured `unavailable` or `partial` results with reasons such as `bridge_required`, `runtime_unavailable`, `unsupported_resource`, `ambiguous_peer`, or `command_failed`. Clients must not call Convex `/crux/bridge` or construct bridge command envelopes directly. Domain read models can embed this service when that keeps clients simpler: `GET /api/memory/stores/{id}` returns projected memory/blackboard state and an optional `inspection` object. `inspection.status="ok"` plus `source="mixed"` means live entries were joined with the projection; `inspection.status="partial"` plus `source="projection"` means the projection is usable while live runtime inspection is unavailable or failed.

### Canonical Go Backend

The Go devtools backend owns canonical execution graph ingestion, persistence, read models, filtering/search, and subscriptions. The live execution graph route is:

```txt
POST /api/observability/records
```

Routes are thin adapters over services: parse body → call `observability.Service` → return service-owned read models. WebSocket/SSE layers broadcast typed subscription notifications only; they do not interpret raw graph data.

The legacy collector HTTP endpoint has been removed; new code must not post to it.

Local persistence follows a two-plane boundary. SQLite is the canonical runtime store for observability history: runs, spans, events, artifacts, edges, metrics, lifecycle reconciliation inputs, resource activity, and deletion. File-backed observability databases open through a WAL/busy-timeout DSN and a small connection pool so multiple in-flight HTTP flushes, web reads, and TUI reads do not serialize behind one connection; in-memory databases stay single-connection for tests. Span and run upserts merge start/end attribute JSON by stable id, preserving identity attributes from start records while adding terminal measurements from end records even when batches arrive out of order. JSON/JSONL under `.crux/quality` is reserved for portable user/workspace quality state: suites, cases, feedback, cassettes, baselines, insight statuses, and insight silences. Quality read models join both planes in Go services; they do not copy run trees into `.crux/quality/runs`. Run lists, dashboard read models, lifecycle reconciliation, and insights use cheap count/identity SQL plus lightweight run-signal aggregation so local histories of thousands of runs remain responsive. List endpoints default to a newest-first page, avoid span metric JSON scans, and treat optional list enrichment as non-fatal on backend read deadlines; callers that truly need exact metrics should inspect a single run. Full `RunDetail` projection is used only when inspecting one run.

### Deprecated Collector Modules

Collector-shaped runtime/reporting shims and collector protocol schemas have been removed. New tracing code must use `@crux/core/observability` and `POST /api/observability/records`; `withDevtools()` no longer installs collector middleware or reporter hooks. Project definitions use the separate Project Catalog contract owned by `@crux/core/catalog`: `crux dev` indexes source files and `.crux/quality` JSON at startup, runtime prompt/context/tool snapshots enrich the catalog through `POST /api/catalog/snapshot`, and the Go service serves the read model through `GET /api/project/catalog` and migrated `GET /api/catalog`. Catalog indexing follows a fast-plus-enriched architecture: the fast TypeScript AST/source pass publishes the first useful catalog, while bounded TypeScript `Program`/`TypeChecker` semantic analysis enriches proven aliases, barrels, imported symbols, schemas, callbacks, primitive graph relations, and data-access edges in the background. Semantic fact snapshots are cached under `.crux/cache/catalog/semantic-facts-*` using source, import-dependency, tsconfig, compiler-option, and TypeScript-version fingerprints. The cache currently refreshes complete semantic fact sets; true partial semantic reuse remains gated until dependency ownership is materialized. The Go service owns final read-model state, realtime publication, and explicit indexing status; worker failures are published as failed indexing states instead of leaving clients in a cold/loading state. Static source discovery uses a candidate classifier before AST parsing: common output/cache directories are ignored, generated bundles and base64 artifacts are skipped by content signals, oversized authored-looking files emit `catalog.source_too_large`, and ordinary source must contain Crux-relevant signals before parsing. Static catalog discovery scans ordinary project source files and can produce partial first-class definitions for prompts, contexts, `createTool()`/`tool()` tools, schema-only tool definitions with `name`/`description`/`parameters`, and richer primitives such as agents, flows and flow steps, compositions, RAG retrievers/pipelines, memory, memory blocks, blackboards, workspaces, constraints, guardrails, and scorers. It indexes exported declarations and factory-local primitive call sites so framework-specific factory functions, including Convex/serverless factories, still contribute authored app graph nodes when ids and object literals are statically visible. Resolved prompt/context/tool definitions carry inspectable JSON schemas in `ProjectDefinition.metadata.inputSchema` and prompt output schemas in `metadata.outputSchema`, and partial static definitions carry best-effort schemas for common inline Zod expressions. Authored grouping from `createPrompts()`, `createContexts()`, and runtime snapshots is canonical on `ProjectDefinition.path`; file-tree grouping is canonical on `ProjectDefinition.source.file`, with source dependency/dependent edges when known. Supporting source locations such as schema declarations, nested schema declarations, callback functions, prompt/context system constants, direct constants and conservative object-property constants injected into static system templates, Convex Agent config/callback bindings for `prompt`, `tools`, `contextHandler`, and `prepare`, Convex Agent tool-map contributors, handler/prepare-factory arguments, and helper functions are canonical on `ProjectDefinition.sourceRefs`; the Go service preserves them during runtime catalog merges, and UI clients render them directly instead of reconstructing them from snippets. The resolver supports same-file and direct-import schema/callback identifiers for agents, tools, prompts, contexts, safety definitions, scorers, and flow steps; imported prompt `use` context targets and local context-array constants; same-file prompt/context system constants; direct identifiers and simple object-property paths inside static system template interpolations; and Convex Agent `prompt`, `tools`, `contextHandler`, `usageHandler`, and `prepare` bindings. Agent, prompt, context, tool, Convex Agent callback bindings, and flow-step callbacks are scanned through one statically visible helper level for source refs and data-access intelligence. The bounded semantic pass adds compiler-resolved aliases, barrels, imported schemas, callbacks, source refs, and access facts where TypeScript can prove them, while full language-service-grade partial incremental reuse remains future work. Definitions expose `metadata.runtimeJoin` when stable runtime span/resource join attributes can be derived, and `metadata.intelligence` when the indexer has source-backed primitive structure. Runtime joins are authored-to-runtime hints only: `definitionId` is the catalog id, `spanAttributes` contains stable runtime-emitted attributes, and execution-only fields such as flow `flowId` and generated `stepId` are correlation attributes rather than authored identity. Flow definitions join `flow.run` spans by primitive plus span name; flow-step definitions join `flow.step` spans by primitive plus `stepLabel`/span name; memory blocks join by `sourceDefinitionId`, `blockDefinitionId`, runtime `memoryId`, and `blockId`; blackboards join through memory-shaped spans with `memoryType: "blackboard"` instead of a separate `blackboardId`. The intelligence contract is additive and confidence-scored: agents expose visible prompt/tool/handoff dependency intelligence plus visible memory/blackboard/workspace read/write access, normal `flow()` definitions expose immediate ordered control metadata, Convex `flow({ args, handler })` definitions expose validator-derived args schemas plus visible suspension points, tools and flow steps expose visible memory/blackboard/workspace read/write access through `metadata.intelligence.data` and graph relations, literal `parallel()`, `pipeline()`, `consensus()`, and `swarm()` calls expose children, participants, coordinators, pipeline prompt/tool stages, consensus judge/scorer links, and swarm shared memory/blackboard relations through backend-owned definitions such as `composition.parallel.branch` and `composition.pipeline.stage`, literal retrieval pipeline stages expose `rag.pipeline.stage` definitions plus retriever/scorer relations, and workspaces/safety/evals expose literal tool, mount, applies-to, and coverage relations. The Go store and quality service decorate catalog definition copies with `ProjectDefinition.quality` summaries that join prompt/RAG/flow eval runs, experiments, baselines, comparisons, cassettes, and feedback to definitions, suites, traces, pass rates, last status, and changed-since-baseline fingerprint signals and affected eval/suite suggestions without making clients walk raw quality lists. Catalog snapshots also expose `lintFindings`, a backend-owned authored-graph lint read model separate from diagnostics. Diagnostics explain indexer health/fidelity; lint findings are actionable design observations over definitions, relations, and quality joins such as missing eval coverage, quality targets with experiment history but no promoted baseline, prompt/context/tool/flow contract gaps, strict-mode prompt output gaps, strict-mode tool model-output gaps, agent handoffs to non-visible targets, suspending flows without coverage, writable workspaces without guardrails, state resources written without visible read paths, long-lived memory without visible retention policies, consensus compositions without visible judges or scorers, and shared blackboards without conflict policies. Lint findings are registry-backed, include category, maturity, confidence, default profile membership, concrete messages, per-rule rationale, optional impact, structured evidence, fix options, docs URLs and exact suppression directives, support rule-specific source suppressions, and carry backend-computed propagation metadata for approved dependency paths so clients do not walk the graph themselves. `crux.config.ts` may provide `lint.profile` and project-wide `lint.rules` overrides; the TypeScript indexer is the single importer of that config and serializes the resulting policy onto `ProjectCatalogSnapshot.lint`. Go read-model enrichers consume that serialized policy after appending quality/runtime-backed findings, so TS-produced and Go-produced findings share profile, rule override, and source-suppression semantics before the catalog is exposed. Unknown configured rule ids become catalog diagnostics. `crux lint` is a thin CLI presentation over the same Go-owned catalog service: it is non-blocking by default, supports JSON output and profile selection, and only exits nonzero when an explicit `--fail-on=error|warning|info` threshold is requested. Resource activity views for memory, workspace, plan, and task read `GET /api/observability/resources/{family}` from the Go service.

Convex-specific catalog discovery also recognizes `new Agent(...)` from `@crux/convex/agent`, direct `convexAgent({...})`, profile-created `crux.convexAgent({...})`, and Convex `flow({ name, args, handler })` definitions, including flow args, statically visible `flow.step()` calls inside the handler, and visible `flow.waitFor()` / `flow.suspend()` suspension signals linked by `flow.step.waits_for_signal`. Memory storage bindings are first-class `memory.store` definitions linked by `memory.uses_store` and `blackboard.uses_store`; memory blocks remain linked by `memory.includes_block`.

Convex Agent source-ref binding support includes `usageHandler` alongside `prompt`, `tools`, `contextHandler`, and `prepare`; all of these remain supporting source refs, not runtime graph edges.

The Go service exposes one normal run inspection read model: `GET /api/observability/runs/{runId}` returns `RunDetail`. Raw canonical graph access is debug-only. The normal detail route does not load raw record payloads or run summary count subqueries before projection; it reads the run graph tables needed for projection and leaves raw records to `GET /api/observability/runs/{runId}/graph`. `RunDetail` is the default human trace view for web devtools and the Go TUI: spans are classified into visible Primary Operations, Transition Operations, Suspension Markers, and folded details; every canonical span has a `spanIndex` placement; every visible node and folded detail exposes `source` metadata so clients can show the presentation parent without losing the canonical parent; details attach through semantic ownership before chronology; delegate and handoff rows sit beside their source/target operations instead of creating visual containment. Model-emitted tool intents are `tool.request` artifacts on the generation; user-code tool executions remain `tool.call` spans and may present as agent-timeline siblings linked by tool call id. When a tool execution is promoted out of a Convex Agent generation container, relation-aware ordering keeps the generating turn before the tool even if cross-action timestamps are equal, delayed, or noisy. Flow suspensions are `flow.suspension` operations presented as flow-level timeline markers, not as stuck generations or open steps. Completion-only spans with no start metadata are retained as details instead of becoming anonymous trace rows. Custom spans can override classification with `attributes.presentation.display = "primary" | "detail" | "metadata"` and can hint ownership with `attributes.presentation.ownerSpanId`.

RunDetail also owns presentation-only lifecycle reconciliation, status rollups, aggregate metric rollups, and curated inspection sections. Canonical graph records remain append-only and lossless, but the read model can make truthful state derived from reliable signals: Convex boundary acknowledgements can close missing parent-side runtime boundary ends, expired Convex boundary leases can mark abandoned action/schedule boundaries stale, and expired `operation.deadline` events can mark a missing generation/stream end plus its still-open ancestors as incomplete observability. Execution-changing governance rolls ancestors up to `blocked`, intentional flow waits roll ancestors up to `suspended`, and subtree token/cost/count metrics roll up through every visible branch. Curated node inspection groups canonical records into tools, retrieval, memory, context, safety, scores, citations, events, diagnostics, metrics, and raw sections while preserving every accepted raw record. While a future deadline is still active, the read model does not prematurely mark that branch stale. Deadline reconciliation is a telemetry diagnostic, not an application error. The Go service runs a lightweight lifecycle ticker and publishes `observability.lifecycle` notifications when a running run changes presentation state, or when a completed run still has stale open descendants, so web devtools and the TUI do not stay visually stuck.

The TypeScript DTO for that projection lives in `@crux/core/observability` as the Run Detail contract; the Go service and devtools UI mirror that contract without code generation.

Model info extraction handles AI SDK model objects (`.provider`, `.modelId`), string models (`"provider:modelId"`), and nested objects with `config.provider`.

### Observability Context Propagation

The run graph (waterfall in devtools / CLI) is built from canonical observability records:

- `run:start` / `run:end` define the initiating run.
- `span:start` / `span:end` define timed work with `spanId` and `parentSpanId`.
- `span:event` records point-in-time details inside a span.
- `artifact` records carry bounded payload previews or references. Delegate and handoff primitives use canonical `input` / `output` artifacts so the read model can expose args, payloads, and results without UI-side interpretation.
- `edge` records carry non-tree relationships such as handoff payloads, delegated invocations, retrieval results, citations, feedback, or replay links.

`parentSpanId` is the canonical tree signal — equivalent to the `parent-id` segment of W3C `traceparent`. With it set, the backend parents the child span directly under the specific boundary span (tool / delegate / flow / handoff / composition / retrieval / embedding) that triggered it.

**The contract — three rules:**

1. **Boundary primitives open an observed span for the lifetime of their body.** Implemented via `observe.span(...)` from `@crux/core/observability`:

   ```ts
   import { observe } from '@crux/core/observability'

   return observe.span({
     name: 'delegate',
     family: 'delegate',
     primitive: 'delegate.invoke',
     attributes: { delegateId },
   }, async () => {
     const result = await execute(...)
     return result
   })
   ```

   `observe.span()` emits the canonical `span:start` and `span:end` records, pushes the span id onto the active observability context, and records errors automatically. Built-in primitives for generation, prompt resolution, tools, memory, retrieval, indexing, compaction, scoring, plans/tasks, routing, agents, flows, compositions, handoffs, and delegates follow this pattern. Manual `observe.openSpan()` users must close every terminal path with `end()` or `error()`; streaming generation spans additionally close when the raw stream iterator completes or errors, even if usage metadata is read later. Detail-only spans can set `implicitRun: false` so they attach to an existing run when present but never become the visible root run by themselves; routing resolution uses this because `router.resolve` explains model choice rather than the user's initiating work.

2. **The observability runtime captures the current parent span on `span:start`.** Every new span records the deepest-open span at the moment it began. In-process, this is automatic via AsyncLocalStorage. The captured value lands on the canonical `parentSpanId` field.

3. **Transport helpers pack captured observability context across async-context boundaries.** `AsyncLocalStorage` doesn't survive Convex `ctx.runAction()`, edge-worker fetch, or HTTP. Cross-boundary transports must explicitly pack the captured context into the call payload, and the receiving side must call `observe.withContext(...)` before invoking any SDK code. Convex code uses `@crux/convex/server` `action()` / `internalAction()` / `query()` / `mutation()` wrappers plus `ctx.crux.runAction()` for awaited child work. `ctx.crux.scheduler.runAfter()` records an enqueue boundary but detaches by default; scheduled work starts its own semantic run unless the caller explicitly passes `{ observability }` for a durable continuation such as a flow resume. These helpers restore context on the receiving side when present, flush the active boundary span before crossing into child workers, emit a boundary lease, and flush bounded action deliveries before the worker exits. Do not use `flow()` as a generic tracing wrapper for external framework agent turns; a Convex Agent chat response is an `agent.run` root/span, while `flow.run` is reserved for actual Crux flow handles. Convex Agent integrations import `Agent`, `createTool`, or `wrapConvexTool(tool, { name })` from `@crux/convex/agent` so prompt/use[] resolution, memory, retrieval, generation streams, and tools nest under the agent turn; handlers receive `ctx.crux`; result and step usage/cost shapes are normalized for run-level rollups; and the backend receives both `toolName` and `toolCallId`.

   Other runtimes (Cloudflare Workers, AWS Lambda, etc.) implement the same pattern with their own packing/unpacking. The contract is universal; only the transport vehicle changes.

`execution-context.ts` is intentionally separate from observability. It carries session, flow, parent-flow, and step metadata needed while code executes. It does not carry a span stack, create span ids, or determine graph parenting; `@crux/core/observability` owns all run/span relationships.

### Serializers (`catalog/serializers.ts`)

- **`zodToJson(schema)`** — Converts Zod schemas to JSON Schema. Uses Zod v4's built-in `.toJSONSchema()` first, falls back to manual extraction from Zod internals.
- **`serializePrompt(prompt, path?)`** — Extracts: id, description, tags, inputSchema, outputSchema, contextIds, hasOutput, settings, path
- **`serializeContext(context, path?, usedBy?)`** — Extracts: id, description, priority, inputSchema, isStatic, usedBy, path
- **`serializeCatalog(prompts, contexts, paths?)`** — Deduplicates contexts (from explicit list + prompts' `use` arrays), serializes everything, applies namespace paths
- **Project indexer memory metadata** — Static discovery projects `memory()` and `blackboard()` source locations, store bindings, blackboard schemas, and first-class `memory.block` definitions for visible `workingState()`, `episodes()`, `facts()`, `procedures()`, and `reflections()` blocks when those values are authored as literals or local identifiers. Runtime memory spans carry source definition ids and schema metadata so Go read models can join observed operations back to catalog definitions without UI-side inference. Memory block runtime joins use `sourceDefinitionId`, `blockDefinitionId`, runtime `memoryId`, and `blockId`; blackboard joins use the memory span shape plus `memoryType: "blackboard"`.

### Removed Legacy Protocol

The old collector protocol has been removed from `@crux/core`. New tracing uses `@crux/core/observability` records and the Go backend validates batches at `POST /api/observability/records`. Non-execution catalog data uses `@crux/core/catalog` contracts and `/api/catalog/snapshot` instead of being disguised as spans.

### InstrumentationHooks

`InstrumentationHooks` is a global singleton (same pattern as `PromptMiddleware`) with optional callbacks for all instrumented operations:

```ts
interface InstrumentationHooks {
  // Memory
  onMemoryRead?: (event: {
    memoryId
    operation
    query?
    resultCount
    durationMs
    spanId?
    runId?
    metadata?
    snapshot?
  }) => void
  onMemoryWrite?: (event: { memoryId; operation; entryKey?; spanId?; runId?; metadata?; snapshot? }) => void
  // Compaction
  onCompactStart?: (event: { reason; inputMessageCount; inputTokens }) => void
  onCompactEnd?: (event: { outputTokens; compressionRatio; summaryPreview?; durationMs }) => void
  onBudgetCheck?: (event: { used; available; level }) => void
  // Agent coordination
  onBlackboardUpdate?: (event: { boardId; fieldsChanged }) => void
  onHandoffPrepare?: (event: { handoffId; inputSize; outputSize; input?; output? }) => void
  onDelegateStart?: (event: { delegateId; handoffId; inputSize; input? }) => void
  onDelegateComplete?: (event: { delegateId; handoffId; durationMs; inputSize; outputSize; output? }) => void
  // Tools
  onToolStart?: (event: { toolCallId; toolName; args?; traceId? }) => void
  onToolEnd?: (event: {
    toolCallId
    toolName
    durationMs
    result?
    modelOutput?
    modelOutputType?
    outputSize?
    modelOutputSize?
    tokenSavingsEstimate?
    modelOutputError?
    error?
    estimated?
    traceId?
  }) => void
  // Scoring
  onJudgeResult?: (event: { metricId; score; reasoning?; evalId? }) => void
  onSecurityWarning?: (event: { promptId; field; pattern; message; inputPreview }) => void
  // Compositions
  onCompositionStart?: (event: { compositionId; kind; agentIds; startAgent?; maxHandoffs? }) => void
  onCompositionAgent?: (event: {
    compositionId
    agentId
    index
    status
    durationMs
    error?
    handoffFrom?
    handoffReason?
    hopNumber?
  }) => void
  onCompositionEnd?: (event: {
    compositionId
    kind
    status
    durationMs
    agentCount
    agreement?
    handoffPath?
    handoffCount?
    finalAgentId?
  }) => void
  // Flows
  onFlowStart?: (event: { flowId; name; parentFlowId?; goal? }) => void
  onFlowEnd?: (event: { flowId; name; status; durationMs; totalSteps; error? }) => void
  onStepStart?: (event: { flowId; stepId; label }) => void
  onStepEnd?: (event: { flowId; stepId; label; status; durationMs; error? }) => void
  // Flow lifecycle (suspend/resume)
  onFlowSuspend?: (event: { flowId; name; suspendPoint }) => void
  onFlowResume?: (event: { flowId; name }) => void
  onFlowSignal?: (event: { flowId; signalName; payload }) => void
  onFlowCancel?: (event: { flowId; name; reason? }) => void
  onFlowExpired?: (event: { flowId; name; suspendPoint }) => void
}
```

Each primitive calls `getRuntime().instrumentationHooks?.onXxx?.(...)` — zero cost when no hooks are installed. Plugins install hooks via the plugin system; `mergeRuntime()` automatically fan-outs multiple handlers for the same hook.

The `evalId` field on `onJudgeResult` enables correlation: when judges are called from `evaluateContext()` or `evaluateCompaction()`, the eval function passes its `evalId` through `JudgeScoreOptions`, and the judge includes it in the hook event. This allows devtools to link individual judge scores back to the eval run that triggered them.

Tool execution keeps raw output and model-facing output separate. `execute()` returns the raw application value; optional `toModelOutput()` returns the provider-neutral `ToolModelOutput` fed to the next model step. The core adapter loop records both shapes on `ToolResultEntry`, renders a deterministic string fallback for canonical `Message`, and emits size/savings metadata through instrumentation. It also writes the canonical observability graph directly: model-emitted tool intents attach to the active generation as `tool.request` artifacts; every adapter-managed execution opens a `tool.call` span, consumes a `tool.args` artifact, produces separate raw and model-facing `tool.result` artifacts, and records errors as errored spans. `@crux/ai` delegates conversion to the AI SDK's native `toModelOutput` hook and wraps it only for observability.

Native adapters read the structured `modelOutput` stored on tool-result message metadata. Google maps content outputs to function responses with native inline media parts when possible. Anthropic maps text, images, and PDFs to native `tool_result` content blocks when possible. OpenAI Chat Completions only accepts text tool-result content, so non-text parts are represented as deterministic textual references rather than being silently dropped.

Tool middleware is intentionally separate from prompt middleware. `PromptMiddleware` wraps the whole generate/stream operation; `ToolMiddleware` wraps each tool definition before execution. The final chain is prompt-level middleware first, then call-site middleware, applied after context/prompt/call-site tool merging so policies see the actual executable tool set. `toolMiddleware()` is the generic wrapper for before/after/error hooks. `approvalMiddleware()` is a convenience wrapper that sets provider-compatible `needsApproval` on matched tools and stores callback metadata for resume.

Approval is return-and-resume, not a blocking await and not flow suspension. On the first request, the adapter returns an approval request in message history. The AI SDK adapter uses AI SDK `tool-approval-request` parts; native OpenAI/Google/Anthropic adapters use Crux message metadata exposed through `result.messages`. The client records the id and sends a later `tool-approval-response` via `appendToolApprovalResponse()` or an equivalent message. Native approval requests include an `approvalToken`, and resume rejects decisions that do not echo that token. On resume, `notifyToolApprovalResponses()` scans message history, calls `onApproved` or `onDenied` once per approval id, and lets the adapter execute approved tool calls or return execution-denied output for denied calls. Approval request, approval, denial, and token mismatch paths emit `tool.approval` spans, so devtools can explain why a tool ran, did not run, or failed trust validation. This keeps approvals compatible with serverless and Convex actions because no long-lived promise or in-memory modal state is required. Server code must resume from server-issued message history or trusted session storage for mutating tools; approval is a human-in-the-loop execution gate, not a replacement for tool-level authorization.

## Memory Primitives

### Architecture

The primary memory API is block composition. `memory()` owns lifecycle, namespace resolution, prompt context, tool merging, turn capture, flushing, and proposal management. Blocks own one access pattern:

```
memory()
  ├── recentMessages()  Bounded recent chat continuity
  ├── workingState()    Single typed state value
  ├── episodes()        Append-only event memory with dense recall; optional `retention` policy + `evict()` GC telemetry
  ├── facts()           Extracted declarative knowledge, proposed by default
  ├── procedures()      Extracted operating memory, proposed by default
  └── memoryBlock()     Custom render/tools/capture/approval behavior
```

Storage keys use the composed memory ID, namespace, block ID, and entry ID:

```
memory:{memoryId}:{namespace}:block:{blockId}:{entryId}
memory:{memoryId}:{namespace}:proposal:{proposalId}
```

`namespace` is hashed before being emitted to observability sinks. The raw namespace stays in the store key because stores need deterministic partitioning; devtools and OTel only receive `namespaceHash`.

Built-in block reads and writes emit the canonical observability graph from the shared memory hook path. Reads use `memory.read` spans; writes, captures, proposals, approval/rejection, clears, deletes, and state updates use `memory.write` spans. `blackboard()` uses the same memory family for direct reads/writes and focused tools, with `memoryType: "blackboard"` and `memory.snapshot` artifacts for state previews. When a block supplies a snapshot, Crux records a `memory.snapshot` artifact and connects it with a `memory.read` or `memory.write` edge. This keeps memory hydration nested under prompt/context spans when memory is rendered through `memory().asContext()`, while standalone memory operations still produce implicit runs.

### Storage Contracts

Crux public storage is split by capability:

1. **`DataStore`** — JSON records with `get`, `set`, `delete`, `list`, optional TTL, and optional subscriptions.
2. **`VectorStore`** — Dense, sparse, and hybrid vector records with `upsert`, `delete`, and `search`.
3. **`BlobStore`** — Binary and oversized payload storage for workspaces.
4. **`Storage`** — A convenience bundle: `{ data, vectors?, blobs? }`.

`CruxStore` remains as a compatibility shape for older adapters and primitives that still need a combined record/vector object, but new user-facing APIs should request the narrow capability they need.

The in-memory implementations are Map-backed and suitable for testing and single-process development: `inMemoryDataStore()`, `inMemoryVectorStore()`, `inMemoryBlobStore()`, and `inMemoryStorage()`.

### Tool Description Override

Memory primitives accept an optional `tool?: ToolConfig` in their config. For `blackboard()`, `tool.description` is appended as domain guidance to focused `.asTools()` descriptions. Focused blackboard tools can also be disambiguated with `tools.prefix` when multiple boards are injected into the same prompt.

The `ToolConfig` type is exported from `@crux/core/memory`:

```ts
interface ToolConfig {
  description: string
}
```

### Working Memory Internals

A thin wrapper around a single store key. Schema validation runs on every `set()` and `patch()`. TTL support uses `updatedAt` timestamp comparison against `Date.now()` — expired entries return `null` from `get()` but are only cleaned up lazily.

`patch()` merges via `{ ...existing, ...partial }` then calls `set()` internally, so validation runs on the merged result.

### Episodic Memory Internals

Keys are auto-generated as `episodic:{id}:{timestamp}-{counter}-{random}`. The `record()` method optionally embeds content via the provided `embed` function before storing.

`recall()` has two paths:

- **With embeddings**: Embeds the query, calls `store.vectorSearch()`, takes top-N results
- **Without embeddings**: Falls back to `store.list()` by prefix (recency order)

Both paths respect `filter` for metadata matching.

### Semantic Memory Internals

Like episodic but adds confidence scoring. Each entry stores `confidence` and `confirmedAt` in metadata. Time-based decay is computed on read:

```
effectiveConfidence = storedConfidence × 2^(-elapsed / decayMs)
```

`confirm()` resets confidence to 1.0 and updates `confirmedAt`. `prune()` evaluates decay for all entries and deletes those below the threshold.

## Compaction Primitives

### summarizeMessages

Stateless: formats messages into a numbered transcript, sends to an LLM with a structured system prompt requesting preservation of key facts, decisions, and context. Returns the summary with before/after token counts. It opens a canonical `compaction.run` span and attaches a bounded output artifact with summary preview, before/after token counts, compression ratio, focus, and model metadata.

### Sliding Window

Stateful, backed by `CruxStore`. Maintains a running summary under `compact:{id}:summary` and message entries under `compact:{id}:msg:{index}`.

When `push()` exceeds `windowSize`:

1. Collect evicted messages (oldest beyond window)
2. Emit `onCompactStart` hook with input stats
3. Call `summarizeMessages()` with evicted messages + existing summary as focus
4. Replace summary in store, remove evicted message keys
5. Emit `onCompactEnd` hook with compression stats

`getMessages()` returns `[summaryMessage, ...windowedMessages]` or just `windowedMessages` if no summary exists.

### Budget Manager

Pure synchronous computation — no storage, no LLM calls. Tracks token usage by named source. `check()` computes pressure as `used / limit` and maps to levels via configurable thresholds. It emits the legacy `onBudgetCheck` instrumentation hook and a canonical `prompt.budget` span containing the pressure level, thresholds, source breakdown, used tokens, and available tokens.

### extractKeyFacts

One-shot: sends the full conversation to an LLM with a Zod schema, gets back structured output. No memory, no state — just `generateObject()` with a system prompt.

## Scoring Primitives

### LLM Judge

`llmJudge<TDetail>(config)` pre-builds the system prompt from criteria, scale, rubric, chain-of-thought instructions, and few-shot examples. Each `score()` call:

1. Build user prompt from input/output/reference
2. Build output schema — base `{ reasoning, score }` merged with `config.detailSchema` if present (becomes `{ reasoning, score, detail: TDetail }`)
3. Call `generateObject()` with the output schema
4. Clamp score to scale range
5. Emit a canonical `scoring.judge` span with metric id, scale, model label, eval correlation id, clamping metadata, and a bounded `score.report` artifact
6. Emit `onJudgeResult` instrumentation hook (with `evalId` if provided in options)
7. Return `JudgeResult<TDetail>` — `{ score, reasoning, metricId, detail? }`

### Detail Schema

When `detailSchema` is provided in `JudgeConfig`, the judge returns structured domain data alongside the numeric score. The generic `TDetail` flows through the full type chain:

```
JudgeConfig<TDetail> → JudgeInstance<TDetail> → JudgeResult<TDetail>
```

Example: a brand alignment judge with `detailSchema: z.object({ notes: z.array(z.string()) })` returns `JudgeResult<{ notes: string[] }>` — no type assertions needed at call sites.

### Eval–Judge Correlation

`evaluateContext()` and `evaluateCompaction()` generate a unique `evalId` per run, report eval start/case/end events to the global `EvalReporter`, and thread `evalId` through every `judge.score()` call. This means individual `judge:result` events in devtools can be correlated back to their parent eval run.

`evaluateCompaction()` creates a unique judge per eval run (`compaction-fidelity:{evalId}`) to avoid metric ID collisions across concurrent eval runs.

## Flow Suspend/Resume

### flow and FlowHandle

`flow(name, handler)` returns a frozen `FlowHandle<T, TInput>` that separates flow definition from execution. The handler is captured once; `.run(options?)` can be called repeatedly with different inputs. `.signal(flowId, name, payload?)` delegates to `signalFlow()` for resume. The internal execution engine (`withFlow()`) remains private — `flow` is the public API.

### Mechanism

`flow.suspend(name)` throws a `FlowSuspendedError` to unwind the call stack. The internal executor catches it and persists a `FlowSnapshot` to `CruxStore` at `crux:flow:{flowId}`. No code after `suspend()` executes in the current call.

```
flow.suspend('approval')
  → throw FlowSuspendedError('approval')
    → caught by executor
      → persist snapshot { flowId, status: 'suspended', completedSteps, traceContext, observabilityContext }
        → emit span:end status='suspended'
        → return { status: 'suspended', flowId, suspendedAt }
```

### Resume (skip-replay)

On resume (`handle.run({ resume: flowId })`), the snapshot is loaded from the store. All previously completed steps return their cached output without re-executing:

```
handle.run({ resume: 'flow-123' })
  → load snapshot from store
    → flow.step('plan', ...) → return cached output (no execution)
    → flow.step('search', ...) → return cached output (no execution)
    → flow.suspend('approval') → check for signal in store
      → signal found → return signal payload, continue execution
      → signal not found → re-suspend (throw FlowSuspendedError)
```

The snapshot stores the parent observability context from the original run. If
resume starts in a fresh worker without active async context, `withFlow()`
restores that context before opening the resumed `flow.run` span. Convex
`@crux/convex/server` also uses the stored context when `.signal()` schedules
the resume action, so the resumed action appends to the same run id instead of
creating a new standalone `internalAction` run. The Go read model treats
`suspended` as a real run/span status and updates the same run when final
`run:end status='ok' | 'error' | 'cancelled'` records arrive.

### Signal delivery

External code calls `signalFlow(flowId, name, payload)` which resolves the store from the runtime and writes to `crux:signal:{flowId}:{name}`. On resume, `suspend()` checks for the signal key before throwing — if found, it validates the payload against the optional schema and returns it.

### Timeout and expiration

`suspend({ timeout: '24h' })` records `timeoutAt` in the snapshot. On resume, if `Date.now() > timeoutAt`, a `FlowExpiredError` is thrown instead of continuing. The `onExpired` callback fires before the error propagates.

### Cancel

`flow.cancel(reason)` and `cancelFlow(flowId, reason)` both result in `{ status: 'cancelled' }`. The former throws a `FlowCancelledError` to unwind; the latter updates the stored snapshot status.

### Store keys

| Key pattern                   | Content                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `crux:flow:{flowId}`          | `FlowSnapshot` — status, completed steps, observability context |
| `crux:signal:{flowId}:{name}` | Signal payload + `signaledAt` timestamp                         |

### Observability

`onFlowEnd` fires only on terminal states (completed, failed, cancelled, expired). Suspended flows fire `onFlowSuspend` — the flow is paused, not finished. On resume, `onFlowResume` fires before step execution begins. OTel spans end on suspend and start fresh on resume, correlated by `crux.flow.id`.

### Durable composition boundary

`pipeline()`, `parallel()`, `consensus()`, and `swarm()` are immediate compositions: they execute inside the current runtime boundary and either complete or throw. Durable suspend/resume, human approval gates, scheduled work, and serverless/Convex continuation belong in `flow()`, where `flow.step()` owns replay, signals, cancellation, timeout, and persisted observability context.

## Agent Coordination Primitives

### Blackboard

Shared typed scratchpad backed by `CruxStore`. Single store key: `blackboard:{id}`. State is a JSON object matching the Zod schema.

`blackboard()` is an agent coordination primitive, not memory. Memory owns private or persistent recall and post-generation capture. Blackboard owns shared, explicit coordination state between agents, flows, and tools.

**Prompt `use` integration**: a blackboard has `_tag: 'Blackboard'` and is accepted directly in prompt `use`. Resolution expands it into `board.asContext()` and merges focused tools from `board.asTools()` into `resolved.tools`. `board.asContext()` remains context-only for callers that do not want tools. Multiple auto-injected boards must avoid tool-name collisions by setting `tools.prefix`.

**Per-field validation**: `set(field, value)` validates only the written field via `schema.shape[field].parse(value)`, not the full board. This supports partial writes — agents can set individual fields without providing the entire board state. The `.asTools()` method exposes focused Zod-validated tools, so the LLM's tool arguments are validated at the field level before writes.

**Change notification**: After every write, `notify(fieldsChanged)`:

1. Calls in-process subscribers (registered via `subscribe()`)
2. Calls the `onUpdate` callback from config
3. Calls `getRuntime().instrumentationHooks?.onBlackboardUpdate?.()`

### Handoff

Transform pipeline with optional persistence. Supports two modes:

**Stateless** — `prepare()` runs:

1. `inputSchema.parse(input)` — validate sending agent's output
2. `transform(validatedInput)` — map to receiving agent's format
3. `outputSchema.parse(transformed)` — validate output shape
4. Optional: `summarize()` — LLM-compress the payload for token efficiency
5. Emit `onHandoffPrepare` instrumentation hook (with `input` and `output` payload snapshots)
6. Return `HandoffPayload { handoffId, data, summary?, createdAt }`

`asContext(payload)` takes the payload as an argument and injects it as a system message with priority 80.

**Stored** — when `store: CruxStore` is configured:

- `send(input)` — calls `prepare()` then persists to `store.set('handoff:${id}', serialized)`
- `receive()` — calls `store.get('handoff:${id}')` and deserializes to `HandoffPayload`
- Enables distributed agents running in separate processes/actions (e.g., Convex, serverless)
- `send()`/`receive()` throw with a clear error if `store` is not configured

### Delegate

`delegate()` combines a handoff contract with a subagent execution function and exposes the result as a callable tool for orchestrating agents.

**Typed context** — the `TCtx` generic parameter (defaults to `unknown`) threads framework-specific data through `execute` and `.run()`:

```
delegate<TArgs, THandoffInput, THandoffOutput, TCtx>
  .execute(args: TArgs, ctx: TCtx)   // typed context
  .run(args: TArgs, ctx: TCtx)       // typed context required
  .asTools()                         // convenience tool set for simple cases
```

Three-layer validation:

1. `argsSchema` — validates what the LLM provides when calling the tool
2. `handoff.inputSchema` — validates the subagent's return value
3. `handoff.outputSchema` — transformed data for the consumer

The delegate emits `onDelegateStart` (with input snapshot) and `onDelegateComplete` (with output snapshot) instrumentation events. For frameworks with custom tool shapes, use `.run()` directly.

### Composition Utilities

All composition utilities follow the same factory pattern: `createX(executor)` returns a bound function. `createCompositions(executor)` bundles all four: `{ parallel, pipeline, consensus, swarm }`. Each SDK adapter creates an executor and re-exports the bound compositions.

**Agent definition**: `agent()` bundles prompt + optional model + tools + handoffs into a frozen data object. The `handoffs: string[]` field declares peer routing targets for `swarm()` (validated at runtime, not at definition time). Defaults to `[]`. The `AnyAgent` type alias (`Agent<z.ZodType, z.ZodType | undefined, readonly Context<any>[]>`) provides a non-generic handle for collections and runtime checks. `isAgent(value): value is AnyAgent` is the type guard.

**Type utilities**: `InferAgentInput<T>` and `InferAgentOutput<T>` extract the input/output Zod inferred types from an `Agent` instance. `StepName<S>` and `StepOutput<S>` extract name and output types from pipeline step definitions. `AnyPrompt` (from `@crux/core`) is the non-generic prompt equivalent.

**Executor interface**: `AgentExecutor(agent, options) → AgentResult`. `ExecuteOptions` includes `maxSteps?: number` for multi-step tool loops — the AI SDK adapter passes it through as `stopWhen: stepCountIs(N)`, while OpenAI/Anthropic/Google adapters implement manual tool loops.

**Pipeline**: `pipeline(steps, options)` chains agents sequentially with typed context accumulation. Each step has a `name`, an `agent` or `fn` function, and an optional `input` callback. The `input` callback receives the accumulated context object (seed + all previous step outputs keyed by name). The result is `PipelineResult` with `.context` (full accumulated context with named outputs) and `.finalOutput`. Steps can be plain agent steps or `fn` steps (arbitrary async functions receiving the accumulated context). Options use `context` (not `input`) for the seed value.

**Parallel**: `parallel(options)` runs named agents concurrently. Options use `context` (not `input`) for the seed value and `agents` as a named record. Results are a typed record keyed by agent name (`result.results.name`). There is no `merge` callback — consumers access individual results directly. `onError: 'continue'` mode returns `settled` with discriminated `SettledResult` per agent.

### Swarm

`createSwarm(executor)` returns a `swarm()` function that implements peer-to-peer agent routing.

**Core loop:**

1. Validate: `startAgent` exists in agents map, all agents' `handoffs` targets exist
2. For current agent, generate `transfer_to_<id>` tools from `agent.handoffs` (Zod schema: `{ reason: string, context: string }`)
3. Each tool's `execute` sets a closure variable `pendingHandoff`
4. Call `executor(agent, { input, model, tools: transferTools, maxSteps })`
5. After executor returns, check `pendingHandoff`:
   - If set: increment `handoffCount`, check `maxHandoffs`, build next input via `history` mode, switch agent, continue
   - If not set: return `SwarmResult`
6. If `handoffCount >= maxHandoffs`: emit `composition:end` (error), throw `SwarmError` with full path

**History modes:**

- `'transfer-only'` (default): next agent gets `{ ...originalInput, _handoff: { fromAgent, toAgent, reason, context } }`
- `'accumulate'`: adds `_previousOutput` and `_handoffPath` to the input
- Custom function: `(ctx: SwarmHandoffContext) => unknown` — receives full context, returns arbitrary input

**Instrumentation:** Emits `composition:start/agent/end` events with `kind: 'swarm'` and swarm-specific fields (`startAgent`, `maxHandoffs`, `handoffFrom`, `handoffReason`, `hopNumber`, `handoffPath`, `handoffCount`, `finalAgentId`). Error paths (agent executor throws, maxHandoffs exceeded) both emit `composition:end` with `status: 'error'` before re-throwing.

**Transfer tool naming:** `transfer_to_<agentId>` with the target's `description` field in the tool description. Self-transfers are excluded (agent can't transfer to itself). Conditional handoffs (`{ id, when }`) append the `when` condition to the tool description.

**Tool filtering:** `agent.swarmTools` whitelists which agent tools are available in swarm context. `SwarmOptions.activeTools` provides per-agent overrides (takes precedence). Transfer tools are always included. Without filtering, all agent tools are available.

**Cost tracking:** `onCost` callback fires after each agent execution with accumulated `{ inputTokens, outputTokens, totalTokens, abort() }`. `abort()` stops the swarm cleanly. `dryRun: true` returns `{ agentCount, maxPossibleHops }` without executing agents.

**Context summarization:** In `'accumulate'` mode, `summarize: { generate, model, after }` compresses `_previousOutput` via LLM after N handoffs. Uses `GenerateTextFn` from `@crux/core/compaction/types`.

### Shared Infrastructure

**Retry utility:** `executeWithRetry()` in `@crux/core/retry` — shared by `flow()` steps and immediate compositions. Supports linear/exponential backoff + fallback. It treats Crux policy-terminal errors (`GuardrailBlockedError`, `ConstraintViolationError`, `ValidationExhaustedError`) as non-retryable by default and does not run execution fallback for them, so retries cannot bypass safety, validation, or constraint decisions. Advanced callers can override eligibility with `shouldRetry`.

**Observability context:** All compositions open canonical spans around agent executions. This enables:

- Step-level graphing in devtools (each agent execution is a named span)
- Run grouping and cross-span relationships through canonical ids
- Nested compositions (inner compositions inherit the parent's observability context)

**Composition nesting:** Any composition can run inside any other composition. A pipeline step can run a parallel, a swarm agent can trigger a consensus, etc. Observability context propagates automatically via AsyncLocalStorage in-process and through explicit transport helpers across runtime boundaries.

### Convex Component & Experimental Swarm Integration

The crux Convex component (`@crux/convex/convex.config`) provides persistence tables for memory and experimental swarm state. Installed via `app.use(crux)`.

**`createComponentSwarm({ component, generate })`** — experimental swarm routing across action boundaries:

- User provides `generate` function (same as their SDK adapter)
- Component handles transfer tool injection (reuses `buildTransferTools` from `@crux/core`), handoff detection via closure, state persistence, and action scheduling
- **`start(ctx, { agents, startAgent, input, resumeAction })`** — creates state, executes first turn, schedules next on handoff
- **`resume(ctx, swarmRunId, { agents, resumeAction })`** — loads state, executes one turn, schedules next
- State stored in component's `swarmRuns` table automatically
- This helper is experimental. The stable launch model is that compositions execute immediately, while durable orchestration uses `flow()`.

**`cruxConvexStore({ component, ctx })`** — memory backed by component's `memories` table:

- No manual schema or function references needed
- Works with memory blocks, blackboards, plans, workspace metadata, and other `CruxStore` consumers
- Vector search falls back to `ctx.vectorSearch()` (action context)

### Convex Server Boundaries (`@crux/convex/server`)

`@crux/convex/server` is the first-class Convex runtime boundary. It exports Convex-native `action()`, `internalAction()`, `query()`, and `mutation()` builders that preserve the generated Convex function shape while adding a hidden optional `__crux` argument, `ctx.crux` helpers, context restoration, and bounded action flushes.

**Architecture:**

1. **Action ownership:** Public and internal actions create a Run when no Crux context is already active. Entry actions can set `observabilityName`, `observabilityRootPrimitive`, and `observabilityAttributes` so devtools show the semantic unit (`chat`, `daily-briefing`, `agent.run`) instead of an infrastructure label. Queries and mutations restore incoming context but do not create standalone Runs by default.

2. **`ctx.crux` helper surface:** Handlers receive `ctx.crux.capture()`, `ctx.crux.restore()`, `ctx.crux.span()`, `ctx.crux.flush()`, `ctx.crux.runAction()`, `ctx.crux.runQuery()`, `ctx.crux.runMutation()`, and `ctx.crux.scheduler.runAfter()`. Action helpers emit folded `runtime.convex.*` spans, flush the boundary start record before the child worker runs, and propagate `__crux` to the target function. Scheduler helpers record the enqueue operation and detach by default so later scheduled agents are not parented under an already-ended action; they propagate `__crux` only when the caller passes an explicit observability context. Action and explicit continuation envelopes are two-sided: the parent sends a stable boundary id and the receiving Crux-aware action emits `runtime.convex.boundary.received` plus `runtime.convex.boundary.completed` or `runtime.convex.boundary.failed` span events on the parent boundary span. The Go read model uses those child acknowledgements to reconcile missing parent-side boundary end records without inventing a client-side interpretation layer.

3. **Convex-native flows:** `flow({ name, args, handler })` returns a handle with `.action`, `.handler`, `.args`, and `.signal(...)`. The handler shape stays close to core flow: `(flow, args, ctx)`. `.action` is an internal action definition for start/resume; `.args` and `.handler` let applications build their own public auth wrappers.

4. **Agent integration:** `@crux/convex/agent` re-exports a Crux-aware `Agent`, `createTool()`, `createAgent()`, `convexTools()`, and `wrapConvexTool()`. Convex Agent thread generation methods emit an outer `generation.stream` container plus one child `generation.call` span per awaited AI SDK step, so tool-call turns and later text turns are visible as consecutive streamed generation nodes. Direct Convex Agent tools receive `ctx.crux` and emit canonical `tool.call` spans with `tool.args` and `tool.result` artifacts automatically. Streaming generation spans close on the real stream completion path: the Convex Agent finish callback, the returned stream call, or an error. AI SDK step callbacks are recorded as `generation.step` events on the child step span and may recover tool-call detail, emitting `tool.request` on that step generation and completed fallback `tool.call` spans when Convex Agent stops before executing a handler, but they do not close the outer `generation.stream` span because `tool-calls` steps are often intermediate in a multi-step agent loop. Stop-condition tool calls that do not execute a handler, such as UI question tools, are recovered from awaited step callbacks or already-materialized returned stream metadata and recorded as completed `tool.call` spans with `executed: false` when available. Promise-valued returned Convex Agent / AI SDK stream metadata is never awaited by the observability bridge; awaited step/finish callbacks are the source of truth for live stream observability. This prevents late metadata promises from delaying `generation.stream` closure, keeping the outer action running, or creating spans after the action's final flush.

**Plan status as application metadata:** Plan lifecycle (draft→approved→executing→completed) is NOT a crux primitive. Applications model status via `plan.metadata.status`, using `updatePlan({ metadata: { ...plan.metadata, status } })`. The crux `Plan` type stays generic — it stores `title`, `content`, `version`, and an opaque `metadata` record. Version increments only on title/content changes; metadata-only updates (like status transitions) don't bump the version, which enables detecting content edits after approval.

## Adapter Pattern

All adapters follow the same structure. Cross-cutting concerns (middleware, hooks, fallback, and model-output normalization) are handled by shared orchestration functions in `orchestrate.ts`, so each adapter only implements SDK-specific code:

```
Receive: (prompt, options)
  ↓
Fallback check: isFallback(model) → executeFallbackLoop() from orchestrate.ts
  ↓
Extract model info (provider, modelId)
  ↓
Call prompt.resolve(options) → ResolvedPrompt
  ↓
Map to SDK-specific args:
  - system message → SDK's system format
  - output schema → SDK's schema format (zodResponseFormat, JSON Schema, etc.)
  - tools → SDK's tool format
  - settings → SDK's parameter names (temperature, max_tokens, etc.)
  ↓
Call SDK function (generateObject/generateText, chat.completions.create, etc.)
  ↓
Normalize result metadata into _meta:
  { usage, finishReason, toolCalls, responseId, modelId, cost }
  ↓
orchestrateGenerate() from orchestrate.ts handles:
  ├── Apply global middleware (if set)
  ├── Measure durationMs
  └── Fire per-prompt hooks (onGenerate/onError)
  ↓
Return result
```

### Adapter Generic Conventions

Each adapter's `generate()` / `stream()` is parameterised as:

```ts
<TOwnInput extends z.ZodType,
 TOutput extends z.ZodType | undefined,
 TContexts extends readonly Context<z.ZodType>[]>
```

`TContexts` is constrained to `Context<z.ZodType>[]` (not `Context<any>[]`), so `MergedInput<TOwnInput, TContexts>` carries each context's input schema through to the `opts.input` parameter — IDE autocomplete on `generate(prompt, { input: { ... } })` surfaces merged context fields without the caller passing explicit type arguments. The matching constraint exists on `createContextHandler()` in `@crux/convex`.

Adapter packages share a small set of orchestration helpers that retain their own generic signatures across the adapter boundary:

- `resolveModel<M, R>(model, input, tryModel, extractModelId)` — dispatches router/cascade/raw to a per-adapter `tryModel`. Generic `M` is the adapter's model type, `R` is the result. Router dispatch emits `routing.router`; cascade dispatch emits a parent `routing.cascade` plus child tier spans so the selected route, rejected tiers, budget skips, and provider errors are graph-native.
- `executeFallbackLoop<M, R>(fb, tryModel, extractModelId)` — runs fallback with attempt-level instrumentation; same generic signature. Each attempted model emits `fallback.attempt`, and transitions between failed and next attempts are connected with `fallback.attempt` edges.
- `orchestrateGenerate<TArgs extends Record<string, unknown>, TResult>(spec, doGenerate)` and `orchestrateStream<TArgs, TResult>(...)` — wrap adapter-specific `doGenerate` / `doStream` callbacks. `TArgs` is the prepared SDK args object; `TResult` is the SDK result. The shared `MiddlewareResult` interface (`text?`, `object?`, `_meta?`, `[key: string]: unknown`) is the structural contract for middleware-visible result shapes.

`@crux/ai` additionally supports `timeoutMs` on direct `generate()` and `stream()` calls. The adapter wraps provider generation calls with an `AbortController`, passes `abortSignal` to the AI SDK args, and rejects with `AbortError` if the provider does not settle before the deadline. `@crux/core` records that timeout as span metadata (`timeoutMs`, `deadlineAt`) and emits an `operation.deadline` event at operation start so the Go read model can distinguish an active long call from a genuinely missed terminal lifecycle record. This matters in serverless/Convex-style runtimes where a provider stall or worker shutdown can prevent the terminal `span:end` from being delivered.

This keeps adapters type-honest across router/fallback dispatch without resorting to `any` at composition boundaries. Where the SDK's own types are intentionally inaccessible (Convex `FunctionReference` triggering `TS2589`, AI SDK alt-form discriminated unions that reject `Record<string, unknown>` spreads), each `any` carries an `eslint-disable-next-line` with a one-line rationale.

### Shared Orchestration (`orchestrate.ts`)

Five functions extracted from adapter duplication, exported as `@internal`. `OrchestrationSpec<TPreparedArgs>` is generic over the prepared args type, enabling typed `generate`/`stream` signatures per adapter:

| Function                | Purpose                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `orchestrateGenerate()` | Middleware wrapping, timing, `onGenerate`/`onError` hooks                                                                            |
| `orchestrateStream()`   | Middleware wrapping, `onError` hook                                                                                                  |
| `executeFallbackLoop()` | Model fallback with per-attempt timing, error classification, `FallbackAttemptDetail[]` metadata, canonical `fallback.attempt` spans |
| `wrapStreamIterable()`  | Async iterator interception for progress reporting (OpenAI, Google, Anthropic)                                                       |
| `withAttemptTimeout()`  | Per-attempt timeout with `AbortController`                                                                                           |

### Pre-built Generate Functions

Each adapter also exports standalone `GenerateObjectFn` / `GenerateTextFn` implementations for use with primitives that need SDK-agnostic generation (compaction, scoring, extraction):

| Adapter           | Object                                  | Text                                  | Embeddings             | Rerankers      |
| ----------------- | --------------------------------------- | ------------------------------------- | ---------------------- | -------------- |
| `@crux/ai`        | `generateObjectFn` (singleton)          | `generateTextFn` (singleton)          | `embedding()`          | `reranker()`   |
| `@crux/openai`    | `createGenerateObjectFn(client, model)` | `createGenerateTextFn(client, model)` | `embedding(client, …)` | via `@crux/ai` |
| `@crux/google`    | `createGenerateObjectFn(client, model)` | `createGenerateTextFn(client, model)` | `embedding(client, …)` | via `@crux/ai` |
| `@crux/anthropic` | `createGenerateObjectFn(client, model)` | `createGenerateTextFn(client, model)` | generation-only        | via `@crux/ai` |

The Vercel AI SDK adapter exports pre-bound singletons (model is passed at call time via the options). The OpenAI, Google, and Anthropic adapters use factory functions that bind a specific client and model.

### Metadata Normalization

Each adapter attaches `_meta` to the result with a consistent shape. This allows devtools middleware, quality experiments, and eval reports to extract usage/cost information without knowing which adapter was used.

```ts
result._meta = {
  usage: { inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens },
  finishReason: string,
  toolCalls: { id, name, args }[],
  responseId: string,
  modelId: string,    // actual model ID returned by provider
  cost: number,       // USD cost if available
}
```

## Storage Adapters

### Convex (`convex/`)

`cruxConvexStore({ component, ctx })` — implements the data-store side of Crux storage and remains compatible with `CruxStore` consumers. It is backed by the crux Convex component's `memories` table. Accepts the component ref and a `ConvexContext`. Dense vector search falls back to `ctx.vectorSearch()` where configured.

Also exports Convex-specific helpers:

**`compactConversation(args)`** — Stateless conversation compaction for Convex's action-per-message model. Takes evicted messages + existing summary, returns a merged summary via `summarizeMessages()`. No internal state — the caller manages persistence (e.g., thread metadata). Emits `onCompactStart`/`onCompactEnd` instrumentation hooks.

### Upstash (`upstash/`)

`upstashVectorStore(config)` — `VectorStore` backed by Upstash Vector for dense, sparse, and hybrid retrieval.

`cruxUpstashStore(config)` — compatibility combined storage: text/metadata persisted in Convex (reliable, transactional), vectors stored in Upstash Vector (fast similarity search). Uses Upstash Vector's namespace feature for data isolation (e.g., `memory-{projectId}`).

Use `upstashVectorStore()` for new retrieval/indexing code. Key/value memory blocks can use `cruxConvexStore`; embedding-backed legacy blocks need a vector-capable compatibility store until they move to the explicit split.

## CLI Eval Runner

## Canonical Observability Runtime

`@crux/core/observability` is the only TypeScript write contract for detailed traces. Runtime primitives emit append-only graph records and the Go backend owns all graph complexity: validation, idempotent ingestion, placeholder reconciliation, read-model building, filtering, search, retention, and subscriptions.

`observe.run()` creates user-facing execution roots. `observe.span()` creates inspectable operations and automatically opens an implicit run when called outside an active run, so compositions such as `pipeline`, `consensus`, `parallel`, and `swarm` remain traceable when used directly. `observe.event()`, `observe.artifact()`, and `observe.edge()` attach timestamped detail, payloads, and relations to the active graph context.

Built-in orchestration primitives write the graph contract directly. `parallel()` opens `composition.parallel` with sibling `agent.run` children. `pipeline()` opens `composition.pipeline`, one `flow.step` per executable step, and nested `agent.run` spans for agent steps. Runtime `flow()` / `withFlow()` opens `flow.run`, emits `flow.step` children, and records intentional waits as `flow.suspension` markers linked to the causing step. `consensus()` nests its voter fanout under `composition.consensus`; `swarm()` records agent turns, `handoff.prepare`, `handoff.payload` artifacts, and `triggered` edges between turns. `delegate().run()` records `delegate.invoke`, canonical input/output artifacts, and links its handoff preparation with `delegate.invoked`.

Prompt/context and safety primitives also write the graph contract directly. `prompt.resolve()` opens `prompt.resolve`; conditional context evaluation emits `context.predicate` spans with `included`, `predicate`, discriminator/branch, and exclusion reason attributes; context text resolution emits `context.resolve` spans plus `context.contribution` artifacts and `produced` edges. Included context artifacts are carried through `systemBlocks` and linked to each generation span with `consumed` edges, so the backend can expose the exact context for a call in `inspection.context`. Token-budget drops are recorded in `prompt.budget` artifacts. `runConstraints()` opens a grouped `constraint.check` span, runs each constraint check as a child span with pass/fail attributes, records `constraint.report` artifacts, and emits `constraint.retry` spans/edges for combined-feedback regeneration. `createGuardrailPipeline()` opens grouped and per-guard `guardrail.run` spans, records each action as span attributes plus `guardrail.report` artifacts with before/after previews when content changes, and emits `guardrail.blocked` edges for blocking decisions.

Memory primitives write the graph contract from the shared block hook path. `recentMessages`, `workingState`, `episodes`, `facts`, `procedures`, proposal lifecycle operations, `blackboard()`, and custom blocks that use the standard context helpers emit `memory.read` / `memory.write` spans, `memory.snapshot` artifacts, and semantic memory edges. The raw namespace is never emitted; traces receive `namespaceHash`.

Retrieval and data-loading primitives write the same graph contract. `retrieval.query`, `retrieval.stage`, `indexing.pipeline`, `ingest.parse`, and `corpus.sync` spans are emitted at the public API boundaries so standalone calls create implicit runs and calls during prompt/corpus work nest under the active span stack. Detailed payloads stay in canonical artifacts: `retrieval.hits`, `embedding.report`, `indexing.report`, `ingest.report`, `corpus.report`, `cache.report`, `routing.report`, `compaction.report`, `score.report`, `citation.report`, `composition.report`, `handoff.payload`, `delegate.report`, `memory.snapshot`, and `security.report`. Production OTel export should keep metadata-only defaults unless a redaction callback opts into content.

Tool primitives write the graph from the shared adapter loop. This keeps user-defined tools, context-injected tools, skill tools, swarm transfer tools, and approved resume executions on one contract: `tool.request` for model intent, `tool.call` for execution, `tool.args` / `tool.result` artifacts for inspectable payloads, and `tool.approval` for gates. The legacy `tool:start` / `tool:end` hooks still fire for compatibility, but the backend-owned canonical graph is the read source for detailed devtools/TUI inspection.

Delivery is intentionally non-blocking for normal Node.js use. The first queued delivery starts immediately so devtools can show live span starts during long-running actions. Later records coalesce per microtask and are delivered FIFO behind the active transport send, so a later `span:end` cannot overtake its own `span:start` across HTTP delivery attempts. HTTP batches are JSON-normalized before transport: cyclic values, `bigint`, functions, non-finite numbers, deep objects, and oversized strings are converted into inspectable safe previews instead of poisoning the POST. If the Go backend rejects a multi-record batch, the transport isolates records and still delivers valid lifecycle records such as `span:end` / `run:end`, so one bad detail artifact cannot strand a successful run as visually running. The Go observability service still reconciles out-of-order lifecycle records by stable ids and timestamps defensively, so externally reordered records do not corrupt the read model. Generation `timeoutMs` is enforced in core orchestration, not only in provider adapters: if a model call never settles, `generation.call` / `generation.stream` emits a terminal error span instead of relying on backend deadline reconciliation. For presentation only, terminal ancestor scopes such as suspended flows can close still-running descendants before operation deadline fallback marks them incomplete; output or usage evidence lets completed generations render as `ok` while the enclosing flow renders as `suspended`. Transport errors are collected by diagnostics and do not throw into user code. Bounded `observe.flush({ timeoutMs })` and `observe.shutdown({ timeoutMs })` exist for serverless runtimes and Convex-style request lifecycles where queued writes must be awaited before the platform freezes or kills the process. Bounded flush uses a cancelable timeout primitive so a successful delivery does not leave a timer alive after the flush returns.

`config({ observability })` wires a custom transport or an HTTP transport to the local Crux backend. The HTTP transport posts canonical `{ records }` batches to `/api/observability/records`; HTTP, WebSocket, and SSE layers should remain adapters around Go services rather than owning graph semantics.

Devtools run-detail views poll briefly after a run reaches a terminal status. This keeps Convex/serverless boundary flushes visible when final artifacts or follow-up generation spans arrive just after the terminal run update.

The Go read model owns user-facing trace shape. Convex Agent's outer `generation.stream` is visible as `GENERATE stream response` when it carries useful structure such as multiple steps or tool calls; its child `generation.call` steps and `tool.call` executions stay beneath that container in timestamp order. A redundant single-step stream wrapper is folded as detail so simple generations do not gain an empty-looking extra level. Session ids remain run metadata/grouping, not execution nodes.

The eval runner is built as a bounded Node worker and embedded in the `@crux/local` Go binary alongside the source-indexer worker. It's invoked via:

```
crux eval --config crux.config.ts
```

On `crux eval`, the CLI extracts the embedded `eval-runner.mjs` to `~/.cache/crux/` and runs it with `node`. The runner communicates with the CLI via NDJSON on stdout.

CLI-discovered quality execution uses `./testing` internally as runner support, but public docs should describe one user-facing model: `quality()`, `suite()`, `target()`, and `expect()`.

The local runtime, Go services, TUI, CLI commands, discovery orchestration, and failed-case export live in `@crux/local`. The React web UI lives in `@crux/devtools`. Source intelligence lives in the embedded `@crux/source-indexer` worker. Devtools uses bounded protocol previews; OTel receives only aggregate counts and metrics, never raw questions, answer text, citations, or retrieved content.

Quality deliberately treats suites as portable fixtures, not a hosted product. Prompt, flow, retrieval, composition, and RAG checks converge on `quality()`, `suite()`, `target()`, and `expect()` as the canonical user-facing model. `expect()` callbacks receive a normalized execution context: typed input/output, variant/target identity, retrieval hits, tool calls, flow/pipeline steps, citations, handoffs, trace id, and optional trace summaries.

Native primitive coverage is target-based. `target.prompt()`, `target.retriever()`, and `target.flow()` cover the common execution contracts. The universal `target({ id, run })` is the native boundary for pipelines, swarms, handoffs, delegates, contexts, tools, middleware, grounding paths, indexers, loaders, chunkers, embeddings, memory, blackboards, workspaces, agents, storage adapters, and app-level orchestration.

Quality observability writes `eval.run` spans around experiments and `eval.case` child spans for each case/variant pair. Case spans carry suite, experiment, target, variant, assertion, score, replay, trace, duration, and status metadata, plus bounded score/result artifacts. Feedback writes use `feedback.record` spans with bounded artifacts, keeping the feedback inbox inspectable without making the UI understand local file formats.

## Flow Quality

Flow quality uses `target.flow()` and regular Quality suites. The flow-specific executor records step summaries, tool calls, turns, usage, and cost so Devtools can display flow-shaped traces and comparisons, but users should not need a separate flow-eval mental model.

For custom orchestration paths, users can wrap app code in `target()` and return the output, tool calls, trace summaries, or flow-step records they want Quality expectations to inspect.
