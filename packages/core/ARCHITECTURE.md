# Architecture

Internal implementation details of `@use-crux/core`. For usage documentation,
see the [Crux docs](../../apps/docs/content/docs); the
[package README](./README.md) is the concise npm landing page.

## Tool-source boundary

Core treats execution-time tool discovery as a provider-neutral, branded
`ToolSource` contract. Prompt resolution records inert sources without external
work. An adapter dialect materializes each source before provider I/O into
ordinary tools plus an invocation-scoped cleanup handle; Core then applies its
existing merge, middleware, approval, Safety, timeout, observability, and result
lifecycles. Generic source provenance augments ordinary `tool.call` observations
without teaching Core about MCP properties.

Protocol integrations such as `@use-crux/mcp` own connection, discovery,
schema/result normalization, replay identity, and safe source-specific evidence.
Core never depends on their SDKs. Source sessions close in reverse order through
the bounded invocation cleanup path, including setup failure, cancellation,
stream disposal, and approval suspension.

`config()` may carry inert tooling configuration for adjacent Crux packages, but core must not execute
those tools. The `indexer` config bag stores Project Indexer extension references, trust policy, and
rule options as data only. `@use-crux/indexer` owns extension manifest validation, trust enforcement,
compatibility checks, loading, compiler execution, and diagnostics.

## TypeScript Compatibility Contract

Core's public types must remain valid under TypeScript `>=5.5 <7`. Type tests should exercise public
interfaces and inference behavior rather than overload implementation details, because different
compiler versions can report the same invalid call at different source locations. Prefer exported
definition types, `satisfies`, `expectTypeOf`, and small schema fixtures for type-level assertions.

The TypeScript 7 native-preview lane is advisory for core. It is useful for finding upcoming inference
or parser changes, but it should not force TypeScript 7-only public syntax while the stable support
range includes TypeScript 5.5.

`@use-crux/indexer` is the package that executes the TypeScript compiler at runtime. Core may expose inert
indexer configuration and Project Index contracts, but it must not depend on compiler APIs directly.

## Public Naming Convention

Crux public APIs use names that describe the thing a user is declaring or doing:

- Use simple nouns for user-authored primitives: `prompt()`, `context()`, `agent()`, `flow()`, `embedding()`, `indexer()`, `retriever()`, `reranker()`, `memory()`, `workspace()`, `guardrail()`, `constraint()`, `blackboard()`, `handoff()`, `delegate()`, `registry()`, `plan()`, and `tasks()`.
- Use provider-local noun exports in adapter packages. For example, `@use-crux/ai`, `@use-crux/openai`, and `@use-crux/google` all export `embedding()`. Consumers can alias at import sites when multiple providers are used in one file, e.g. `import { embedding as openAIEmbedding } from '@use-crux/openai'`.
- Use `createX()` for runtime infrastructure factories that produce machinery rather than domain definitions: transports, middleware, plugins, reporters, stores, adapter clients, pipelines, and other operational helpers.
- Use verbs for one-off operations: `generate()`, `stream()`, `retrieve()`, `indexDocuments()`, `signalFlow()`, `cancelFlow()`, and similar execution functions.
- Avoid `defineX()` for new public Crux APIs. The project is pre-launch, so naming changes are breaking changes rather than deprecated aliases.
- Keep platform names on Runtime composers, name host/retention bindings for their mechanism, reserve `withCrux` for framework lifecycle boundaries, and use `withCruxBuild`-style names for build plugins.

### Host retention bindings

`config({ host })` installs a provider-neutral `CruxHostBinding` in the same
restorable hook layer as `runtime`. Every configured execution root lazily owns
one functional retention gate: completion-gated invocation tasks queue until
the platform callback runs, while primitive drains start immediately and extend
the shared live pending set. The first pending signal calls
`binding.retain(work)` exactly once. A retention-port failure propagates after
deterministic sealing because Core could not establish the acceptance guarantee.

Core exports `node()` from `/defer/node`; `@use-crux/next`,
`@use-crux/cloudflare`, and `@use-crux/vercel` inject `after()`,
`ExecutionContext.waitUntil()`, and Vercel `waitUntil()` respectively. Core does
not detect platforms or import their SDKs.

### Execution scope boundaries

Core opens execution scopes at its real runtime boundaries: adapter calls,
agent-member turns, tool executions, Safety sessions, and flow steps. The
Convex runtime bridge adds the corresponding `bridge-run` boundary in its own
package. Boundaries are descriptor-only until code calls `defer()`; the first
registration lazily creates the exact scope's controller and shares
invocation-global limits, durable staging, commit tracking, and evidence with
the root.

Call-shaped work uses `runScope()`. Streaming adapters use `openScope()` and
restore one immutable carrier frame around setup, each Core-owned raw-stream
iterator segment, and completion; provider-owned raw SDK objects are never
wrapped. Inner scope drains start as soon as that scope closes and extend the
root pending set, allowing tool cleanup to overlap later request work without
losing root retention. Replayable flow steps still enforce
`DEFER_REPLAY_UNSAFE`; their scope exists for attribution and internal work,
not as an escape from replay rules.

This keeps the SDK readable at call sites: users define nouns once, execute verbs when work happens, and reach for `createX()` only when building infrastructure.

## Workspace Storage Model

`workspace()` is a prompt composition primitive, not a sandbox or host filesystem wrapper. It composes through the private inject-shaped lowering path: `use: [ws]` expands to a manifest context plus safe file tools.

Workspace records use explicit storage capabilities:

- `RecordStore` stores metadata, paths, MIME type, size, timestamps, previews, and small inline text/JSON.
- `AssetStore` stores binary and oversized payloads.

`VectorStore` is separate and only used by retrieval/search features. Core includes in-memory `RecordStore`, `VectorStore`, and `AssetStore` implementations for tests and demos. Durable asset stores belong in adapters or userland implementations; object storage backends such as S3, R2, GCS, local disk, and app-owned file services should implement `AssetStore` instead of overloading records with raw bytes.

Default mounts are `/workspace` and `/outputs`. Optional `/sources` mounts are configured explicitly by the app because source ownership can come from uploads, ingestion, MCP, retrieval, or app storage. Generated deliverables remain normal files under `/outputs`; the artifacts facet is a typed view over those same file records (`status`, artifact `kind`, provenance, and download references), not a second store or keyspace.

Mounts can also be source-backed through `WorkspaceMount.source`. `WorkspaceMountSource` is either a retriever source (`{ kind: "retriever"; retriever; ... }`) or a custom source (`{ kind: "custom"; list; read; grep?; exists?; stat?; write?; delete? }`). `retrieverWorkspaceMountSource()` adapts a `Retriever` into the custom source contract for callers that prefer a helper over the direct discriminated shape. Source-backed mounts delegate `list`, `read`, `grep`, `exists`, and `stat` through the provider while Crux keeps workspace path normalization, mount-boundary validation, text windowing, and result metadata normalization. Custom sources are read-only unless the mount is `access: "readwrite"` and the provider implements the relevant mutation hook; provider writes remain provider-owned and do not create local workspace versions or artifact manifests.

Retention and limits are enforced at the workspace write boundary. `retention.ttlMs` is passed through to `RecordStore.put(..., { ttlMs })` only when the store reports TTL support; stores without TTL support keep records normally. `limits.maxFileBytes` and `limits.maxNamespaceBytes` reject writes before metadata persistence. Namespace quotas intentionally scan the namespace's current file records in V0 instead of maintaining counters, keeping adapter requirements small and behavior easy to verify.

Instrumentation emits `workspace.operation` spans, output artifacts, and produced edges for all workspace methods. Devtools can show workspace ids, hashed namespaces, operations, file labels, MIME type, size, artifact status/kind, and download refs from local resource activity. When a raw path is not available from a local-only source, devtools use the stable `hash:<pathHash>` label instead of collapsing files to `/`. OTel receives only privacy-safe attributes such as workspace id, operation, MIME type, size, status, and `crux.workspace.path_hash`; raw paths are dropped from workspace-shaped OTel records.

Project Index workspace facts include mounts, generated tool names, asset-storage posture, retention TTL, and quota limits. Authored workspace method calls inside indexed owners are visible as workspace read/write relations, and V0 workspace-specific data-access facts preserve exact operations such as `grep`, `artifacts`, `rename`, `move`, `copy`, and `finalize`.

## Package Structure Policy

`@use-crux/core` uses the repository's conventional **`src/` source root**.
`packages/core/` owns package metadata, documentation, tests, and project
configuration; `packages/core/src/` owns public entrypoints and implementation.
The npm release manifest records Core with `sourceRoot: "src"` and stages that
tree as the published package root.

The rules:

- **`src/` = public source root.** Keep curated package and subpath entrypoints
  at `packages/core/src/`: `index.ts`, the base `types.ts`, and compatibility
  shims such as `tools.ts` and `tool-middleware.ts`. Package metadata,
  documentation, tests, and compiler/test configuration stay at
  `packages/core/`.
- **Domain folders own implementation.** Product domains —
  `src/prompt/`, `src/prompt-text/`, `src/resolver/`, `src/runtime/`,
  `src/generation/`, `src/tools/`, and the rest — hold the real code behind
  curated domain barrels. New implementation files do not accumulate directly
  under `src/`.
- **Curated barrels, not dumping grounds.** Each domain `index.ts` is a curated barrel or public
  entrypoint, never substantial implementation. Avoid broad `export *` over internals, and put
  implementation that is not a stable intra-package contract under a domain-local `internal/`
  folder. Do not add a package-wide `packages/core/src/internal/`.
- **Provider-agnostic.** Core must not depend on provider SDKs, React, Convex, or app packages;
  provider packages depend on Core, never the reverse.
- **Public contract is verified through imports, not file paths.** Behavior and inference are
  pinned through the published `@use-crux/core` barrel and its subpaths
  (`__tests__/public-import-surface.test.ts` at runtime, `__type_tests__/public-root-imports.ts`
  under `tsc`). Implementation files stay free to move between domains as long
  as those public imports keep resolving and retain their documented shape.

The Module Map below is rooted at `packages/core/src/`. The surrounding package
root owns `package.json`, TypeScript/Vitest config, docs/legal files,
`__tests__/`, `__type_tests__/`, and package scripts.

## Module Map

```
packages/core/src/       Published as @use-crux/core
├── index.ts            Main public barrel — curated re-exports of every domain's public surface
├── types.ts            SDK-agnostic base contracts only: AnyModel/AnyToolSet/AnyMessage, FlowToolDef, ModelInfo
├── tools.ts            Compatibility shim for the ./tools subpath (re-exports tools/define-tool + tool types)
├── tool-middleware.ts  Compatibility shim for the ./tool-middleware subpath (re-exports tools/middleware + tools/approvals)
├── prompt/             Prompt + context authoring domain
│   ├── index.ts        Curated barrel: prompt(), context(), createPrompts(), createContexts(), when(), match(), contributor() + authoring types
│   ├── prompt.ts       prompt() — public .resolve()/.inspect() wrapper over compilePrompt(); prompt definition-source capture
│   ├── context.ts      context(), createContexts(), when(), match(); Context definition-source capture
│   ├── prompts-tree.ts createPrompts() — nested prompt tree builder
│   ├── contributor.ts  contributor() authoring + lowering-facing contract
│   ├── internal-injection.ts Private inject-shaped lowering contract for first-party primitives
│   ├── context-types.ts  Context/use-entry authoring types (Context, ContextEntry, Contribution, MemoryEntry, …)
│   ├── prompt-types.ts   prompt() config/instance/hooks/result + semantic-cache intent types
│   ├── type-utils.ts     Prompt/context inference helpers (Simplify, DeepReadonly, MergeContextInputs, MergedInput)
│   └── types.ts          Curated type barrel over context-types + prompt-types
├── thread/             Durable conversation history and branch navigation
│   ├── entry.ts        Structural ContextEntry boundary for exact reads and turn commits
│   ├── thread.ts       thread() handle and public history/edit/navigation methods
│   ├── observability.ts Payload-safe thread.operation lifecycle evidence
│   ├── runtime-bridge.ts Devtools tree/group/branch/head topology projection
│   └── store/          Canonical immutable events, asset hydration, snapshot reduction, and storage commits
├── prompt-text/        Markdown-oriented PromptText authoring + private structured-text kernel
│   ├── index.ts        Public md tagged template, md.json(), and opaque PromptText contract
│   ├── internal.ts     Nominal shell registry, immutable interpolation snapshots, stable errors, and resolver-only lowering boundary
│   └── render.ts       Whitespace-aware private tree renderer preserving static/dynamic segment provenance
├── resolver/           Prompt compilation + resolution internals (single compile boundary)
│   ├── compile.ts      compilePrompt() — THE public prompt compiler entrypoint (thin boundary)
│   ├── plan.ts         createPromptResolverPlan() — the private pass primitive (binds config+schema+ports once, run(opts, mode))
│   ├── prompt-content.ts  Lowers user-prompt strings/PromptText into provider-neutral text plus optional inspection segments
│   ├── system-content.ts  Normalizes system strings, PromptText, and explicit segments while preserving token/freshness attribution
│   ├── system-segment-inference.ts  Best-effort input provenance for dynamic plain-string system callbacks
│   ├── types.ts        Resolution/inspection output contracts (ResolvedPrompt, ResolveOptions, SystemBlock, InspectResult, DroppedContext, …)
│   ├── ports.ts        Resolver port contracts (ObservabilityPort, SkillSourcePort, TokenizerPort, …) — pure types
│   ├── default-ports.ts  Production port adapters + withDefaultResolverPorts() (wrap ambient globals lazily)
│   ├── fakes.ts        In-memory fakes for every port + createResolverFakes() bundle (deterministic test seams)
│   ├── contract.ts     CONTRIBUTOR contract + lowered contributor contract types
│   └── pass / lower / driver / schema / system-* / budget   resolution pass, system composition, token dropping
├── runtime/            Process runtime, config, plugins, middleware hooks, execution context
│   ├── index.ts        Curated barrel: config(), runtime store, plugins, hook types, execution context
│   ├── config.ts / config-types.ts   config() + CruxConfig shape
│   ├── config-transaction/   Internal runtime config transaction: plan, ports, install, Crux object factory
│   ├── configure.ts / configure-registry.ts   configure() registry build + global security flags
│   ├── runtime.ts      CruxHooks — global hooks/reporters (getHooks/setHooks/updateHooks/resetHooks)
│   ├── plugin.ts / merge-runtime.ts   CruxPlugin, applyPlugins(), mergeHooks() layered composition
│   ├── middleware.ts / instrumentation-hooks.ts   per-call hook function types + the graph-record subscribers contract
│   ├── execution-context.ts   session/execution context helpers
│   ├── internal/middleware-result-finalizer.ts   Private symbol-carried current-operation result finalizer for layered middleware
│   └── types.ts        Runtime middleware contracts (PromptMiddleware, PromptMiddlewareArgs, MiddlewareResult)
├── generation/         Provider-neutral generation lifecycle policy
│   ├── index.ts        Curated barrel: messages, fallback, retry, validation-retry, JSON repair + @internal orchestration
│   ├── orchestrate.ts  Shared adapter orchestration (generic OrchestrationSpec<T>) split across observability/result-meta/timeout/stream-interception concern files
│   ├── stream-observability.ts  Private descriptor-safe stream observation wrapper preserving one immediate/completion operation pair
│   ├── fallback.ts / retry.ts / validation-retry.ts   fallback policy, retry-with-backoff, validation-feedback retry types
│   ├── repair-json.ts  repairJsonText() — zero-cost JSON text repair (markdown fences, trailing commas, bracket extraction)
│   ├── messages.ts     canonical Message type + helpers
│   └── types.ts        Generation policy types (GenerationSettings, PromptAdaptation, ProviderAdaptations, TokenUsage, TraceMeta)
├── tools/              SDK-agnostic tool authoring, tool middleware, approval helpers
│   ├── index.ts        Curated barrel (leaf-consumer entrypoint; domains import specific tools/<file> to stay cycle-free)
│   ├── define-tool.ts  tool() — SDK-agnostic tool factory
│   ├── middleware.ts   toolMiddleware(), approvalMiddleware(), applyToolMiddleware() + module-level approval registry state
│   ├── approvals.ts    resumable approval message protocol helpers
│   ├── entity.ts       composeTools(), CruxEntity (asTools()/asContext())
│   ├── context-types.ts typed tool-context inference helpers (`contextSchema` → `toolsContext`)
│   ├── types.ts        tool + middleware/approval public types
│   └── internal/       private message parsers + stateless middleware helpers
├── shared/             Genuinely cross-domain, provider-agnostic utilities (kept small)
│   ├── sanitize.ts     Injection-defense helpers (escapeXml, safe, raw, limit, wrap, userContent, truncate, detectSuspiciousPatterns)
│   └── tokenizer.ts    Pluggable token counter (countTokens/setTokenizer; default chars/4)
├── scope/              Internal execution-scope kernel shared by Core and first-party integrations
│   ├── internal.ts     Curated `@use-crux/core/internal/scope` SPI; not application-facing
│   ├── kernel.ts       Scope lifecycle, nesting, close hooks, write routing, manual controllers, and root-idle waits
│   ├── contracts.ts    Typed scope/controller/close-hook contracts and the sealed-write error
│   ├── facets.ts       Nominal typed facet slots with nearest-ancestor resolution
│   ├── lifecycle.ts    Settlement helpers shared by automatic and manual close paths
│   ├── overrides.ts    Immutable execution-local facet overrides on the canonical carrier
│   ├── pending.ts      Live root pending-set and drain-to-empty microtask re-check
│   ├── state.ts        Functional scope state, facet writes, sealing, and reroute policy
│   └── types.ts        Closed scope kinds, descriptors, policies, outcomes, state, and sealing reasons
├── effect/             In-process custom effects, receipts, recovery, rollback boundaries, and reconciliation
│   ├── index.ts        Curated `@use-crux/core/effect` public surface
│   ├── define-effect.ts   effect() overloads, definition registry, and callable assembly
│   ├── recover.ts      Individual receipt recovery and ambiguous-outcome reconciliation
│   ├── rollback-on-error.ts   Automatic/manual boundary lifecycle and error precedence
│   ├── rollback.ts     Delayed scope rollback entrypoint
│   ├── errors.ts       Stable Effects code catalog, CruxEffectError, RollbackError, and EffectOutcomeUnknownError
│   ├── types.ts / receipt-types.ts   Public definition, scope, result, receipt, and recovery contracts
│   └── internal/       Ledger, pure planner, causal stack, occurrence identity, execution, evidence, and observability
├── observability/
│   ├── index.ts        Barrel: canonical graph contract, presentation read models, schemas, ID helpers, observe runtime, transports
│   ├── contract.ts     Wire-only canonical graph records; branded IDs; taxonomies
│   ├── VERSIONING.md   Schema-version policy, additive-field rules, and TS/Go conformance checklist
│   ├── presentation.ts Presentation read-model barrel, versioned independently from the wire schema
│   ├── presentation/   RunSummary, SpanSummary, RunDetail, placement, request, and realtime notification types
│   ├── turn-decision-report/  Per-turn TurnDecisionReport explanation read model (report/items/evidence/source-coverage/targets/shared), barrelled by turn-decision-report.ts
│   ├── schema.ts       Zod schemas for graph records and batches
│   ├── ids.ts          Runtime-owned public graph ID helpers
│   ├── result-meta.ts  Public operation-result metadata types and run-reference contract
│   ├── internal/result-meta.ts  Private descriptor-preserving result finalization and persistence stripping
│   ├── observe.ts      Non-blocking runtime emitters with a zero-listener fast path, manual/open run lifecycles for serverless resumes, AsyncLocalStorage context propagation with synchronous no-ALS degradation, flush/shutdown
│   ├── context.ts      AsyncLocalStorage acquisition, synchronous fallback context frames, and the internal no-ALS test hook
│   ├── delivery/       Functional delivery engine, option normalization, batching/chunking, retry timers, lifecycle hooks, and flush timeouts
│   ├── errors.ts       Normalized observed error summaries, safe raw capture, stack/cause extraction, redaction, and truncation
│   ├── transport.ts    Transport interface plus in-memory and HTTP graph transports
│   ├── devtools.ts     withDevtools() plugin + enableDevtools() — installs the canonical observability transport
│   ├── continuation.ts W3C/Crux propagation carrier: create/sanitize/inject/extract, continuation identity
│   ├── handler.ts       withObservableInvocation() — generic serverless wrapper: scoped host lifecycle, bounded final drain
│   ├── node.ts (subpath `/observability/node`)     withNodeObservableInvocation() — Lambda-style (event, context) adapter over handler.ts
│   └── fixtures/       Shared TS/Go contract fixtures
├── routing/
│   ├── index.ts        Barrel: router(), split(), retry(), cascade(), fallback(), resolveModel(), receipt helpers, and error types
│   ├── router.ts       router() — classifier-based route selection with typed RouteArgs context
│   ├── split.ts        split() — deterministic weighted canary/experiment routing
│   ├── retry.ts        retry() — retry one child model before surfacing a qualifying failure
│   ├── cascade.ts      cascade() — sequential quality escalation with budget enforcement
│   ├── resolve.ts      resolveModel() — unwraps routing _tag wrappers through the adapter tryModel callback
│   ├── resolve-fallback.ts / resolve-retry.ts / resolve-split.ts   Specialized attempt loops behind resolveModel()
│   ├── receipt.ts / observability.ts   Canonical RoutingReceipt construction and routing span/report emission
│   ├── first-token.ts  Buffered first-token gate for fallback-eligible stream startup
│   └── errors.ts       FallbackExhaustedError, CascadeExhaustedError, and routing resolution errors
├── eval/
│   ├── index.ts        Portable `@use-crux/core/eval` authoring surface
│   ├── evaluate.ts     Inert typed Eval definition construction
│   ├── case.ts / case-file.ts / variant.ts / gates.ts   Public authoring vocabulary
│   ├── task.ts         Portable task descriptor contract
│   ├── node.ts         Node-only discovery, persistence, and programmatic execution export
│   ├── node/           Discovery, Case hydration, host readiness, stores, and coordinator
│   └── internal/       Planner/executor, identity/evidence, assertions, scorers, gates, and Baselines
├── project-index/
│   ├── index.ts        Project Index/state-plane contracts, lint findings, ruleDescriptors metadata, and validation schemas
│   ├── project-model.ts Resolved Project Model read-model contract with provenance and diagnostics
│   ├── serializers.ts  Zod→JSON Schema, prompt/context/tool→Project Index metadata
│   └── source.ts       Source capture helpers
├── lint/
│   └── index.ts        Authored-graph lint contract types and schemas
├── runtime-bridge/
│   ├── index.ts        Curated barrel for runtime bridge protocol, client, and command helpers
│   ├── protocol.ts     Runtime bridge schemas and inferred command-plane types
│   ├── client.ts       Manifest derivation, bridge URL helpers, and WebSocket client lifecycle
│   ├── commands.ts     Runtime bridge command execution for inspectable resources
│   └── resources.ts    Inspectable resource registration for memory, blackboards, stores, and future runtime resources
├── embedding/
│   ├── index.ts        embedding() — dense/sparse embedding primitive with batching, governance, and instrumentation
│   ├── modality.ts     Public modality and typed input unions
│   ├── input.ts        Async canonical text/media normalization and byte hashing
│   ├── space.ts        Dense vector-space identity and SHA-256 digest
│   └── errors.ts       Unsupported-modality and incompatible-space errors
├── retrieval/
│   └── index.ts        knowledgeBase(), retriever(), retrievalRecipe() — query-first retrieval, RAG facades, and traceable recipe composition
├── storage/
│   └── index.ts        RecordStore, VectorStore, AssetStore, storage(), and in-memory implementations
├── workspace/
│   └── index.ts        workspace(), workspaceToolNames() — durable mounted file tree, prompt injection, file tools, artifacts view, append-only versioning (history/read@version/diff/undo, version-scoped assets, maxVersions GC), TTL/quota guards, asset-backed payloads, canonical operation spans
├── indexing/
│   └── index.ts        indexer() + corpus() + indexingPipeline() — document transforms, structured/parent-child/semantic chunkers, stage cache, generation-aware promotion, source ledger sync, dry runs, and store writes
├── cost/
│   ├── index.ts        withCostTracking(), modelPricing(), CostLimitError — per-call cost attribution and canonical budget spans
│   └── internal/stream-completion.ts  Private legacy/current stream-completion capability detection for cost tracking
├── memory/
│   ├── index.ts        Barrel: memory(), memoryBlock(), recentMessages(), workingState(), episodes(), facts(), procedures(), reflections()
│   ├── block-system.ts Block memory composition, lookup, proposals, and capture-runtime delegation
│   ├── capture/
│   │   ├── runtime.ts  Immutable completed-turn snapshots, ordered block fan-out, settlement ledger, and flush cutoffs
│   │   └── scheduling.ts Public mode mapping, diagnostics-only defer port, and safe fallback warning
│   ├── contracts.ts    Composed memory contracts
│   ├── block-contracts.ts Block, runtime, capture, and proposal contracts
│   ├── namespace.ts    Shared sync/async namespace resolution
│   ├── rendering.ts    Entry strategies and token-budget rendering
│   ├── policy-safety.ts Candidate policy application and observability
│   └── utils.ts        Memory helpers
├── plan/
│   ├── index.ts        Barrel: plan, tasks, task specs, types
│   ├── types.ts        Plan, TaskList, Task, status types, TaskListHandle
│   ├── plans.ts        plan(), getPlan(), updatePlan() — canonical plan.operation spans for mutations
│   ├── tasks.ts        tasks(), getTaskList(), TaskListHandle - canonical task.operation spans for mutations
│   ├── agent.ts        internal plan/task context and tool helpers, ToolDef
│   └── helpers.ts      deriveTaskListStatus(), key conventions
├── tasks/
│   └── index.ts        Barrel: canonical @use-crux/core/tasks import (re-exports task APIs and types, incl. TaskCompleteArgs, from plan/)
├── scoring/
│   ├── judge.ts        llmJudge() — LLM-as-a-judge with CoT, rubrics, few-shot
│   ├── metrics.ts      Pre-built judges (relevance, faithfulness, coherence, etc.)
│   ├── judge-constraint.ts  judgeConstraint() — judge → Constraint bridge (threshold on the judge's scale, reasoning as retry feedback; composes constraint() like citations does)
│   └── types.ts        JudgeConfig, JudgeResult, JudgeInstance, JudgeScoreOptions
├── flow/
│   ├── index.ts        Barrel — flow, signalFlow, cancelFlow, listFlows, createFlowId
│   ├── result.ts       Private FlowResult construction, current-operation finalization, and persisted-result sanitization
│   └── scope.ts        flow(name, handler), FlowHandle<T, TInput>, FlowRunOptions, FlowResumeOptions, FlowScope<TInput> — input inferred from the handler's second parameter, flow.input restored for scope-aware helpers, flow.results (auto-populated Record<string, unknown>), auto-pass (step fns accepting FlowScope receive it automatically), suspend/resume/cancel — throw-to-unwind pattern with RecordStore persistence
├── agent/
│   ├── index.ts        Barrel: agent, AnyAgent, InferAgentInput, InferAgentOutput, composition utilities, blackboard, handoff, delegate
│   ├── agent.ts        agent(), isAgent(), AnyAgent, InferAgentInput, InferAgentOutput — frozen agent definition
│   ├── executor.ts     AgentExecutor interface — SDK-agnostic agent execution contract (includes maxSteps)
│   ├── parallel.ts     createParallel() — concurrent named agents with typed result record
│   ├── pipeline.ts     createPipeline() — sequential chaining with typed context accumulation (PipelineResult, StepName, StepOutput)
│   ├── consensus.ts    createConsensus() — concurrent voting with quorum validation
│   ├── swarm.ts        createSwarm() — peer-to-peer routing via LLM-decided transfer tools
│   ├── create-compositions.ts  createCompositions(executor) — factory for adapter-bound utilities
│   ├── blackboard.ts   blackboard() — shared typed scratchpad, per-field validation
│   ├── handoff.ts      handoff() — schema-validated inter-agent context transfer
│   └── delegate.ts     delegate() — handoff + subagent execution as callable tool
├── skill/
│   ├── index.ts        Universal barrel: skill.inline, skill.fromRegistry, registry, generateIndex
│   ├── node.ts         Node-only barrel: fileSkill and skill.fromFile for local SKILL.md files
│   ├── types.ts        Skill, SkillMeta, SkillReference, InlineSkillConfig, LazySkill, SkillLoadError
│   ├── loaders.ts      inlineSkill() — create Skill objects from inline text
│   ├── file-loader.ts  fileSkill() — Node filesystem loader for SKILL.md files and references
│   ├── frontmatter.ts  parseFrontmatter() — lightweight YAML frontmatter parser for SKILL.md
│   ├── index.ts      generateIndex() — system prompt section listing available skills
│   ├── session-contract.ts  SkillActivationSession public contract, snapshots, persistence port
│   ├── session.ts      createSkillActivationSession() — deep per-turn boundary for active ids, loaded contexts, loader tools, injected ids
│   ├── tools.ts        LoadSkill + LoadReference tool-name constants
│   ├── cache.ts        In-memory Map with TTL for registry skill caching (follows contextResolverCache pattern)
│   ├── registry.ts     registry(), skillsSh, skill.fromRegistry(registry, path), registry fetch/cache resolution
│   ├── registry-fetch.ts  skills.sh client and .well-known/agent-skills/ protocol fetchers
│   ├── registry-observability.ts  registry load artifact emission
│   └── agent-kit.ts    createAgentSkillKit() — session-backed wiring helper for external agent frameworks (Convex Agent, Mastra, etc.)
├── safety/
│   ├── index.ts        Curated @use-crux/core/safety surface: authoring (guardrail/constraint), the Safety session, createSafetyPlugin, errors, evaluate helpers
│   ├── session.ts      createSafety() — THE consumption entry point (one session per generate/stream call). Owns three-scope merge (call > prompt > global, reads runtime globals + hooks once and snapshots), guarded-content selection with redaction write-back (guardInput), constraints-then-output-guards ordering with injectable corrective-feedback formatter (finalizeOutput), suspension policy (output safety skipped on tool-approval suspension), audit accumulation + TraceMeta stamping, protocol transcript for the parity suite, and the streaming sub-protocol (openStream: per-chunk holds/transforms, buffer:'full' flush validation, report-only constraints at finish)
│   ├── plugin.ts       createSafetyPlugin({ guardrails, constraints }) — CruxPlugin registering global policies (mergeHooks concats so multiple plugins compose)
│   └── guardrail/
│       ├── index.ts        Authoring barrel: guardrail, isGuardrail, evaluateGuardrail, GuardrailBlockedError (execution is session-only)
│       ├── types.ts        GuardrailContext, phase-conditional result types (InputGuardrailResult, OutputGuardrailResult, ChunkGuardrailResult), GuardrailStreamConfig, GuardrailAudit, optional category (risk-type aggregation)
│       ├── define.ts       guardrail() — frozen object factory (Object.freeze, _tag: 'Guardrail', captureSource), isGuardrail() type guard
│       ├── pipeline.ts     INTERNAL engine driven by the session — auto-splits by phase, sequential execution, redacted/transformed content flows forward, first block short-circuits
│       ├── evaluate.ts     evaluateGuardrail() — test case matrix runner (input × expected action → pass/fail report)
│       └── errors.ts       GuardrailBlockedError — thrown on block
│   └── constraint/
│       ├── index.ts        Authoring barrel: constraint, isConstraint, evaluateConstraint, ConstraintViolationError (execution is session-only)
│       ├── types.ts        ConstraintSeverity ('assert'|'suggest'), ConstraintCheckResult (discriminated union), ChunkCheckResult, ConstraintOutput<TSchema>, ConstraintContext, ConstraintAudit, ConstraintFailure, optional category
│       ├── define.ts       constraint<TSchema>() — frozen object factory (Object.freeze, _tag: 'Constraint', captureSource), isConstraint() type guard
│       ├── runner.ts       INTERNAL engine driven by the session — parallel-check combined-retry: Promise.all checks → combine feedback → regenerate → re-check. Assert drives retries, suggest is best-effort. Exposes observeConstraintCheck() for the session's report-only stream finish.
│       ├── evaluate.ts     evaluateConstraint() — test case matrix runner (output × expected pass → report)
│       └── errors.ts       ConstraintViolationError — thrown when assert constraints exhaust retries (carries all failing constraints)
│       (Predicate bridges live outside safety so it stays dependency-free: scoring/judge-constraint.ts builds Constraints from judges, eval/ runs Constraints as Eval scorers — both target the public Constraint contract)
└── adapter/
    ├── index.ts            Curated @use-crux/core/adapter surface (both dialects + the tool session + testing)
    ├── provider-runtime/   defineSingleTurnProviderBundle() and defineProviderRuntime() — public provider authoring compilers
    ├── spec.ts             AdapterSpec — provider contract for SDKs WITHOUT a tool loop (core drives)
    ├── types.ts            Canonical adapter types: AdapterResponse, CallArgs, StreamHandle, ToolResultEntry
    ├── completed-operation/runner-types.ts  Provider payload versus observed completed-media result contracts
    ├── executor-stream-types.ts  SDK-loop provider/public stream-handle type split
    ├── stream-result-types.ts  Public stream result and completion projections
    ├── codec.ts            ResolvedPrompt → CallArgs helper for public adapter codec wrappers
    ├── call-handle.ts      Public CallHandle plus incomplete/stale handle errors
    ├── define-adapter.ts   adapter() factory — thin AdapterSpec wiring to the execution session, plus adapter-bound compositions
    ├── native-chat/        Single-turn provider compiler/contracts (request/transcript/response/stream/settings/helpers)
    │   └── transcript/     Canonical transcript IR: ProviderTranscriptUnit + ProviderTranscriptDialect, messagesToTranscriptUnits()/transcriptUnitsToMessages(), appendCanonicalToolRound(), and defineProviderTranscriptCodec() compiling a dialect into a NativeTranscriptCodec
    ├── loop-runtime-port.ts LoopRuntimePort — gateway-closed adapter contract for SDKs WITH their own loop (SDK drives, core steers); BoundLoopRuntime = port minus id/describeModel/mapSettings
    ├── executor-types.ts   ExecutorRequest/Outcome, StepObserver → StepDirective (continue/stop/amend+refundStep), StructuredAttempt (invalid-as-value), ExecutorStreamHandle
    ├── define-executor.ts  loopRuntimeAdapter() factory — routing/fallback/cascade dispatch before the port sees a model, then execution-session delegation
    ├── execution/
    │   ├── session.ts      createAdapterExecution() — private execution facade preserving the factory-facing import path
    │   ├── dialect-types.ts / run-types.ts / types.ts   Internal contracts and the session-facing type barrel
    │   ├── dialects.ts     coreStepDialect()/sdkLoopDialect() thin adapters from public specs
    │   ├── generate-core.ts / stream-core.ts   Crux-owned one-step provider loop
    │   ├── handle-core.ts   Manual pause/resume shell over generate-core for prepare/step/finish
    │   ├── generate-sdk.ts / stream-sdk.ts     SDK-owned loop boundary, timeout and replay wiring
    │   ├── stream-legacy-completion.ts   Private compatibility bridge for legacy raw stream completion metadata
    │   ├── stream-retry-policy.ts   createStreamRetryPolicy() — the single source of stream retry policy (budget, eligibility, typed terminal error) shared by both routes
    │   ├── stream-rejection.ts      StreamValidationRejection — typed non-terminal validation cause (no terminal-error factory)
    │   ├── stream-attempt.ts        runCoordinatedStream() — native buffer-until-commitment attempt loop (early unlock preserved)
    │   ├── stream-coordinated-route.ts   openCoordinatedStructuredStream() — the native transactional structured route (gate detection, per-attempt provider stream, attempt spans, sealed completion)
    │   ├── stream-attempt-plan.ts / stream-attempt-plan-factory.ts   CoordinatedStreamPlan — the provider-neutral attempt port a loop-owning SDK runtime executes
    │   └── shared helpers  Prompt resolution, message shaping, metadata/cache replay, stream safety, and structured retry helpers
    ├── testing.ts          Testing barrel: providerRuntimeConformance(), adapterSpecConformance(), transcriptCodecConformance(), fakeLoopRuntime(), loopRuntimePortConformance()
    ├── testing/
    │   ├── provider-runtime.ts / provider-runtime-types.ts   Public provider-runtime conformance runner and harness contract
    │   ├── provider-runtime-vitest.ts                        Vitest wrapper: describeCruxAdapterConformance()
    │   ├── native.ts / native-types.ts   Native AdapterSpec conformance runner and provider harness contract
    │   ├── transcript.ts                 Native transcript codec conformance runner
    │   ├── fake-loop-runtime.ts          fakeLoopRuntime() — in-memory LoopRuntimePort reference + recorded calls
    │   ├── loop-runtime-conformance.ts   loopRuntimePortConformance() — LoopRuntimePort contract suite + harness
    ├── policy/
    │   └── validation-retry.ts   validateStructuredOutput() (repair → parse → Zod) + formatValidationFeedback()
    └── tool/               ONE deep module for the tool lifecycle (public barrel: @use-crux/core/adapter/tool)
        ├── index.ts        createToolLifecycle() + middleware authoring + app-facing approval helpers (the old tool-approvals barrel's exports live here)
        ├── session.ts      The per-call ToolLifecycle session over the private gate→execute→settle verdict kernel: merge precedence, middleware chaining, the approval suspend/resume protocol, both regimes' instrumentation profiles, LoadSkill re-arming, at-most-once memory capture, protocol transcript
        ├── context.ts      (internal) validates `toolsContext` against each tool's `contextSchema` before the loop starts
        ├── execution-options.ts (internal) injects lifecycle-owned execution options into SDK-regime tool maps
        ├── emission.ts     (internal) instrumentToolSet() leak-free hook wrappers (bounded pending map), tool model-output shaping/rendering/measuring, tool span/artifact emitters
        ├── approval.ts     (internal) Approval id/token minting, request message shape, decision validation (token verification), resume detection, approval observability
        └── resolved.ts     (internal) skill-session access + one completed-turn projection per memory binding
        (Safety policy lives in safety/session.ts — both dialects construct a Safety session AND a ToolLifecycle session, so neither safety nor tool semantics can drift)
```

### Memory capture lifecycle

Adapters project one immutable completed turn per memory binding; they do not inspect capture mode, fan out tool events, or flush blocks. The memory capture runtime invokes every block's `captureTurn` hook in declaration order, then fans out each tool event across the same ordered blocks. It owns settlement sequence numbers, flush epochs, bounded deferred-failure observation, and block flush ordering.

`inline` capture is awaited. The default `deferred` mode uses the source-internal diagnostics-only defer port, which distinguishes retained execution, Eval capture, and absence of retention. Missing retention is a latency downgrade: memory runs the same callback inline and awaits it. Configured host failures and unknown registration errors remain errors and are never retried. Eval cells capture deferred intent without executing memory hooks; explicit inline capture still runs for isolated memory-path Evals.

### Coordinated streams (commit gates and attempt retry)

A streaming attempt can be **rejected** after bytes have started arriving: an enforce
`assert` constraint commits the whole attempt, and a positive `validationRetry` is an
attempt-wide EOF-and-validate gate. The coordinated-stream machinery lets such an attempt
be discarded and restreamed without ever leaking output.

The invariant is **buffer until commitment, not until completion**. A commit gate releases
nothing while it is unresolved, so any byte the Safety stream emits is already committed;
released content therefore flows immediately (a scalar-path assert unlocks its prefix
before provider EOF) while a rejected attempt provably published nothing. A validation
gate is the exception: it holds the whole candidate until the authored `safeParse`
succeeds.

Retry policy lives in exactly one place — `createStreamRetryPolicy` — which owns the
shared `maxSteps` budget, per-constraint and per-validation eligibility, corrective
messages, and conversion of a typed non-terminal rejection into the stable public error.
The typed cause that rejects the current attempt and cannot obtain another step decides
that error deterministically: validation → `ValidationExhaustedError` (its `attempts`
counts validation retries, not provider calls), constraint → `ConstraintViolationError`.
There is never a combined error.

Two routes consume that one policy. The native route owns its provider loop and drives
`runCoordinatedStream` directly; `stream-core.ts` detects the gates and delegates to
`stream-coordinated-route.ts`, keeping the ordinary progressive stream — which publishes
provider deltas as they clear — separate from the transactional one, which publishes
nothing until an attempt has committed. Loop-owning SDK runtimes receive a
provider-neutral `CoordinatedStreamPlan` instead and execute it: **core decides why and
whether to retry; the runtime decides how an SDK stream is physically represented.** A
runtime opts in with `capabilities.coordinatedStream`; without it the untouched
single-attempt path is preserved and a rejection simply fails closed. On a coordinated
stream the returned `raw` is SDK-shaped but may be a runtime-composed logical stream
spanning attempts rather than object-identical to one provider attempt.

Constraint settlement is occurrence- and value-precise: the streaming gate records which
occurrence *value* passed (identity path plus a canonical subject fingerprint), and
completion suppresses a terminal re-check only when the same occurrence still carries the
same subject. A rewrite of the constrained path invalidates its settlement; a rewrite
elsewhere preserves it. This is what keeps a `constraint.judge()` from running twice.

Each physical provider stream opens one `generation.stream.attempt` child span under the
single logical `generation.stream`, carrying `attemptIndex`, `cause`, and an `outcome`
where a policy rejection is `discarded` rather than a provider error. `constraint.retry`
remains the separate policy-decision span.

### Safety internals

Core owns one provider-neutral semantic model-ingress capability. Its private
slot document represents guardable text, semantic media, and opaque protected
parts; the guard returns slot patches rather than a reconstructed canonical
output. Core tool outputs and package-native dialects such as AI SDK output each
apply the patch to their original value, preserving untouched bytes and object
identity. Opaque/custom slots and bounded media sentinels are structural anchors:
a text rewrite that changes them fails closed.

The lifecycle is `toolPolicy.result(raw) → toModelOutput → boundary.input.* →
model`. Raw tool policy executes before canonical model-output conversion;
semantic ingress policy executes exactly once afterward. Deterministic JSON is
projected as model-facing text and is not recursively searched for media. This
ordering means custom `toModelOutput()` implementations cannot bypass Safety.

Prompt resolution carries private, non-serializable retrieval fold provenance
with the resolved value. In system mode the fresh resolved system is guarded
before replacing the active system. In messages mode Core verifies and patches
the one folded system prefix, preserving its trusted suffix and every later
assistant/tool turn. Resolver-owned family—not a spoofable source string—marks
retrieval text. Prefix mismatch or failed writeback terminates before another
provider call, and the carrier never enters public types, metadata, provider
requests, audit, or observability. With no applicable policy, request bytes and
identities remain unchanged.

For ordinary canonical messages, `guardInput()` projects text through
`messageText()`. When a guard rewrites a multimodal projection, the session uses
unchanged media placeholders as ordered anchors and redistributes only rewritten
text across the original text parts. A changed or missing anchor, media-only
message, or ambiguous placeholder throws `SafetyResultError`; audit never claims
an unapplied rewrite.

### Two adapter dialects

`defineSingleTurnProviderBundle()` is the preferred public authoring boundary for raw chat SDKs where Crux owns the tool loop. The provider bundle owns request assembly, a required `NativeTranscriptCodec`, response metadata normalization, stream delta extraction, settings/schema mapping, provider-specific deps, the SDK client binder, and lightweight helper factory creation. Core compiles the bundle through the lower-level `defineProviderRuntime({ ownership: 'single-turn', turn })` path, which in turn emits the `AdapterSpec` IR and public `createX()` adapter factory. The lower-level single-turn branch remains available for compiler tests and unusual packages that need to assemble the runtime object directly, but provider packages should prefer the bundle so `runtime`, `create()`, helper factories, dependency mappers, ownership metadata, and extension collision checks are generated consistently. Native provider packages own the wire codec that turns canonical `Message[]` into provider transcripts and reads assistant text/tool-call intent from raw responses: OpenAI emits `tool_calls` plus `tool` messages, Anthropic emits assistant `tool_use` blocks plus user `tool_result` blocks, and Google emits `functionCall` / `functionResponse` parts with synthesized ids where needed. Those codecs are not hand-written end to end: core owns a canonical transcript IR (`native-chat/transcript/`) that extracts neutral `ProviderTranscriptUnit`s from `Message[]`, groups adjacent tool results, renders tool-result fallback text/error flags through shared `ToolResultEncodingHelpers`, and appends a tool round exactly once via `appendCanonicalToolRound()`. Each provider implements a `ProviderTranscriptDialect` (encode text/assistant/tool-results, decode a wire message, read the assistant turn) using only its SDK types, and `defineProviderTranscriptCodec(dialect)` compiles it into the `NativeTranscriptCodec`. A dialect never interprets raw `Message.metadata`, so a provider's public `fromMessages()` and its runtime tool-round appends can no longer drift — Anthropic in particular no longer needs a bespoke append merely because it represents tool results as user-role blocks. Core injects transcript-produced `providerMessages` into request builders and composes `transcript.readAssistant(raw)` with response-level metadata (`usage`, finish reason, ids, actual model id); structured-output text overrides stay as response-level functions. Core intentionally shares only provider-neutral pieces: canonical transcript/response types, tool-result metadata guards, deterministic rich-content text rendering, and the native-chat compiler. Provider runtime tests use `providerRuntimeConformance()` / `describeCruxAdapterConformance()` against the public runtime, while `transcriptCodecConformance()` checks provider transcript laws directly: wrapper parity, provider-message encoding/decoding, assistant extraction, and optional tool-round appends. `ownership: 'loop-owned'` with `loop.bind()` covers orchestrating SDKs like the Vercel AI SDK: `bind(client)` returns the client-dependent operations (`BoundLoopRuntime`), which core assembles with `describeModel`/`settings`/`id` into a gateway-closed `LoopRuntimePort` (no per-call client threading) and hands straight to `loopRuntimeAdapter()`. The port hands the loop to the SDK with the execution session's armed `tools` map, and core steers each completed step through `StepObserver.onStepEnd() → StepDirective` (observe step N, apply before step N+1 — runtimes buffer `amend` directives and apply them in the next step's preparation). Both runtime branches adapt their compiled contracts into `createAdapterExecution()` (`core-step` or `sdk-loop`) after concrete model routing is resolved; the `sdk-loop` dialect is simply the `LoopRuntimePort` tagged with a discriminant. Structured output goes through `runStructuredAttempt()` for loop-owned runtimes, which performs exactly one attempt and returns schema failures as the `invalid` variant rather than throwing, keeping the corrective-retry loop in core. Tool-approval needs surface as a `suspended` outcome; the execution modules use `ToolLifecycle.suspend()` to seal it (id/token minting, request message, observability) and `ToolLifecycle.resume()` to replay decided calls — with full spans/artifacts/hooks in both dialects.

### Multimodal content

`Message.content` is the single canonical message-content boundary: it is either a string or a readonly `ContentPart[]`. `ContentPart` is a closed visible-content union for text, image, and file parts. Media parts carry a `MediaSource` on `source`; protocol control stays in `Message.metadata`, and SDK-shaped tool calls and approval parts normalize there instead of entering the content vocabulary.

Every string-only subsystem uses `messageText()` or `contentText()` as the one projection. Text is preserved verbatim, and media becomes bounded placeholders with MIME type, optional filename or URL, byte size, and short hash where relevant. The projection is used by guardrails, compaction, memory capture, semantic cache query text, resolver system folding, Convex memory persistence, and OTel content export, so these systems never see `[object Object]` or raw base64.

Adapters encode content through one exhaustive provider-local part table. The same table is used for message content and rich tool results, which keeps managed `generate()`, headless `prepare()`/`step()`/`finish()`, public `toParams()`/`fromResponse()`, and `transport` mode on one translation path. Core normalizes and validates invocation media before provider I/O; malformed media throws `InvalidMediaSourceError`, and valid media that a selected adapter or model cannot send throws `UnsupportedCapabilityError`.

Inside `@use-crux/ai`, the `LoopRuntimePort` implementation (`createAiSdkLoopRuntime(gateway)`) is intentionally just a gateway runner over an internal SDK call-plan codec. The codec builds AI SDK args, wires loop steering, tool-call repair, structured-output repair/error projection, stream callbacks, stream safety transforms, completion metadata, and replay shape; `SdkGateway` remains the only code that calls the `ai` package runtime. The external-agent bridge follows the same boundary: `@use-crux/ai/agent` uses core prompt resolution and inspect data, then owns AI SDK model wrapping, stream progress, tool timing estimates, provider metadata cost extraction, and tracing middleware.

Public adapter codecs are thin wrappers over the same request/response hooks.
`toParams(resolved, { model })` first uses `codec.ts` to shape a resolved prompt
into canonical `CallArgs`, then each adapter applies its existing settings,
transcript, schema, request, and response helpers. Codecs do not run tool
lifecycle policy. Anthropic's headless handle is a sans-I/O shell over the same
`generate-core.ts` path: `handle-core.ts` starts `generateCore()` with a manual
provider `call()` implementation that captures params and waits; `step(response)`
decodes the raw response through the provider hook, resolves that pending call,
and returns either the final envelope or the next captured params.

Both regimes drive the same private gate→execute→settle verdict kernel inside `adapter/tool/session.ts`: `executeRound()` is the pull shell, the armed tool map is the push shell. Before either shell runs, the lifecycle validates `toolsContext` against each composed tool's `contextSchema` and stores the parsed value next to the shared `runtimeContext` for execute hooks, middleware, and approval middleware. Live SDK-regime tools now use the same canonical emission profile as core-regime tool execution: `tool.call` spans with consumed `tool.args`, raw and model-facing `tool.result` artifacts, relation edges, and paired `tool.call start records` / `tool.call end records` hooks. That, plus the shared Safety session, is the structural guarantee that validation retry, instrumentation hook ordering, tool observability, approval semantics, typed tool context, skill re-resolution, memory capture, and safety merges behave identically regardless of who drives the loop. The cross-dialect parity suite (`__tests__/adapter/dialect-parity.test.ts`) verifies it mechanically: identical hook protocols, span/artifact structures, message shapes, and errors for clean rounds, middleware-modified rounds, suspension, resume-approved, resume-denied, token mismatch, and mid-loop skill loads.

## Runtime Profiles

Core primitives remain SDK-agnostic. Runtime packages may mirror core subpaths when they can preserve the same conceptual API while adding environment-specific plumbing. `@use-crux/convex` follows that pattern for `context`, `skill`, `memory`, and `tools`: unchanged APIs are re-exported, Convex-bound drop-ins keep the same public shape where possible, and genuinely Convex-specific runtime concepts use explicit names such as `convexAgent()` and `createCruxConvex()`.

This keeps core definitions portable while letting Convex code import from `@use-crux/convex/*` consistently.

## Error Observability Contract

Thrown execution failures are normalized at the observability boundary, not in individual UI surfaces. `observability/errors.ts` accepts `unknown`, preserves the distinction between thrown `Error` instances and thrown values, extracts `name`, `message`, `stack`, and bounded `cause` data when present, and converts raw data into a JSON-safe representation with circular references, long strings, deep objects, and common secret keys bounded or redacted.

`observe.span()` and `observe.openSpan().error()` use that normalizer to emit three layers:

- A compact `error` summary on `span:end` or `run:end` for filtering, status rollups, and list views.
- A `span:event` named `exception` with OpenTelemetry-style attributes such as exception type, message, and stack trace when available.
- `error.stack` and `error.raw` artifacts attached to the failing span when detail exists.

The Go read model promotes `span.Error`, `error.stack`, and `error.raw` into `inspection.errors`. Web devtools and the TUI render that inspection section before primitive-specific payloads, so tools, retrieval stages, generation calls, flow steps, eval cases, and custom spans get the same failure display whenever they use the canonical span contract.

Do not use exception evidence for ordinary control outcomes. Approval denial, guardrail block reports, constraint retries, retrieval zero hits, citation validation issues, cascade tier rejection, flow suspension/cancellation, and stream finish reasons are status, event, or artifact data unless user code actually throws. Runtime bridge and Eval coordinator failures that happen outside any span use the same normalized shape inside `command.error.details`.

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

Replacement is generation-aware. New chunks and parent records are written with a fresh `generationId` and `active: true`; only after the write succeeds does the indexed knowledge read-model boundary mark previous generations for the same source inactive. The same internal boundary owns chunk/parent key derivation, vector metadata projection, active chunk search filters, vector-hit hydration, parent lookup, source deletion, and namespace clearing so indexing, retrieval, and parent expansion share one persisted contract.

Pipeline caching is stage-level, not whole-indexer caching. When `cache: true` is configured, document transforms, chunking, and chunk transforms are cached by source hash, previous stage hash, stage identity, and stage fingerprint. Final dense and sparse vectors are cached separately as ordered source bundles keyed by source id, vector kind, embedding fingerprint, and a hash of ordered chunk content. Source metadata and generated chunk ids are deliberately absent: identical ordered provider input is safe to reuse even when an `indexVersion` change requests a new generation. Hits scatter back into invocation order; all misses for one kind flatten into one `embedMany()` call and are strictly validated before any cache or generation write.

`cache: 'bypass'` skips reads/writes for one call, while `cache: 'refresh'` recomputes and replaces cached outputs. Dry runs may populate stage entries even though they do not write indexed chunks or corpus ledger records. Dense runs complete before sparse runs, preserving provider load characteristics and exact hybrid ordering.

The source ledger stores the emitted `SourceStageRecord[]` for indexed sources. The same records flow through `index:end` and `corpus:source:*` instrumentation so devtools, CLI/TUI, and OTel can show stage counts, cache hits, chunk counts, parent counts, durations, and failures without inventing a parallel observability model.

Embedding bundles emit one privacy-safe `embedding` stage record per source and
vector kind. A full hit still produces its `indexing.pipeline` stage span and
bounded `indexing.report`, but does not fabricate an `embedding.call` span.
Artifacts contain counts and hashes, never chunk text, vector values, or raw
fingerprints.

## Resolution Pipeline

`compilePrompt(config, { ports? })` is the resolution module boundary. It validates the prompt config, binds resolver ports, and creates a `PromptResolverPlan` (`createPromptResolverPlan`) that merges prompt-owned and `use:` input schemas once. `compilePrompt()` is a thin wrapper: `resolve()` and `inspect()` are projections over the plan's single `run(opts, mode)` primitive, so they can never drift. When an adapter calls `prompt.resolve(options)`, the plan runs one pass that produces both the SDK-ready `ResolvedPrompt` and an inspection view over the same intermediates:

```text
Compile prompt config (compile.ts → createPromptResolverPlan)
  ├── messages/system mutual exclusion check
  ├── input schema merge + conflict detection
  └── resolver port binding (withDefaultResolverPorts)
  ↓
Input validation (Zod parse output adopted)
  ↓
Custom sanitize hook
  ↓
Auto-escape top-level string inputs (if enabled)
  ├── `rawFields` skip trusted top-level fields
  └── nested string values warn because they are not rewritten
  ↓
Input guard (Proxy) — wraps objects to throw on string interpolation
  ↓
Resolve context entries (resolver/ — contributor lowering + driver)
  ├── lowerEntry(): each use entry → a lowered contributor (the ONLY union-aware code)
  ├── gate: falsy filter, context-level `when`, `when()` wrappers, `match()` discriminators,
  │         contributor `when` — exclusions recorded with source + reason
  ├── children: nested `use` entries / match branches resolve BEFORE the entry itself
  ├── contribute: contexts, tools (collision-checked), constraints, guardrails, metadata,
  │               memory and Thread bindings, skill + blackboard collection, pipeline re-entry
  └── Output: active Context[] + excluded ExcludedContext[] + merged channels
  ↓
Internal post-merge collectors
  ├── Skill collector (resolver/skills.ts)
  ├── Lazy registry skills fetched via SkillSourcePort (failures degrade with diagnostics.warn)
  ├── Skill index context unshifted (priority 90), loaded-skill contexts appended from a SkillActivationSession (priority 85)
  └── Blackboard tool-dedupe checks run against the merged tool surface
  ↓
System message assembly (with return type validation on systemFn)
  ├── Prompt's own string, PromptText, or explicit segmented system content (always included)
  ├── Active context contributions (resolved in `use` array order)
  │     ├── Normalize string, PromptText, or segmented `{ segments }` content
  │     └── Context memo cache: skip systemFn() on memo hit (by contextId + declared input hash)
  ├── Token budget enforcement (drop lowest-priority contexts)
  └── SystemBlock[] construction (per-block providerCache hints for adapters)
  ↓
Provider system adaptation
  ├── Match: exact provider > modelId slash-prefix > '*' wildcard
  └── Insert prepend/append system text as `SystemBlock { source: "adaptation:<key>", providerCache: false }`
  ↓
Prompt text / messages resolution (with [object Object] safety net)
  ├── String prompt: resolve static or dynamic without changing its existing bytes/inspection shape
  ├── PromptText: lower once to provider-neutral text plus structural inspection segments
  └── Messages array: fold the final post-adaptation system text, then scan for [object Object]
  ↓
Provider prompt/settings adaptation
  └── Apply prepend/append prompt text and override settings
  ↓
Settings merge
  config.settings < adapt.settings < call-site overrides
  neutral toolChoice/stopWhen/maxSteps stay in GenerationSettings until the adapter maps them
  ↓
Tool collection (only from active contexts)
  skill tools → context tools → contributor tools → blackboard tools → prompt tools
  prompt-time name collisions throw with both owners named
  call-site tools are applied later by adapter execution and intentionally win
  ↓
PromptResolution
  ├── args: ResolvedPrompt { system, systemBlocks, prompt, messages, schema, tools, toolMiddleware, settings, threadBinding }
  └── inspect() derives InspectResult from this same pass
  ↓
Adapter execution
  prompt toolMiddleware + call-site toolMiddleware wrap final tools
  approvalMiddleware maps matched calls to resumable approval protocols (`@use-crux/ai` uses AI SDK; native adapters use Crux message metadata)
```

### Contributor Lowering and Resolver Ports (`resolver/`)

The entry-resolution half of the pipeline lives in `resolver/` (use-crux/crux#29):

- **`resolver/lower.ts`** — `lowerEntry(entry, index)` turns each member of the `ContextEntry` union (context, `when()` wrapper, `match()` spec, skill, memory, blackboard, private inject-shaped primitives, `contributor()` entry, falsy) into an internal `LoweredContributor` answering up to four questions: `gate` (sync include/exclude with reason + observability facts), `children` (sync nesting), `contribute` (async, the only I/O point), and — at definition time — `collectSchemaContributions()` (the "shape" question for input-schema merging). This is the only module that knows the union; family classification lives here too and reads `Context.family`, declared through internal helpers by primitive factories — memory, blackboard, retriever/grounding, handoff, and the skill surface (no id sniffing).
- **`resolver/driver.ts`** — `resolveUse()` walks lowered contributors: gate facts emit first, children merge before the entry's own contribution, `Contribution.use` re-enters the pipeline with branch-local indices, tool collisions throw with the owning entry attributed, and all `context.contribution` artifact emission happens at exactly two sites (gate steps + contribution facts).
- **`resolver/skills.ts`** — the cross-entry collector for skills. The shared pass calls it from the post-merge phase before either `PromptResolution.args` or `PromptResolution.inspect()` is projected, so skill indexing, lazy registry fetches, and loaded-skill contexts cannot drift between resolve and inspect. Registry fetch, skill-index generation, and activation-session creation all flow through the `SkillSourcePort` (no direct skill-module imports in the pass). Resolve-mode skill tools are bound to a `SkillActivationSession` and the resolved prompt carries `_skillSession` as the explicit activation boundary.
- **`resolver/ports.ts`** — the pipeline's ambient capabilities as injectable ports (pure contracts): `ObservabilityPort` (spans + artifact/edge choreography), `SkillSourcePort` (registry fetch + index + activation-session creation), `ContextCachePort`, `ClockPort`, `TokenizerPort` (every reported token count flows through it, so a deterministic counter pins budget behavior), `policy()` (auto-escape / security warnings), `DiagnosticsPort`, `InstrumentationPort`. The production adapters live in `resolver/default-ports.ts`; `withDefaultResolverPorts()` wraps the pre-existing globals lazily, so `setHooks()` / `configureObservability()` / `setTokenizer()` keep their install-takes-effect-immediately semantics. `compilePrompt(config, { ports })` binds the pipeline to explicit ports; in-memory fakes for every port — plus the one-call `createResolverFakes()` bundle — ship from `@use-crux/core` (`resolver/fakes.ts`).
- Contributor-internal I/O (memory stores, retriever indexes, blackboard stores) deliberately has **no pipeline port** — those factories take their dependencies explicitly (`memory({ records })`), which is the correct seam.
- The lowered `Contributor` contract types are exported from `@use-crux/core` as advanced API for adapter and primitive authors. The lowering, driver, and schema collection functions stay internal to the compiled prompt boundary. The everyday authoring surface is `contributor()` — a first-class `use:` entry with `when` gating, nested `use`, and full-channel contributions through the same channels as other entries.
- Memory entries contribute their context (reported with family `memory`) and a memory binding; memory tools are opt-in via `memory.asTools()` and are neither merged nor reported as injected. The legacy sync `flattenContextEntries()` pass has been removed — the driver is the only gating code path.
- A Thread entry contributes one structural binding and no schema, text, or tools. The resolver rejects duplicate bindings. Adapter execution reads the exact history once before the provider call, commits only the rendered user turn and accepted assistant/tool exchange, and exposes the receipt on the final result. Explicit call-site `messages` shadow both Thread reads and writes.

### Token-Aware Context Dropping

The internal system composer handles the token budget:

1. Prompt's own system text is always included and its tokens are subtracted from the budget.
2. Context contributions marked with `cache: true` form a stable provider-cache prefix after the prompt's own system text, preserving their `use` array order.
3. Uncached context contributions form the dynamic tail, also preserving their `use` array order.
4. When a budget is set, only the uncached tail is sorted by priority (ascending) and dropped until the total fits. Cached prefix blocks are never dropped; if the prefix alone exceeds the budget, the resolver keeps it, warns, and records `prefixOverflow: true` on the `prompt.budget` artifact.
5. Dropped contexts are tracked in the `InspectResult` with their source, text, token count, and priority.

The observability graph mirrors the same state. Resolved context artifacts use the canonical `context.contribution` artifact kind and carry source, state, inclusion, priority, token, cache, injection, and freshness metadata. Prompt resolution emits a redacted `prompt.input` preview under the canonical `input` artifact kind; it contains top-level provided/schema/required/missing/unexpected keys and validation status, but never input values. Segmented system content preserves `segments: { text, dynamic, source?, observedAt?, sourceVersion? }[]` plus `staticTokens` / `dynamicTokens` on contribution previews, prompt inspect parts, system blocks, and budget-dropped previews. Inspect parts and contribution previews also report `servedFrom`, `resolvedAt`, and memo-hit `age`; part-level `observedAt` is the oldest segment observation time, and `sourceVersion` is the first segment version. When a prompt or context function returns a plain string, direct interpolation of unambiguous primitive input values is inferred into static/dynamic segments; transformed values still require explicit `{ segments }` for perfect provenance. Predicate failures and unmatched `match()` branches emit `state: "checked-not-included"` with `reason` and `branch` when available. Budgeted resolution emits a `prompt.budget` artifact containing `usedTokens`, `totalTokens`, dropped contribution payloads, and `prefixOverflow: true` when the stable provider-cache prefix is larger than the requested budget, then generation spans link that artifact as consumed. Generation `messages` artifacts include request tool names. The Go RunDetail projection composes these records into `RunDetailNode.request`, using exact generation requests for generation nodes, inherited nearest-ancestor requests for nested framework agent steps that only emit output-shaped message artifacts, and a final-descendant representative with `turns[]` for run/stream/agent/flow/composition aggregators. Contribution artifacts referenced from `messages.systemBlocks[].artifactId` are recovered through the graph index even when the producer span, not the generation span, owns the artifact. For framework agents whose prompt resolves under `agent.run` before the model stream, the projection also collects context contributions and prompt budgets produced under the nearest request scope before the generation starts; later child tool/flow generations are outside that time window. Convex Agent `thread-context` message artifacts are preferred over `call-args` when both are available, their prior-turn fields remain on `request.messages`, and inherited agent steps add earlier sibling generation outputs as `previousStepMessages`. Base-prompt provenance uses the concrete generation `promptId` where known, falling back to `messages.system` / `messages.prompt` for raw request fields. Model provenance is projected into `request.modelSummary`, per-turn `model` / `provider`, and flattened `RunDetail.rows[]`, preferring output artifact `meta.actualModelId` over selected/requested model attributes. Convex Agent wrapper spans emit the configured Agent `languageModel` on the aggregate stream/call and each AI SDK step span so framework turns are modelled even when no nested Crux generation exists; child tool/flow generations keep their own model provenance. UI clients should render that projection instead of walking descendant artifacts.

The tokenizer is pluggable via `setTokenizer()` or `config({ generation: { tokenizer } })` for the ambient runtime; inside the pipeline every token count flows through the `TokenizerPort`, whose default adapter wraps that global. The default estimates tokens as `Math.ceil(text.length / 4)`. Tests pass a deterministic counter (e.g. `staticTokenizer()`, word count) through the port to pin budget decisions without depending on the estimate.

### Context Resolver Memoization

System composition includes a memo layer for expensive dynamic context resolvers:

1. Before calling `ctx.systemFn(input)`, if `ctx.memoTtl > 0` and `ctx.id` is set, compute a cache key: `cache:ctx:{id}:{stableHash(inputFields)}`.
2. Check the `ContextCachePort` (default adapter: the module-level map that has always backed this memo cache). On hit, return cached content, preserve the original `resolvedAt`, report `servedFrom: "memo"` plus `age`, and fire `onContextCacheHit` through the `InstrumentationPort` with the entry’s age.
3. On miss, call `systemFn(input)`, stamp the result with `servedFrom: "live"` and `resolvedAt` from the `ClockPort`, store the result with `memo.ttl`, and fire `onContextCacheMiss` (timings from the `ClockPort`).
4. Cache key only includes input fields declared in the context's `inputSchema` (sorted alphabetically), so unrelated prompt-level fields don't pollute the key.
5. Static string contexts reject `memo` at definition time because there is no resolver call to memoize.

Provider prompt caching is separate: `context({ cache: true })` marks the
resolved block with `providerCache: true` so adapters can emit native cache
markers. If a context sets `cache: true` but `memo.ttl` is shorter than the
provider cache window, prompt compilation emits an advisory diagnostic through
`DiagnosticsPort`.

### Semantic Response Caching

`createSemanticCache()` lives in `cache/index.ts` and installs a `PromptMiddleware` runtime plugin. It wraps the shared orchestration layer rather than individual providers, so `@use-crux/ai`, `@use-crux/openai`, `@use-crux/google`, and `@use-crux/anthropic` all get the same behavior once they pass prompt metadata into `orchestrateGenerate()` / `orchestrateStream()`.

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

After composing the system string, the same internal pass also builds a `SystemBlock[]` array:

- Each non-skipped, non-dropped part becomes a `SystemBlock { source, text, providerCache, cacheBoundary? }`.
- `providerCache` is read from `context({ cache: true })`.
- The prompt's own system block has `providerCache: true` when `cache.provider === true`, or when it is static text and at least one contribution block joins the cached prefix.
- `cacheBoundary: true` is set on the last provider-cache block. Adapters place exactly one native breakpoint there.
- `SystemBlock` is re-exported from `@use-crux/core` (alongside `ResolvedPrompt`) so adapter authors can annotate the `systemBlocks` field without reaching into internal modules.
- Adapters use `systemBlocks` to emit provider-native cache markers:
  - `@use-crux/anthropic`: Converts to `TextBlockParam[]` with `cache_control: { type: 'ephemeral' }` on the `cacheBoundary` block.
  - `@use-crux/google`: a single `GoogleCachedContentLifecycle` owns CachedContent end to end. `prepare()` returns a request-ready config patch that both `call()` and `stream()` merge, so neither path knows about cache internals. The built-in lifecycle composes a pure prefix planner, an in-memory store (SHA-256 content+TTL hashing, concurrency dedup via promise sharing, per-call TTL expiry, LRU eviction), and a narrow `GoogleCachedContentCachePort` adapting `client.caches.create()`/`delete()`. The cached prefix goes into `config.cachedContent`, the uncached remainder into `config.systemInstruction`, and `onError` selects graceful inline fallback (default) versus rethrow.
  - `@use-crux/ai` (Vercel): Anthropic-only — converts blocks to `SystemModelMessage[]` with `providerOptions.anthropic.cacheControl` on the `cacheBoundary` block when the model is Anthropic.
  - OpenAI: No action needed — prefix caching is automatic with stable ordering.

### Conditional Context Resolution

Gating runs inside the contributor driver (`resolver/driver.ts`), before system message assembly, via each lowered entry’s `gate`:

1. **Falsy entries** (`false`, `null`, `undefined`) are filtered out.
2. **Plain contexts** with a `when` field have their predicate evaluated. If `false`, they are excluded.
3. **`ConditionalContext`** (from `when()` wrapper) has its predicate evaluated. If `false`, the wrapped context is excluded.
4. **`MatchSpec`** (from `match()`) evaluates its discriminator exactly once, selects the matching branch, and includes only those contexts.
5. **`contributor()` entries** with a `when` gate are excluded the same way (`contribute()` is never called).

Excluded contexts contribute nothing — no `systemFn` call, no tool contribution, no token counting. They are tracked in `InspectResult.excludedContexts[]` for observability.

Runtime observability distinguishes excluded context entries from budget-dropped entries: excluded entries are `checked-not-included`, while resolved entries removed by the system composer are `dropped-budget` entries in the `prompt.budget` artifact.

### Input Schema Merging

At `compilePrompt()` time (and therefore at `prompt()` definition time), input schemas from all context entries and the prompt itself are merged into a single Zod object schema:

- Context schemas are merged from all possible entries (including all `match` branches).
- Conditional contexts (via `when()`, `match()`, or context-level `when`) have their keys wrapped as `.optional()` in the merged schema, since they may not be active.
- If two contexts declare the same key, an error is thrown at definition time.
- The prompt's own fields silently override context fields (no error).
- The merged schema is used for input validation in `.resolve()`.

The public TypeScript surface mirrors those runtime rules: `when()` wrapper
predicates see partial context input, `match()` branch fields are optional in
`MergedInput`, `messages` mode is exclusive with `system`/`prompt`, and concrete
prompts expose literal `hasOutput` values for adapter branching.

### Provider Adaptation

The `adapt` field on prompts supports three matching strategies, checked in order:

1. **Exact provider match** — `adapt.openai` when provider is `"openai"`
2. **Model ID prefix** — for OpenRouter-style routing where `modelId` is `"openai/gpt-4o"`, the prefix `"openai"` is extracted and matched
3. **Wildcard** — `adapt['*']` applies to all providers

Each adaptation can `prependSystem`, `appendSystem`, `prependPrompt`, `appendPrompt`, and override `settings`.

## Embedding Pipeline

`embedding()` is a first-class dense/sparse primitive, not a retrieval abstraction.

Provider-facing helpers sit above it:

- `@use-crux/ai` exposes `embedding()` for AI SDK embedding models
- `@use-crux/openai` exposes `embedding()` for direct OpenAI SDK usage
- `@use-crux/google` exposes `embedding()` for direct Google GenAI SDK usage
- `@use-crux/anthropic` stays generation-only on the direct SDK path

Execution model:

1. Validate config once at definition time.
2. Normalize every public text/media input through the canonical content boundary and reject undeclared modalities before provider I/O.
3. Apply configured preprocessors, token counting, and truncation to text only. Media retains its native provider input.
4. Check the embedding cache by role- and modality-aware key when configured. Data media uses SHA-256; unmaterialized remote media remains compute-only.
5. Split cache misses into chunks of `batch.maxSize`.
6. Run chunk requests with per-call `batch.concurrency` and optional cross-call `rateLimit.concurrency`, carrying query/document role in one shared runner.
7. Retry failed provider batches according to the configured retry policy.
8. Reassemble cached and provider results in original input order, preserving strict N-to-N cardinality.
9. Aggregate optional `usage`, `cost`, cache, retry, truncation, and rate-limit metadata across chunks.
10. Emit a canonical `embedding.call` span once per top-level `embed()` or `embedMany()` call, including bounded modality/role/space metadata and produced edges.
11. Emit legacy `embedding.call start records` and `embedding.call end records` instrumentation hooks for compatibility.

Governance is intentionally on `embedding()` instead of retrievers/indexers. Preprocessing, truncation, retry, cache keys, and provider rate limits change the vectors being generated or the provider calls needed to generate them. Placing those policies on the primitive makes every consumer use the same behavior.

Cache keys include:

- embedding kind
- embedding name
- dense dimensions when present
- `maxInputTokens`
- preprocessor fingerprints
- truncation policy
- declared vector-semantic `version`
- sorted declared modalities, normalization, and role-task mappings
- normalized input hash

Every `embedding()` instance exposes the stable serialization of those
vector-producing fields as `fingerprint`. Operational policy such as batching,
retry, rate limiting, and cache placement is excluded. Provider helpers merge
their model/request identity with an optional user `version`; untyped headers
and provider options are never serialized. Structural embedding implementations
may omit `fingerprint`, in which case indexing computes them on every run rather
than guessing whether cached vectors remain compatible.

Dense instances also expose `space`, derived from the same fingerprint. Sparse
embeddings remain text-only and do not expose a dense-space contract.

Embedding cache access emits nested `cache.lookup` spans with cache namespace, hit/miss counts, write counts, and per-entry hit/miss events. Raw input text, media bytes/locators, and raw vector values are never emitted to OTel. Devtools/CLI/TUI receive bounded embedding metadata such as modalities, role, space digest, cache hits, misses, retries, truncated counts, duration, dimensions, usage, and cost.

Hybrid search lives above this layer:

- dense-only vector stores handle `VectorStore.search({ dense })`
- sparse-only and hybrid-capable vector stores handle `VectorStore.search({ sparse })` and `VectorStore.search({ dense, sparse, fusion? })`
- Upstash is the reference `VectorStore` for dense + sparse + hybrid query composition

## Retrieval and Indexing Pipeline

Crux now treats document retrieval as a five-part stack:

1. **Embedding** — `@use-crux/core/embedding`
2. **Ingestion** — `@use-crux/ingest`
3. **Indexing** — `@use-crux/core/indexing`
4. **Corpus sync** — `corpus()` from `@use-crux/core/indexing`
5. **Retrieval** — `@use-crux/core/retrieval`

Those boundaries are deliberate:

- embeddings generate vectors
- ingestion loads raw sources into documents
- indexing turns text and media documents into canonical stored chunks
- corpus sync tracks source state across repeated ingestion jobs
- retrieval turns text or media queries into scored hits, context, and tools
- reranking, when used, happens after raw retrieval and before context/tool rendering

This keeps hybrid support in the correct layer. Dense and sparse are embedding kinds. Hybrid is a retrieval strategy composed through `VectorStore.search({ dense, sparse, fusion })`, not a third embedding kind.

Media documents preserve one-input-one-vector semantics: each media part becomes
one chunk, and page/time/region splitting stays upstream. The indexer stores
media through `AssetStore` when configured, then persists only `AssetRef`, MIME
type, source location, and allowlisted scalar attribution. Media sources bypass
pre-embedding pipeline caches so transient bytes never enter stage records.

The indexed-knowledge boundary owns vector-space enforcement. Before the first
vector write it compares the dense embedding digest with the namespace space
record; only a compatible write may stamp vectors and persist that record. The
retriever performs the same namespace check before query embedding or vector
search, with vector metadata as a legacy fallback. `clear()` removes both data
and space identity, while `deleteSource()` preserves the namespace contract.
Changing a space requires a full reindex or a new namespace.

Media retrieval uses the dense branch only. Sparse embeddings and custom
retrievers remain text-only. Recipes may pass media through a direct
`retrieve()` step, but text-producing rewrite/fanout/model steps reject media
instead of inventing a caption. Recipe traces retain only a safe modality label.

Advanced query-time composition lives in `retrievalRecipe({ retriever, steps })`, not inside store adapters and not as more inline `retriever()` config. Recipes are named, traceable compositions over one or more retriever sources. Query steps such as `rewriteQuery()` and `fanout()` transform planned queries before federated retrieval; hit steps such as `rerank()`, `expandParents()`, and `compressToBudget()` operate on retrieved candidates before final rendering. Recipe handles expose `retrieve()`, `retrieveWithTrace()`, `asRetriever()`, `asTools()`, and `asGrounding()` so prompt composition can consume the same recipe through context, tools, or citation-aware grounding.

Parent expansion relies on write-side metadata but does not duplicate the writer's key contract. Parent/child indexing stores parent refs on child chunks, and `expandParents()` asks the indexed knowledge boundary to resolve either the stored parent key or a derived parent ref. The step enriches the child hit with parent content without replacing the child identity or score.

Retrieval observability writes the canonical graph directly. Direct retriever calls open `retrieval.query` spans with `retrieval.hits` artifacts and `retrieval.returned` edges. Retrieval recipes open a parent `retrieval.recipe` span, and each query/retrieve/hit step opens a `retrieval.step` child span with bounded recipe-step metadata. Devtools, the TUI, subscribers, diagnostics-channel listeners, and OTel all read from the same graph records; payload capture is controlled centrally by `observability.recordInputs` / `observability.recordOutputs`.

Prompt composition uses a generic `use` contract. Plain contexts still contribute system text, but richer primitives and custom contributors can inject context, tools, constraints, guardrails, and metadata in one resolution pass. `context.contribution` artifacts include the specific `injectedTools` names contributed by that context when tools are present, including contexts whose text is later dropped by a token budget. Direct tool producers such as contributors, retrievers/grounding, memory, and blackboards also emit tool-only `context.contribution` previews with their source kind, so backend read models can join request tools back to the primitive that supplied them without parsing tool names. Runtime prompt input validation is represented separately by redacted `prompt.input` previews, allowing local read models to compare observed input keys with effective prompt schemas without storing raw values. `context({ use })` nests the same composition model, so product teams can build reusable contexts that bundle retrieval, grounding, memory, and coordination state without forcing prompt authors to call `asContext()` or `asTools()` manually.

Retrievers and retrieval recipes are composable `use` entries. `use: [retriever]`, a recipe's `asRetriever()`, or `grounding()` makes retrieval context and/or tools available according to the configured surface. Raw retrieval injection never enforces answer citations. Citation and provenance guarantees live in `grounding()`, which wraps a retriever or recipe, injects retrieved evidence, and contributes a citation constraint bound to the exact allowed hits for that generation.

Citation validation is exposed as pure APIs (`resolveCitations()`, `renderCitationContext()`) plus `citationConstraint()` for the generation retry loop. Structured citations are canonical. `resolveCitations()` owns the canonical `citation.check` span and bounded `citation.report` artifact, so citation validity, missing/ambiguous hits, quote failures, optional output-text anchors, and valid/invalid counts are inspectable without UI-specific citation parsing.

TypeScript inference is treated as an architecture constraint, not a best-effort convenience. `@use-crux/core` owns a package-local `typecheck` task with strict `tsc`, compile-time API tests in `__type_tests__/`, and an AST-based explicit-`any` check. The explicit-`any` checker has a tracked legacy baseline so new production `any` usage cannot enter unnoticed; hardening work should shrink that baseline instead of adding broad assertions.

Workspace observability is centralized in the workspace `instrument()` helper. Public calls and workspace tools share the same `workspace.operation` spans, namespace hashing, and bounded result artifacts. The Go backend exposes these through the `workspace` resource activity projection, including linked artifacts and edges, so devtools/TUI readers do not need a workspace-specific tracing protocol.

Plan/task observability is owned by the mutation functions that persist state. `plan()` emits `plan.operation` spans with JSON artifacts containing the plan id, title, version, content, content preview, and metadata; task-ledger mutations emit `task.operation`. The Go backend exposes these through the `plan` and `task` resource activity projections and builds the Plans & Tasks read model from those artifacts, so runtime stores behind Convex/serverless boundaries do not need a separate direct enumeration path. Read helpers stay cheap and do not create spans unless a caller wraps them.

Skill loading emits `skill.load` spans from both `fileSkill()` and `resolveRegistrySkill()`, including parse/reference metadata, cache-hit/fetch source, instruction sizes, and bounded previews.

Security warnings remain advisory. Prompt resolution still logs configured warnings, and now emits `security.warning` spans with prompt id, field, pattern, and bounded preview. These spans should be rendered as dev diagnostics, not runtime failures.

`@use-crux/ingest` normalizes external sources into structured `IngestDocument` values. `parts` is the canonical parse output for text blocks, pages, tables, sheets, and JSON paths; `content` is derived from those parts for the current chunking and retrieval pipeline. This preserves document structure without forcing the indexer or retriever to understand every parser-specific detail.

Loaders expose two read modes. `load()` yields `{ ok: true, document } | { ok: false, ... }` so corpus sync can continue across source-level failures and write failed source records. `documents()` yields plain documents and throws on failure for tests, scripts, and fail-fast jobs.

`corpus()` sits next to `indexer()` because it is still write-side retrieval infrastructure. The indexer knows how to prepare and write chunks for a single operation. The corpus owns the source ledger around repeated operations: content hashes, metadata hashes, index-pipeline fingerprints, source status, stale-source policy, and dry-run planning. This keeps incremental sync explicit without pushing loader state into `@use-crux/ingest` or query semantics into `@use-crux/core/retrieval`.

In `appendOnly` mode, an index-fingerprint-only change is intentionally reported
and skipped without updating the source ledger. The same source remains
`indexChanged` on later syncs until a non-append-only sync accepts the new index
identity.

Corpus and indexing observability write the canonical graph directly. `indexer().chunk()`, `indexer().indexDocuments()`, and `indexer().indexChunks()` open `indexing.pipeline` spans; document transforms, chunkers, chunk transforms, and source-bundle embedding stages open child `indexing.pipeline` spans and attach bounded `indexing.report` artifacts with cache status, hashes, counts, and timings. `corpus().sync()` opens `corpus.sync`, records loader results as `ingest.parse` with `ingest.report`, nests indexing work below the corpus span, and attaches a `corpus.report` source-ledger summary artifact. Parser execution opens `ingest.parse` spans with parser name, format, byte length, part count, warning count, and error status; devtools, subscribers, and `@use-crux/otel` consume those records from the same spine.

## Durable Runtime Engine

The durable Runtime Engine lives under `runtime/` and is provider-agnostic. Public users compose it through `@use-crux/core/runtime` (`node()`, `serverless()`, `createRuntimeHandler()`, `durableTask()`, diagnostics, wake envelopes, and adapter conformance helpers). Provider packages such as `@use-crux/postgres`, `@use-crux/upstash`, and `@use-crux/convex` depend on this surface; core never imports those adapters. The Runtime Engine and store-adapter contract are stable beta while Crux remains pre-1.0.

`runtime/composers/namespace.ts` is the pure serverless namespace-resolution boundary. It resolves explicit configuration, a non-empty environment namespace, supported Vercel deployment signals, and the non-production local fallback in that order; ambiguous production composition raises `NAMESPACE_AMBIGUOUS`. Serverless definitions carry the optional `namespaceSource` provenance field so setup and preflight tooling can warn about the legitimate local fallback without treating development as failing setup.

Correctness is centralized in the kernel modules under `runtime/engine/`: task enqueue, suspension/event delivery, timer firing, retry/dead-letter policy, operator retry, cancellation, outbox dispatch, idempotency keys, and wake execution. Stores implement narrow ports only (`state`, `events`, `waiters`, `timers`, `outbox`, `leases`, idle counters, and `transact()`); adapters must not duplicate policy decisions such as retry timing, waiter timeout behavior, or terminal-state handling.

Kernel-owned multi-write commits are named composites in `runtime/engine/composites.ts`. The default runner wraps each composite body in `RuntimeStoreAdapter.transact()`. Substrate-native adapters may override `RuntimeStoreAdapter.runComposite(kind, input)` when their atomic boundary must live outside the normal process, as Convex does by invoking one component mutation that imports the shared core composite body registry. Composite names are part of the adapter contract, but the policy and state-machine code stay in core.

Convex component source filenames must also satisfy Convex's module path grammar: path segments use only alphanumeric characters, underscores, and periods. The Convex adapter conformance suite scans the Runtime Engine component directory to prevent an invalid module name from reaching codegen or deployment.

Flow replay remains in `flow/` and bridges to the Runtime Engine through explicit snapshot conversion helpers. Object-bound flows are a permanent baseline mode; runtime-backed execution persists snapshots, pending suspends, delivered suspend payloads, and scheduled effects through the same replay model instead of introducing a second flow interpreter. When an event wins a waiter race, the kernel copies that event payload into the snapshot's delivered-suspend record; replay reads the snapshot only, so event-log retention cannot break an already-delivered flow resume.

Retention is kernel-owned and adapter-proven. Composers carry `RuntimeRetentionConfig` into the resolved engine; maintenance computes per-class cutoffs from injected time and calls bounded store prune methods for events, terminal work, terminal snapshots, confirmed outbox rows, idempotency keys, settled timers, and settled waiters. Store adapters stamp `settled_at`/`confirmed_at` internally where a record type had no settled timestamp, and conformance tests require terminal-only pruning, limit obedience, and truncation reporting. The in-memory, Postgres, and Convex runtime stores implement the same contract; there is no Upstash RuntimeStoreAdapter in this checkout.

Outbox dispatch is bounded and defaults to eight in-flight deliveries per pass. Outbox row ordering is not a cross-row correctness contract. Store adapters expose `outbox.listByWork(workId, { namespace?, state?, limit? })` so orphan-work recovery can check targeted pending wake rows without namespace-wide scans; Postgres and Convex persist `workId` on outbox rows for that index.

Lease ownership is a kernel-level fencing contract. `handleWake()` claims a store lease, records the token on the leased work row, heartbeats that lease while target code runs when the host supports timers, and re-checks the same token inside every finalizing commit transaction. If maintenance has reclaimed the work or another worker has re-leased it, completion, suspension, retry, and failure commits abort with `LEASE_LOST`; the stale executor acknowledges the wake without consuming attempts or overwriting the current owner. Timerless host bindings pass `leaseExtension: false` and rely on fencing plus an appropriately sized `leaseTtlMs`; Convex does this for both isolate handlers and Node actions. Store adapters only implement `leases.claim/extend/release` and transactional state reads/writes.

Generated and hand-written wake entries meet the kernel through `createRuntimeHandler({ targets })`, which normalizes exported flow/task targets, verifies HTTP wake requests before envelope decode, and returns fetch-compatible `GET`/`POST` handlers. Host-bound adapters such as Convex use `bindHostRuntime()` to supply request-scoped store, wake, and host-safe lease-extension settings while still delegating to `createRuntime()` and the same kernel path.

App-level runtime tests use `createTestRuntime()` from `runtime/testing`. The harness normalizes the same target arrays accepted by `createRuntimeHandler()`, installs a temporary hook layer with an in-memory runtime definition, and drives `reviewFlow.run()` through the production object-bound flow path. Its controllable clock rides on the runtime definition (`now` and `newWorkId`), and `createRuntime()` inherits those hooks for every resolved instance. Runtime-backed flow deadline math reads the resolved engine clock, so `flow.after()` and suspend timeouts remain deterministic without a separate test-only interpreter.

Public Runtime Engine failures cross package boundaries only as `CruxRuntimeError` diagnostics. The current code set is `RUNTIME_REQUIRED`, `CAPABILITY_MISSING`, `TARGET_NOT_FOUND`, `TARGET_DUPLICATE`, `TARGET_NOT_EXPORTED`, `REPLAY_DIVERGED`, `ARTIFACTS_STALE`, `WAKE_UNVERIFIED`, `PUBLIC_URL_UNRESOLVED`, `SETUP_REQUIRED`, `PAYLOAD_NOT_JSON`, `WORK_DEAD_LETTERED`, `LEASE_LOST`, `NAMESPACE_AMBIGUOUS`, and `RUNTIME_HOST_ONLY`; raw adapter errors stay as causes.

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

All global hooks live in the `CruxHooks` object (`runtime/runtime.ts`). Use `setHooks()` to install atomically, `getHooks()` to read:

| Hook                       | Scope          | Hooks field                         | Purpose                                               |
| -------------------------- | -------------- | ----------------------------------- | ----------------------------------------------------- |
| `PromptMiddleware`         | All prompts    | `hooks.middleware`                  | Wrap every generate/stream call                       |
| `ResolveHook`              | Agent adapter  | `hooks.resolveHook`                 | Observe `.resolve()` calls without generation         |
| `ExecutionHook`            | Agent adapter  | `hooks.executionHook`               | Observe model calls from agent frameworks             |
| `StreamProgressHook`       | Streaming      | `hooks.streamProgressHook`          | Live streaming metrics (TTFT, chunks)                 |
| `StreamStartHook`          | Streaming      | `hooks.streamStartHook`             | Eager hook before first chunk                         |
| `graph-record subscribers` | All primitives | `hooks.observability subscribers`   | Observe memory, compaction, scoring, agent operations |
| `onPrepare`                | Single prompt  | `prompt({ hooks: { onPrepare } })`  | After system assembly, before generation              |
| `onGenerate`               | Single prompt  | `prompt({ hooks: { onGenerate } })` | After successful generation                           |
| `onError`                  | Single prompt  | `prompt({ hooks: { onError } })`    | After failed generation                               |

### Plugin System (`runtime/plugin.ts`)

The plugin system enables composable hook installation. Three key functions:

| Function                             | Purpose                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `mergeHooks(base, patch)`            | Compose two hook states: fan-out for hooks, layered chaining for middleware, last-write-wins for observability transport |
| `applyPlugins(plugins, initial)`     | Process plugins in order, each seeing cumulative state. Returns merged hooks + dispose                                   |
| `withDevtools()` / `withTelemetry()` | Built-in plugins returning `CruxPluginResult`                                                                            |

**Fan-out semantics**: When two plugins install the same hook (e.g., `tool.call start records`), both handlers are called for every event. Neither can suppress the other.

`withTelemetry()` adds an extra process-level guard because duplicate OTel subscribers create duplicate exported span trees. A second active install warns once and returns a no-op dispose handle; disposing the active install clears the guard. The OTel span managers also cap open registries and force-end evicted spans with `crux.expired: true`.

**Layered middleware**: When two plugins install middleware, the later plugin wraps the earlier one. Calling `next()` in the outer middleware invokes the inner middleware.

**Plugin processing in `config()`**:

1. `config()` creates a runtime config transaction and exits early in `CRUX_INDEX=1` mode.
2. The planner resolves config-owned runtime state: standard storage bundle, explicit observability
   ownership, capture policy, generation middleware, tokenizer, and plugin order.
3. If the `observability` domain owns the transport (`enabled: false`, custom `transport`, or
   `serverUrl`), user plugins install after those hook fields so plugins see the owned
   transport/store state.
4. If observability does not own the transport, the planner prepends `withDevtools()` for explicit
   `devtools.serverUrl`, then appends user plugins so local devtools instrumentation installs before
   custom plugins.
5. The installer computes the final runtime once and installs the changed fields as one hook layer.
   Re-running `config()` restores the previous active layer first, so hot reload leaves one live
   middleware/hook chain.
6. Runtime Bridge disposal runs before registry disposal. Config restore removes its hook layer,
   then plugin `dispose()` functions run before config-owned observability restore.

### Chaining (Legacy)

The plugin system supersedes the previous manual chaining approach. `withDevtools()` now returns a `CruxPlugin` with hooks in `CruxPluginResult`. `enableDevtools()` remains for imperative use but delegates to the shared `buildDevtoolsRuntime()` function internally.

### Instrumentation Standard

Detailed tracing uses canonical `@use-crux/core/observability` graph records emitted through
`observe.*` / `emit()`. Runtime integrations must not introduce ad hoc collectors or reporters at
primitive call sites. `emit()` is the event spine: records are sanitized, validated fail-open,
coerced when the contract defines a safe fallback, and then delivered to in-process subscribers,
the Node diagnostics channel, and the async devtools transport from the same graph record. Invalid
records are dropped with diagnostics instead of throwing into user code.
Generation and streaming spans also carry `gen.*` performance metrics on terminal span records.
`observability.recordInputs` / `observability.recordOutputs` accepts `inline`, `reference`, or `off`
capture modes for input/output payloads, and the emit pipeline applies that policy before every
consumer sees the record. Disabled directions strip payload-bearing span/event attributes such as
`text`, `query`, `messages`, `output`, `body`, and `filter`; `redactRecord()` can replace or drop the
post-policy record and failures drop the record fail-closed.

The delivery engine is created by `createDeliveryEngine()` and keeps transport state behind a
functional closure. It starts live delivery immediately, bounds in-flight sends and queued records,
drops the oldest queued records when `maxQueuedRecords` is exceeded, counts discarded records in
`observabilityDiagnostics().droppedRecords`, and records transport failures without throwing into
the code that emitted the records.

When `AsyncLocalStorage` is unavailable, the runtime degrades to a synchronous `withContext()` frame
instead of disabling observability outright. Run lifecycles and synchronous nested spans still emit
balanced graphs; contextless events, artifacts, and edges are skipped and counted in
`observabilityDiagnostics().contextlessRecords` with a development warning.

**Event flow for integrations:**

```
Primitive (generation, tools, memory, swarm, flow, etc.)
    → observe.* → emit(record)
      → subscribeObservability() consumers such as @use-crux/otel
      → node:diagnostics_channel consumers
      → configured observability transport for devtools
```

Devtools tracing itself uses the canonical `@use-crux/core/observability` graph runtime. Built-in primitives write `run:start`, `span:start`, `span:event`, `artifact`, `edge`, `span:end`, and `run:end` records; the Go backend validates and persists those records, builds read models, and pushes subscription updates to the web UI and TUI.

The Eval coordinator loads the project's own `@use-crux/core` instance. When the Go CLI has
found a loopback devtools server, it passes `CRUX_DEVTOOLS_URL` into that worker; the worker installs
`createHttpObservabilityTransport({ serverUrl })` only if the project has not already configured an
observability transport, then calls `observe.flush()` before exit. Tunneled/cloud runtimes should
use the persistent per-project `CRUX_DEVTOOLS_TOKEN` bearer token, which the local server accepts
only on `POST /api/observability/records`. Flush failures are swallowed at this local auto-attach
boundary so a dead devtools server or tunnel cannot change the Eval result. This keeps Eval cell run
references and the canonical `/api/observability/runs/{runId}` graph in the same backend whenever
Evals execute with devtools attached. Each persisted cell retains immutable Case, Variant, task, and
definition fingerprints so regressions remain attributable without rereading mutable source files.
Every live managed or opaque task attempt also opens one terminal-once `eval.case` observation root,
and executes task work inside its context so generation and Tool spans remain children. Exact timeout
terminals use `cancelled` plus the bounded `evalOutcome`, `timeoutBudget`, `timeoutLimitMs`, and
Tool-only `timeoutToolName` attributes; reused and skipped cells do not fabricate observation runs.
The product-surface projection retains Eval Run V4 and Host V2 and does not advance task/scorer
evidence, Baseline, or judge identity epochs.

**Rules:**

1. Primitives emit canonical graph records once through `observe.*`.
2. Subscribers, diagnostics-channel consumers, and transports only read those records.
3. Transport metadata (sessionId, traceId, timestamp) is added by handlers at call time from the active observability context.
4. The `RuntimeFlowSessionReporter` remains a public API for users who want manual flow reporting with rich metadata.

## Runtime Config Transaction

`config()` remains the only public project configuration API. Internally it delegates lifecycle work
to `runtime/config-transaction/`, a deep module with a pure planner and effectful installer:

- `planRuntimeConfig()` reads only `CruxConfig` plus optional environment data. It decides index
  mode, observability ownership, runtime patches, bridge inputs, tokenizer policy, and ordered
  plugins, including the devtools fallback plugin when applicable.
- `installRuntimeConfigPlan()` takes the plan plus narrow ports for runtime state, observability,
  bridge connection, tokenizer, plugins, diagnostics, and Crux object creation. Tests use fake ports
  to verify ordering without inspecting global state.
- Production ports call the existing domain owners: `pushHooksLayer()` / `restoreHooksLayer()`,
  `configureObservability()`, `createHttpObservabilityTransport()`, `connectRuntimeBridge()`,
  `setTokenizer()`, and `applyPlugins()`.

The transaction boundary owns application and teardown order. `config()` is a one-config-per-process
API: the last call replaces the previous active installation, and multi-tenant/per-request config
scoping is out of scope. The transaction must not duplicate observability protocols, bridge
protocols, plugin merge semantics, or prompt registry construction; those stay in their existing
domains. `configure()` remains available for lower-level prompt registry tests and direct legacy use.

## configure() Internals

`configure(options)` does the following in order:

1. **Extract flat lists** — Walk tree (via `_all` property or recursive traversal) or use arrays directly
2. **Auto-collect contexts** — Deduplicate contexts from prompts' `use` arrays with explicitly passed contexts
3. **Validate** — All prompts must have an `id`, no duplicate IDs allowed
4. **Build indexes** — `byId: Map<string, Prompt>`, `tagIndex: Map<string, Prompt[]>`
5. **Apply registry policy flags** — `autoEscape` and `securityWarnings` stay module-local for
   resolver defaults
6. **Return frozen registry** — `get`, `find`, `list`, `byTag`, `byTags`, `tags`, `dispose`

### Tree Walking

`extractPrompts()` and `extractContexts()` handle three input shapes:

- **Flat array** — Pass through directly
- **Object with `_all`** — Use the pre-computed flat list from `createPrompts()`/`createContexts()`
- **Plain nested object** — Recursively walk, collect leaves where `_tag === 'Prompt'` or `_tag === 'Context'`

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

1. Create the canonical HTTP observability transport — `createHttpObservabilityTransport({ serverUrl, token })`
2. Configure `@use-crux/core/observability` to deliver graph record batches to the Go backend
3. Return `observabilityTransport` + `dispose()` that restores the previous observability runtime

`enableDevtools()` remains for imperative use — delegates to `buildDevtoolsRuntime()` and installs
its own hook layer so config teardown does not clobber imperative devtools hooks.

When `config({ devtools: { serverUrl } })` is used without an explicit `observability` override,
the config planner auto-prepends `withDevtools()` so the local devtools transport is installed before
custom plugins. `devtools` remains the local UI/control/tunnel/bridge domain; production export,
remote collectors, and delivery policy belong under `observability` or telemetry plugins. When the
server URL is a tokenized tunnel URL, the HTTP transport preserves the query token while appending
the observability endpoint path. For cloud/serverless runtimes, `observability.token` or
`CRUX_DEVTOOLS_TOKEN` is preferred because it grants only observability ingest instead of a full
browser devtools session.

### Runtime Bridge (`runtime-bridge/index.ts`)

The Runtime Bridge is the local-dev command plane. It is intentionally separate from the observability and Project Index planes:

- Observability: runtime -> Go through `POST /api/observability/records`.
- Project Index snapshots: runtime -> Go through `POST /api/index/snapshot`.
- Runtime Bridge: Go -> runtime through typed `command.request` messages and `command.result` / `command.error` replies.

`@use-crux/core/runtime-bridge` owns the TypeScript schemas and inferred types for `runtime.hello`, `runtime.heartbeat`, `command.request`, `command.progress`, `command.result`, and `command.error`. `config()` starts a local Node WebSocket peer when `devtools.bridge` resolves to `transport: 'ws'`; the peer advertises derived capabilities, including `store.read` for an explicit `storage.records` store and any inspectable resources registered by primitives. Memory, blackboard, and Thread definitions register those resources as they are created, keeping user DX focused on composing primitives rather than manually wiring devtools stores. Thread resources return payload-safe tree, causal-group, branch-point, and owner-head topology; message content never crosses this inspection contract. The stable runtime-peer command surface is `store.read`; arbitrary runtime evaluation is intentionally outside the bridge command contract. Bridge failures are logged as dev warnings and must never throw into user code. HTTP/framework transports are registered by integration packages such as `@use-crux/convex`; those endpoints derive their public URL from the framework request when possible, advertise request-scoped store capabilities, and convert malformed command bodies into structured `command.error` responses. `crux dev` auto-discovers framework HTTP peers from `CRUX_BRIDGE_URL`, `CONVEX_SITE_URL`, `CONVEX_URL`, or `NEXT_PUBLIC_CONVEX_URL` in the shell or project `.env.local` / `.env`, fetching `/crux/bridge` and registering the manifest-backed peer in Go. Go owns peer selection, command dispatch, subscriptions, and read-model side effects.

Resource Inspection is the product-facing Go service layered above the bridge. Web devtools, the TUI, CLI commands, and future IDE integrations ask Go for capabilities and resources through stable product-shaped calls such as `GET /api/resources/capabilities`, `GET /api/resources/{resourceId}`, and `GET /api/resources/{resourceId}/entries`. The service maps `blackboard:*`, `memory:*`, and `crux.store` requests to bridge `store.read` only when a live peer is available, otherwise it returns structured `unavailable` or `partial` results with reasons such as `bridge_required`, `runtime_unavailable`, `unsupported_resource`, `ambiguous_peer`, or `command_failed`. Clients must not call Convex `/crux/bridge` or construct bridge command envelopes directly. Domain read models can embed this service when that keeps clients simpler: `GET /api/memory/stores/{id}` returns projected memory/blackboard state and an optional `inspection` object. `inspection.status="ok"` plus `source="mixed"` means live entries were joined with the projection; `inspection.status="partial"` plus `source="projection"` means the projection is usable while live runtime inspection is unavailable or failed.

### Canonical Go Backend

The Go devtools backend owns canonical execution graph ingestion, persistence, read models, filtering/search, and subscriptions. RunDetail presentation folds routing spans onto the selected concrete generation even when the canonical graph has `routing.* -> generation.*`; quiet constraint, guardrail, citation, scoring, and security warning spans become safety/details, while governance that changes execution remains a visible node. The live execution graph route is:

```txt
POST /api/observability/records
```

Routes are thin adapters over services: parse body → validate a full ingest batch → call `observability.Service` with accepted records → return service-owned read models. `POST /api/observability/records` returns `202` with `{ accepted, rejected }` for parseable batches, reserves `400` for malformed JSON, and returns `503` plus `Retry-After: 1` for transient SQLite/begin/commit failures so SDK transports retry the whole batch. WebSocket/SSE layers broadcast typed subscription notifications only; they do not interpret raw graph data.

The legacy collector HTTP endpoint has been removed; new code must not post to it.

Local persistence keeps authoritative domains separate. SQLite is the canonical runtime store for
observability history: runs, spans, events, artifacts, edges, metrics, lifecycle reconciliation,
resource activity, and deletion. File-backed databases use WAL, a busy timeout, and a small
connection pool; in-memory test databases remain single-connection.

Eval runs and Baselines, Inspect state, and Review records have focused Local
storage owners under `.crux/evals`. Project Index discovery finds authored Eval
source and generated registries, while Core owns exact evidence identity and
never derives reusable truth from observability history.

Run lists and lifecycle reconciliation use ingest-time count/token/cost rollups plus lightweight
signal aggregation so large histories stay responsive. The lifecycle driver considers only running
runs with no lifecycle status, ignores recent activity, and persists reconciled presentation state.
List endpoints are newest-first and bounded; exact metrics and high-frequency `token.chunk` events
are loaded only for one focused run or span. Retention deletes bounded batches beyond configured age
or count limits and performs incremental SQLite vacuum.

### Deprecated Collector Modules

Tool input schemas in the Project Index may be authored with `input`, `inputSchema`, or `parameters`; all three project to `ProjectDefinition.metadata.inputSchema` and suppress `tool.missing_input_schema`.

Collector-shaped runtime/reporting shims and collector protocol schemas have been removed. New tracing code must use `@use-crux/core/observability` and `POST /api/observability/records`; `withDevtools()` no longer installs collector middleware or reporter hooks. Project definitions use the separate Project Index contract owned by `@use-crux/core/project-index`: `crux dev` indexes source files at startup, runtime prompt/context/tool snapshots enrich the index through `POST /api/index/snapshot`, and the Go service serves the read model through `GET /api/project/index` and migrated `GET /api/index`. Index indexing follows a fast-plus-enriched architecture: the Go-orchestrated Rust/Oxc Static Index pass publishes the first useful index, while bounded semantic analysis enriches proven aliases, barrels, imported symbols, schemas, callbacks, primitive graph relations, and data-access edges in the background through the selected semantic backend. Semantic fact snapshots are cached under `.crux/cache/index/semantic-facts-*` using source/profile closure inputs, config boundaries, semantic compiler options, the selected compiler runtime identity, and the semantic cache epoch. Static parse facts and the Go-owned index snapshot are also versioned under `.crux/cache/index`; when indexer or local-runtime code changes index output for unchanged project source, the matching static, semantic, or Go snapshot cache version must be bumped so rebuild/restart/reindex cannot silently serve stale read-model fields. The cache currently refreshes complete semantic fact sets; true partial semantic reuse remains gated until dependency ownership is materialized. The Go service owns final read-model state, realtime publication, and explicit indexing status; worker failures are published as failed indexing states instead of leaving clients in a cold/loading state. Static source discovery uses a candidate classifier before AST parsing: common output/cache directories are ignored, generated bundles and base64 artifacts are skipped by content signals, oversized authored-looking files emit `index.source_too_large`, and ordinary source must contain Crux-relevant signals before parsing. Static index discovery scans ordinary project source files and can produce partial first-class definitions for prompts, contexts, `createTool()`/`tool()` tools, schema-only tool definitions with `name`/`description`/`parameters`, and richer primitives such as agents, flows and flow steps, compositions, RAG retrievers/pipelines, memory, memory blocks, blackboards, workspaces, constraints, guardrails, and scorers. It indexes exported declarations and factory-local primitive call sites so framework-specific factory functions, including Convex/serverless factories, still contribute authored app graph nodes when ids and object literals are statically visible. Resolved prompt/context/tool definitions carry inspectable JSON schemas in `ProjectDefinition.metadata.inputSchema` and prompt output schemas in `metadata.outputSchema`, and partial static definitions carry best-effort schemas for common inline Zod expressions. Authored grouping from `createPrompts()`, `createContexts()`, and runtime snapshots is canonical on `ProjectDefinition.path`; file-tree grouping is canonical on `ProjectDefinition.source.file`, with source dependency/dependent edges when known. Supporting source locations such as schema declarations, nested schema declarations, callback functions, prompt/context system constants, direct constants and conservative object-property constants injected into static system templates, Convex Agent config/callback bindings for `prompt`, `tools`, `contextHandler`, and `prepare`, Convex Agent tool-map contributors, handler/prepare-factory arguments, and helper functions are canonical on `ProjectDefinition.sourceRefs`; the Go service preserves them during runtime index merges, and UI clients render them directly instead of reconstructing them from snippets. The resolver supports same-file and direct-import schema/callback identifiers for agents, tools, prompts, contexts, safety definitions, scorers, and flow steps; imported prompt `use` context targets and local context-array constants; same-file prompt/context system constants; direct identifiers and simple object-property paths inside static system template interpolations; and Convex Agent `prompt`, `tools`, `contextHandler`, `usageHandler`, and `prepare` bindings. Agent, prompt, context, tool, Convex Agent callback bindings, and flow-step callbacks are scanned through one statically visible helper level for source refs and data-access intelligence. The bounded semantic pass adds compiler-resolved aliases, barrels, imported schemas, callbacks, source refs, and access facts where the selected semantic backend can prove them, while full language-service-grade partial incremental reuse remains future work. Definitions expose `metadata.runtimeJoin` when stable runtime span/resource join attributes can be derived, and `metadata.intelligence` when the indexer has source-backed primitive structure. Runtime joins are typed as `ProjectRuntimeJoin` in `@use-crux/core/project-index` and are authored-to-runtime hints only: `definitionId` is the index id, `spanAttributes` contains stable runtime-emitted attributes, and execution-only fields such as flow `flowId` and generated `stepId` are correlation attributes rather than authored identity. Flow definitions join `flow.run` spans by primitive plus span name; flow-step definitions join `flow.step` spans by primitive plus `stepLabel`/span name; memory blocks join by `sourceDefinitionId`, `blockDefinitionId`, runtime `memoryId`, and `blockId`; blackboards join through memory-shaped spans with `memoryType: "blackboard"` instead of a separate `blackboardId`. The intelligence contract is additive and confidence-scored: agents expose visible prompt/tool/handoff dependency intelligence plus visible memory/blackboard/workspace read/write access, normal `flow()` definitions expose immediate ordered control metadata, Convex `flow({ args, handler })` definitions expose validator-derived args schemas plus visible suspension points, tools and flow steps expose visible memory/blackboard/workspace read/write access through `metadata.intelligence.data` and graph relations, literal `parallel()`, `pipeline()`, `consensus()`, and `swarm()` calls expose children, participants, coordinators, pipeline prompt/tool stages, consensus judge/scorer links, and swarm shared memory/blackboard relations through backend-owned definitions such as `composition.parallel.branch` and `composition.pipeline.stage`, literal retrieval pipeline stages expose `rag.pipeline.stage` definitions plus retriever/scorer relations, and workspaces/safety/evals expose literal tool, mount, applies-to, and coverage relations. Index snapshots also expose `lintFindings`, a backend-owned authored-graph lint read model separate from diagnostics. Diagnostics explain indexer health/fidelity; lint findings are actionable design observations over definitions, relations, such as missing Eval coverage, prompt/context/tool/flow contract gaps, strict-mode prompt output gaps, strict-mode tool model-output gaps, agent handoffs to non-visible targets, suspending flows without coverage, writable workspaces without guardrails, state resources written without visible read paths, long-lived memory without visible retention policies, consensus compositions without visible judges or scorers, and shared blackboards without conflict policies. Lint findings are registry-backed, include category, maturity, confidence, default profile membership, concrete messages, per-rule rationale, optional impact, structured evidence, fix options, docs URLs and exact suppression directives, support rule-specific source suppressions, and carry backend-computed propagation metadata for approved dependency paths so clients do not walk the graph themselves. `crux.config.ts` may provide `lint.profile` and project-wide `lint.rules` overrides; the TypeScript indexer is the single importer of that config and serializes the resulting policy onto `ProjectIndexSnapshot.lint`. Go read-model enrichers consume that serialized policy after appending local runtime-backed findings, so TS-produced and Go-produced findings share profile, rule override, and source-suppression semantics before the index is exposed. Unknown configured rule ids become index diagnostics. `crux lint` is a thin CLI presentation over the same Go-owned index service: it is non-blocking by default, supports JSON output and profile selection, and only exits nonzero when an explicit `--fail-on=error|warning|info` threshold is requested. Resource activity views for memory, workspace, plan, and task read `GET /api/observability/resources/{family}` from the Go service.

Semantic indexing is backend-neutral. The default semantic backend uses the JavaScript TypeScript compiler API, while `experimental.indexer.native: true | { engine?: 'tsgo'; tsserverPath?: string }` selects the native TypeScript-Go backend. Static Index always uses the local Go runtime's Rust/Oxc compiler and is independent of semantic backend selection. Both semantic backends emit the same Crux semantic evidence batches and are projected through the same Project Index service path; extensions see Crux facts and manifests, not raw TypeScript or TypeScript-Go compiler objects. When native semantic indexing is selected, TypeScript-Go owns semantic project setup, checker calls, declaration lookup, and AST traversal. Native direct projectors are optimizations for proven source shapes, currently including high-volume prompt/context/tool source refs, context dependencies, agent prompt/tool/model-routing/callback config refs, literal agent handoff relations, and local routing child/target facts; complex shapes stay inside the native backend through its shared analyzer path rather than falling back to the JavaScript TypeScript semantic backend. Semantic cache identity includes backend identity, source-closure/profile inputs, semantic compiler-option identity, selected compiler runtime identity, and the cache epoch; current semantic fact cache writes use the binary local envelope after the `semantic-facts-v17` hard migration.

Index child/supporting records stay first-class definitions for search, lints, relations, runtime joins, and direct inspection, but they carry `ProjectDefinition.metadata.indexPresentation` with `standalone: false`, parent definition id, parent relation type, role, and order when clients should fold them under an authored parent. Current folded child families include flow steps, routing routes/tiers/options, composition branches/stages, RAG stages, memory blocks, and memory stores.

The Project Index facts contract is typed but extension-friendly. Known Crux facts belong in stable buckets on `ProjectDefinition.metadata`: direct schemas (`argsSchema`, `inputSchema`, `outputSchema`, `configSchema`, `schema`), `runtimeJoin`, and `intelligence`. `intelligence.contract` carries normalized schema/source summaries, `intelligence.control` carries execution structure such as mode, ordering, children, retry/fallback policy, budgets, and suspension points, `intelligence.data` carries visible memory/blackboard/workspace/store/block reads and writes plus artifacts/retrievals, `intelligence.dependencies` carries detail-panel summaries, and `intelligence.runtime` carries authored-to-runtime hints. Canonical graph structure remains in `ProjectIndex.relations`, and concrete source locations remain in `ProjectDefinition.sourceRefs`. Future plugins may use explicit `extensions` bags, but core primitives should prefer typed fields whenever facts can be statically or semantically proven. Web devtools, the TUI, CLI commands, and future IDE surfaces render this backend-owned read model directly instead of parsing source snippets or rebuilding architecture client-side.

`project-index/project-model.ts` defines the separate config-inspection read model. `ResolvedProjectModel` explains root selection, package metadata, config files, source roots, ignored paths, discovered definitions, discovered relations, Eval defaults, and diagnostics with per-field provenance. It deliberately stays a shallow JSON-safe DTO: source/runtime/filesystem/config/CLI provenance is a discriminated union, diagnostics use stable reason codes, and definition/relation/diagnostic ids are branded strings at TypeScript boundaries. Source-only discovery is informational, while selected source-shape findings such as missing stable ids, runtime-dependent tool maps, and tested prompts whose context dependencies are only partially proven are represented as Project Model diagnostics with source provenance. Prompt and context bundle paths from `createPrompts()` and `createContexts()` are projected as first-class definition `path` fields, and source-proven bindings such as `prompt.uses_context` are projected as inferred Project Model relations. The resolver that fills this model belongs to the local/indexer layer: `@use-crux/indexer` exposes `resolveProjectModel(...)`, and `@use-crux/local` renders that shape through `crux config inspect`; core only owns the shared contract. The CLI inspect command deliberately uses the static/source-only worker request so large projects can inspect source-visible state without importing every user module; staged `crux dev` indexing supplies import-enriched and runtime-backed evidence.

`ProjectIndexSnapshot.sourceGraph` is the durable provenance marker for source-row dependency evidence. It records the source graph schema version, producer, and capabilities such as source dependencies, reverse dependents, definition ownership, and diagnostic ownership. Incremental planners must treat snapshots without this marker as old or incomplete and fall back to full reindex instead of trusting `sources` edges optimistically.

Convex-specific index discovery also recognizes `new Agent(...)` from `@use-crux/convex/agent`, direct `convexAgent({...})`, profile-created `crux.convexAgent({...})`, and Convex `flow({ name, args, handler })` definitions, including flow args, statically visible `flow.step()` calls inside the handler, and visible `flow.waitFor()` / `flow.suspend()` suspension signals linked by `flow.step.waits_for_signal`. Memory storage bindings are first-class `memory.store` definitions linked by `memory.uses_store` and `blackboard.uses_store`; memory blocks remain linked by `memory.includes_block`.

Convex Agent source-ref binding support includes `usageHandler` alongside `prompt`, `tools`, `contextHandler`, and `prepare`; all of these remain supporting source refs, not runtime graph edges.

The Go service exposes one normal run inspection read model: `GET /api/observability/runs/{runId}` returns `RunDetail`. Raw canonical graph access is debug-only. The normal detail route does not load raw record payloads or run summary count subqueries before projection; it reads the run graph tables needed for projection and leaves raw records to `GET /api/observability/runs/{runId}/graph`. `RunDetail` is the default human trace view for web devtools and the Go TUI: spans are classified into visible Primary Operations, Transition Operations, Suspension Markers, and folded details; every canonical span has a `spanIndex` placement; every visible node and folded detail exposes `source` metadata so clients can show the presentation parent without losing the canonical parent; details attach through semantic ownership before chronology; delegate and handoff rows sit beside their source/target operations instead of creating visual containment. Model-emitted tool intents are `tool.request` artifacts on the generation; user-code tool executions remain `tool.call` spans and may present as agent-timeline siblings linked by tool call id. When a tool execution is promoted out of a Convex Agent generation container, relation-aware ordering keeps the generating turn before the tool even if cross-action timestamps are equal, delayed, or noisy. Flow suspensions are `flow.suspension` operations presented as flow-level timeline markers, not as stuck generations or open steps. Completion-only spans with no start metadata are retained as details instead of becoming anonymous trace rows. Custom spans can override classification with `attributes.presentation.display = "primary" | "detail" | "metadata"` and can hint ownership with `attributes.presentation.ownerSpanId`.

RunDetail also owns presentation-only lifecycle reconciliation, status rollups, aggregate metric rollups, and curated inspection sections. Canonical graph records remain append-only and lossless, but the read model can make truthful state derived from reliable signals: Convex boundary acknowledgements can close missing parent-side runtime boundary ends, expired Convex boundary leases can mark abandoned action/schedule boundaries stale, and expired `operation.deadline` events can mark a missing generation/stream end plus its still-open ancestors as incomplete observability. Execution-changing governance rolls ancestors up to `blocked`, intentional flow waits roll ancestors up to `suspended`, and subtree token/cost/count metrics roll up through every visible branch. Curated node inspection groups canonical records into tools, retrieval, memory, context, safety, scores, citations, events, diagnostics, metrics, and raw sections while preserving every accepted raw record. While a future deadline is still active, or while a long-running stream keeps advancing `last_activity_at`, the read model does not prematurely mark that branch stale. Deadline reconciliation is a telemetry diagnostic, not an application error. The Go service runs a lightweight lifecycle ticker and publishes `observability.lifecycle` notifications when a running run changes presentation state; completed runs do not enter the lifecycle driver and remain presentation-reconciled on exact inspection.

The TypeScript DTO for that projection lives in `@use-crux/core/observability` as the Run Detail contract; the Go service and devtools UI mirror that contract without code generation.

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

1. **Boundary primitives open an observed span for the lifetime of their body.** Implemented via `observe.span(...)` from `@use-crux/core/observability`:

   ```ts
   import { observe } from '@use-crux/core/observability'

   return observe.span({
     name: 'delegate',
     primitive: 'delegate.invoke',
     attributes: { delegateId },
   }, async () => {
     const result = await execute(...)
     return result
   })
   ```

   `observe.span()` emits the canonical `span:start` and `span:end` records, pushes the span id onto the active observability context, and records errors automatically. Built-in primitives for generation, prompt resolution, tools, memory, retrieval, indexing, compaction, scoring, plans/tasks, routing, agents, flows, compositions, handoffs, and delegates follow this pattern. Manual `observe.openSpan()` users must close every terminal path with `end()` or `error()`; streaming generation spans additionally close when the raw stream iterator completes or errors, even if usage metadata is read later. Detail-only spans can set `implicitRun: false` so they attach to an existing run when present but never become the visible root run by themselves; routing resolution uses this because `router.resolve` explains model choice rather than the user's initiating work.

2. **The observability runtime captures the current parent span on `span:start`.** Every new span records the deepest-open span at the moment it began. In-process, this is automatic via AsyncLocalStorage. The captured value lands on the canonical `parentSpanId` field.

3. **Transport helpers pack captured observability context across async-context boundaries.** `AsyncLocalStorage` doesn't survive Convex `ctx.runAction()`, edge-worker fetch, or HTTP. Cross-boundary transports must explicitly pack the captured context into the call payload, and the receiving side must call `observe.withContext(...)` before invoking any SDK code. Convex code uses `@use-crux/convex/server` `action()` / `internalAction()` / `query()` / `mutation()` wrappers plus `ctx.crux.runAction()` for awaited child work. `ctx.crux.scheduler.runAfter()` records an enqueue boundary but detaches by default; scheduled work starts its own semantic run unless the caller explicitly passes `{ observability }` for a durable continuation such as a flow resume. These helpers restore context on the receiving side when present, flush the active boundary span before crossing into child workers, emit a boundary lease, and flush bounded action deliveries before the worker exits. Do not use `flow()` as a generic tracing wrapper for external framework agent turns; a Convex Agent chat response is an `agent.run` root/span, while `flow.run` is reserved for actual Crux flow handles. Convex Agent integrations import `Agent`, `createTool`, or `wrapConvexTool(tool, { name })` from `@use-crux/convex/agent` so prompt/use[] resolution, memory, retrieval, generation streams, and tools nest under the agent turn; handlers receive `ctx.crux`; result and step usage/cost shapes are normalized for run-level rollups; and the backend receives both `toolName` and `toolCallId`.

   Other runtimes (Cloudflare Workers, AWS Lambda, etc.) implement the same pattern with their own packing/unpacking. The contract is universal; only the transport vehicle changes.

`execution-context.ts` is intentionally separate from observability. It carries session, flow, parent-flow, and step metadata needed while code executes. It does not carry a span stack, create span ids, or determine graph parenting; `@use-crux/core/observability` owns all run/span relationships.

### Index Injection Intelligence

Prompt/context injection intelligence is represented as ordinary Project Index facts, not as a separate compiler path. The Crux Indexer emits first-party contributor-family definitions serialized under the legacy `injectable` taxonomy value, attributed `useEntries`, context/injectable tool contribution facts, safety/metadata contribution facts, and relations such as `prompt.uses_injectable`, `context.uses_context`, `context.uses_tool`, `context.uses_memory`, `context.uses_blackboard`, `injectable.uses_context`, and `injectable.uses_tool`. The taxonomy name is retained for cross-runtime persisted contracts; the stable authoring API for custom contributions is `contributor()`. The static pass only records authored possibilities from source-local shapes such as plain refs, local arrays/spreads, `when(...)`, `match(...)`, guarded refs, simple context `tools` objects, and simple `inject()` return objects. The semantic pass can upgrade imported contributor-family definitions, imported injectable input schemas and callback source refs, import-safe prompt/context/injectable `use` arrays with spreads, resolved `useEntries` for imported/spread arrays and helper-shaped conditional entries, condition-specific source refs for `when(...)`, `match(...)`, and guarded `&&` expressions, imported/spread tool maps, simple injectable `inject` functions that return tool maps, and returned constraints/guardrails/metadata keys into resolved Project Index facts. Computed semantic use/tool shapes are preserved as dynamic or partial facts, including dynamic `useEntries` and `tools` facts that keep resolved names while marking unresolved pieces with `dynamic: true`. Exact activation, dynamic tool sets, and dynamic metadata remain runtime observability/inspection concerns.

The indexer projects a shared injection read model over merged definitions and relations. It keeps authored `inputSchema` separate from derived `expandedInputSchema`, records field-level `inputContributions` with source definition, path, conditionality, and branch metadata, and re-runs this projection in the TypeScript patch state after patch merges. Built-in Project Index lints consume the same read model to surface hidden required prompt input, conflicting injected field schemas, branch-specific required input, runtime-dependent injection dependencies, and dynamic injected tool surfaces.

### Serializers (`index/serializers.ts`)

- **`zodToJson(schema)`** — Converts Zod schemas to JSON Schema. Uses Zod v4's built-in `.toJSONSchema()` first, falls back to manual extraction from Zod internals.
- **`serializePrompt(prompt, path?)`** — Extracts: id, description, tags, inputSchema, outputSchema, contextIds, hasOutput, settings, path
- **`serializeContext(context, path?, usedBy?)`** — Extracts: id, description, priority, inputSchema, isStatic, usedBy, path
- **`serializeIndex(prompts, contexts, paths?)`** — Deduplicates contexts (from explicit list + prompts' `use` arrays), serializes everything, applies namespace paths
- **Project indexer memory metadata** — Static discovery projects `memory()` and `blackboard()` source locations, store bindings, blackboard schemas, and first-class `memory.block` definitions for visible `workingState()`, `episodes()`, `facts()`, `procedures()`, and `reflections()` blocks when those values are authored as literals or local identifiers. Runtime memory spans carry source definition ids and schema metadata so Go read models can join observed operations back to index definitions without UI-side inference. Memory block runtime joins use `sourceDefinitionId`, `blockDefinitionId`, runtime `memoryId`, and `blockId`; blackboard joins use the memory span shape plus `memoryType: "blackboard"`.

### Removed Legacy Protocol

The old collector protocol has been removed from `@use-crux/core`. New tracing uses `@use-crux/core/observability` records and the Go backend validates batches at `POST /api/observability/records`. Non-execution index data uses `@use-crux/core/project-index` contracts and `/api/index/snapshot` instead of being disguised as spans.

### graph-record subscribers

`graph-record subscribers` is a global singleton (same pattern as `PromptMiddleware`) with optional callbacks for all instrumented operations:

```ts
interface graph-record subscribers {
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
  tool.call start records?: (event: { toolCallId; toolName; args?; traceId? }) => void
  tool.call end records?: (event: {
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
  composition.* span records?: (event: { compositionId; kind; agentIds; status?; error? }) => void
  agent.run span records?: (event: { compositionId; agentId; index; stepLabel; status?; error? }) => void
  composition.report artifacts?: (event: { compositionId; compositionType; status; summary }) => void
  // Flows
  flow.run start records?: (event: { flowId; name; parentFlowId?; goal? }) => void
  flow.run end records?: (event: { flowId; name; status; durationMs; totalSteps; error? }) => void
  flow.step start records?: (event: { flowId; stepId; label }) => void
  flow.step end records?: (event: { flowId; stepId; label; status; durationMs; error? }) => void
  // Flow lifecycle (suspend/resume)
  onFlowSuspend?: (event: { flowId; name; suspendPoint }) => void
  onFlowResume?: (event: { flowId; name }) => void
  onFlowSignal?: (event: { flowId; signalName; payload }) => void
  onFlowCancel?: (event: { flowId; name; reason? }) => void
  onFlowExpired?: (event: { flowId; name; suspendPoint }) => void
}
```

`— zero cost when no hooks are installed. Plugins install hooks via the plugin system;`mergeHooks()` automatically fan-outs multiple handlers for the same hook.

The `evalId` field on `onJudgeResult` enables correlation: callers that run judges inside a larger Eval can pass an id through `JudgeScoreOptions`, and the judge includes it in the hook event so devtools can link individual judge scores back to the run that triggered them. Eval cells do not need it because judge calls made by `scorers.judge()` nest inside the cell's observed run.

Tool execution keeps raw output and model-facing output separate. `execute()` returns the raw application value; optional `toModelOutput()` returns the provider-neutral `ToolModelOutput` fed to the next model step. The core adapter loop records both shapes on `ToolResultEntry`, renders a deterministic string fallback for canonical `Message`, and emits size/savings metadata through instrumentation. It also writes the canonical observability graph directly: model-emitted tool intents attach to the active generation as `tool.request` artifacts; every adapter-managed execution opens a `tool.call` span, consumes a `tool.args` artifact, produces separate raw and model-facing `tool.result` artifacts, and records errors as errored spans. `@use-crux/ai` delegates conversion to the AI SDK's native `toModelOutput` hook and wraps it only for observability.

Native adapters read the structured `modelOutput` stored on tool-result message metadata. Google maps content outputs to function responses with native inline media parts when possible. Anthropic maps text, images, and PDFs to native `tool_result` content blocks when possible. OpenAI Chat Completions only accepts text tool-result content, so non-text parts are represented as deterministic textual references rather than being silently dropped.

Tool middleware is intentionally separate from prompt middleware. `PromptMiddleware` wraps the whole generate/stream operation; `ToolMiddleware` wraps each tool before execution. The final chain is prompt-level middleware first, then call-site middleware, applied after context/prompt/call-site tool merging so hooks see the actual executable tool set — both rules are owned by the `ToolLifecycle` session, not by dialect code. Tool definitions remain policy-free: approval policy is declared with `context({ toolApproval })`, `prompt({ toolApproval })`, or call-site `generate()`/`stream({ toolApproval })`. Exact tool names beat wildcards across layers; within exact or wildcard declarations, call site beats prompt beats context. `approvalMiddleware()` remains the cross-cutting convenience for request/decision callbacks and matcher-based gates without putting policy on tool definitions. After a `LoadSkill` rebuild the session re-arms the tool map, marks newly activated skills injected through the explicit `SkillActivationSession`, and re-notifies against the rebuilt instances.

Approval is return-and-resume, not a blocking await and not flow suspension. On the first request, the adapter returns an approval request in message history. When the core-driven dialect suspends mid-round, sibling tools gated _before_ the approval point have already executed; their results are persisted as tool messages right after the approval-request message, so the model hears about side effects that happened and `resume()` treats them as completed instead of replaying them. The AI SDK adapter maps Crux's resolved approval evaluator to the SDK-owned loop internally; native OpenAI/Google/Anthropic adapters use Crux message metadata exposed through `result.messages`. The client records the id and sends a later `tool-approval-response` via `appendToolApprovalResponse()` or an equivalent message. Native approval requests include an `approvalToken`, and resume treats decisions that do not echo that token as model-visible `approval-invalid` denials — the session's gate checks the history decision and token before evaluating current approval policy, so a forged token never executes the tool even if the later call omits approval policy. On resume, `ToolLifecycle.resume()` notifies `onApproved`/`onDenied` exactly once per approval id, replays approved calls through the same gate→execute→settle pipeline as live calls (full spans/artifacts/hooks in both dialects), and settles denied calls as execution-denied output. Approval request, approval, denial, and token mismatch paths emit `tool.approval` spans, so devtools can explain why a tool ran, did not run, or failed trust validation. This keeps approvals compatible with serverless and Convex actions because no long-lived promise or in-memory modal state is required. Server code must resume from server-issued message history or trusted session storage for mutating tools; approval is a human-in-the-loop execution gate, not a replacement for tool-level authorization.

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
  ├── reflections()     Generated higher-order memory with direct reflection
  └── memoryBlock()     Custom render/tools/capture/approval behavior
```

Storage keys use the composed memory ID, namespace, block ID, and entry ID:

```
memory:{memoryId}:{namespace}:block:{blockId}:{entryId}
memory:{memoryId}:{namespace}:proposal:{proposalId}
```

`namespace` is hashed before being emitted to observability sinks. The raw namespace stays in the store key because stores need deterministic partitioning; devtools and OTel only receive `namespaceHash`.

Built-in block reads and writes emit the canonical observability graph from the shared memory hook path. Reads use `memory.read` spans; block writes, proposals, approval/rejection, clears, deletes, and state updates use `memory.write` spans. Each accepted completed-turn capture coordinates exactly one payload-free `memory.capture` span inside the owning `generation.call` or `generation.stream` Run, with nested block writes as children. Capture acceptance and parent assignment occur before the generation span closes; genuinely retained work may settle afterward without keeping that parent open. The capture lifecycle uses `implicitRun: false`, never creates a standalone Run, and records only the authored memory id, closed lifecycle values, counts, duration, and an optional sanitized machine code—never messages, tool payloads, namespaces, or raw errors. `blackboard()` uses the same memory family for direct reads/writes and focused tools, with `memoryType: "blackboard"` and `memory.snapshot` artifacts for state previews. Reads that return entries also attach `memory.recall` artifacts containing block-kind, key, preview, and score summaries. Writes that know prior and next state attach `memory.diff` artifacts with before/after values plus added/removed block summaries. Memory artifacts connect back to the active span with `memory.read` or `memory.write` edges. This keeps memory hydration nested under prompt/context spans when memory is rendered through `memory().asContext()`, while standalone memory operations still produce implicit runs.

### Storage Contracts

Crux public storage is split by capability:

1. **`RecordStore`** — JSON records with `get`, `put`, `create`, `delete`, `list`, optional TTL, filters, and optional watches.
2. **`VectorStore`** — Dense, sparse, and hybrid vector records with `upsert`, `delete`, and `search`.
3. **`AssetStore`** — Binary and oversized payload storage for workspaces.
4. **`Storage`** — A convenience bundle: `{ records, vectors?, assets? }`.

The in-memory implementations are Map-backed and suitable for testing and single-process development: `inMemoryRecordStore()`, `inMemoryVectorStore()`, `inMemoryAssetStore()`, and `inMemoryStorage()`.

### Working Memory Internals

A thin wrapper around a single block-scoped record key. Schema validation runs on every `set()` and `patch()`.

`patch()` merges via `{ ...existing, ...partial }` then calls `set()` internally, so validation runs on the merged result.

### Episodic Memory Internals

Keys use the standard block prefix plus an auto-generated episode ID. The `record()` method optionally embeds content via the provided `embed` function before storing.

`recall()` has two paths:

- **With embeddings**: Embeds the query, calls `VectorStore.search({ mode: 'dense', dense })`, takes top-N results
- **Without embeddings**: Falls back to `RecordStore.list()` by prefix (recency order)

Both paths respect `filter` for metadata matching.

### Extractive Memory Internals

`facts()` and `procedures()` share the extractive block path. Capture extracts candidates, applies policy, then proposes them by default; `write.mode` can instead be `auto` for immediate writes or `manual`, where capture extracts nothing automatically and writes happen only through direct methods. Direct `add()`, `find()`, `list()`, `delete()`, and `render()` methods use `MemoryRuntimeOptions` with a required `records` store and optional `storage` and `vectors`.

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

### Judges in Evals

`scorers.judge()` in `@use-crux/core/eval` reuses this machinery: it builds an ad-hoc structured prompt over `llmJudge`, bridging an explicit eval-local adapter `generate` binding to the judge's `generateObject` expectation. Rubric mode maps to criteria + a 0–1 scale; `choiceScores` mode supplies a `detailSchema` choice enum and maps the chosen label to its score. Judge calls pin `temperature: 0` and `topP: 1`; runtime output/reference/context are wrapped as untrusted prompt content; and chain-of-thought reasoning is persisted to `Score.metadata.rationale` alongside `Score.metadata.judge` provenance (`model`, prompt version, rubric fingerprint). Judge model resolution starts with the scorer's explicit `model` option, with internal runner setup reserved for programmatic tests and first-party compatibility seams. Managed judges are planner-admitted dependent actions and reuse their own output-keyed evidence independently from task execution.

## Flow Suspend/Resume

### flow and FlowHandle

`flow(name, handler)` returns a frozen `FlowHandle<T, TInput>` that separates flow definition from execution. The handler is captured once; `.run(options?)` can be called repeatedly with different inputs. `.signal(flowId, name, payload?)` delegates to `signalFlow()` for resume. The internal execution engine remains private — `flow` is the public API.

### Mechanism

`flow.suspend(name)` throws a `FlowSuspendedError` to unwind the call stack. The internal executor catches it and persists a `FlowSnapshot` to `RecordStore` at `crux:flow:{flowId}`. No code after `suspend()` executes in the current call.

```
flow.suspend('approval')
  → throw FlowSuspendedError('approval')
    → caught by executor
      → persist snapshot { flowId, status: 'suspended', completedSteps, traceContext, observabilityContext }
        → emit span:end status='suspended'
        → return { status: 'suspended', flowId, suspendedAt }
```

### Resume (skip-replay)

On resume (`handle.resume(flowId)`), the snapshot is loaded from the store. All previously completed steps return their cached output without re-executing:

```text
handle.resume('flow-123')
  → load snapshot from store
    → flow.step('plan', ...) → return cached output (no execution)
    → flow.step('search', ...) → return cached output (no execution)
    → flow.suspend('approval') → check for signal in store
      → signal found → return signal payload, continue execution
      → signal not found → re-suspend (throw FlowSuspendedError)
```

The snapshot stores the parent observability context from the original run. If
resume starts in a fresh worker without active async context, the flow runtime
restores that context before opening the resumed `flow.run` span. Convex
`@use-crux/convex/server` also uses the stored context when `.signal()` schedules
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

`flow.run end records` fires only on terminal states (completed, failed, cancelled, expired). Suspended flows fire `onFlowSuspend` — the flow is paused, not finished. On resume, `onFlowResume` fires before step execution begins. OTel spans end on suspend and start fresh on resume, correlated by `crux.flow.id`.

### Durable composition boundary

`pipeline()`, `parallel()`, `consensus()`, and `swarm()` are immediate compositions: they execute inside the current runtime boundary and either complete or throw. Durable suspend/resume, human approval gates, scheduled work, and serverless/Convex continuation belong in `flow()`, where `flow.step()` owns replay, signals, cancellation, timeout, and persisted observability context.

## Agent Coordination Primitives

### Blackboard

Shared typed scratchpad backed by `RecordStore`. Single store key: `blackboard:{id}`. State is a JSON object matching the Zod schema.

`blackboard()` is an agent coordination primitive, not memory. Memory owns private or persistent recall and post-generation capture. Blackboard owns shared, explicit coordination state between agents, flows, and tools.

**Prompt `use` integration**: a blackboard has `_tag: 'Blackboard'` and is accepted directly in prompt `use`. Resolution expands it into `board.asContext()` and merges focused tools from `board.asTools()` into `resolved.tools`. `board.asContext()` remains context-only for callers that do not want tools. Multiple auto-injected boards must avoid tool-name collisions by setting `tools.prefix`.

**Per-field validation**: `set(field, value)` validates only the written field via `schema.shape[field].parse(value)`, not the full board. This supports partial writes — agents can set individual fields without providing the entire board state. The `.asTools()` method exposes focused Zod-validated tools, so the LLM's tool arguments are validated at the field level before writes.

**Change notification**: After every write, `notify(fieldsChanged)`:

1. Calls in-process subscribers (registered via `subscribe()`)
2. Calls the `onUpdate` callback from config
   `

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

**Stored** — when `records: RecordStore` is configured:

- `send(input)` — calls `prepare()` then persists to `records.put('handoff:${id}', serialized)`
- `receive()` — calls `records.get('handoff:${id}')` and deserializes to `HandoffPayload`
- Enables distributed agents running in separate processes/actions (e.g., Convex, serverless)
- `send()`/`receive()` throw with a clear error if `records` is not configured

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

Internally, all four composition utilities route shared lifecycle through `agent/composition-runtime`: composition id creation, root `composition.*` spans, child `agent.run`/`flow.step` spans, child execution-context labels and session propagation, retry wrapping, duration accounting, and `composition.report` artifacts. Mode files own only their algorithm and public result shaping: fanout/settlement for `parallel`, context accumulation for `pipeline`, voting/quorum for `consensus`, and handoff routing/cost/path handling for `swarm`.

**Agent definition**: `agent()` bundles prompt + optional model + tools + handoffs into a frozen data object. The `handoffs: string[]` field declares peer routing targets for `swarm()` (validated at runtime, not at definition time). Defaults to `[]`. The `AnyAgent` type alias (`Agent<z.ZodType, z.ZodType | undefined, readonly Context<any>[]>`) provides a non-generic handle for collections and runtime checks. `isAgent(value): value is AnyAgent` is the type guard.

**Type utilities**: `InferAgentInput<T>` and `InferAgentOutput<T>` extract the input/output Zod inferred types from an `Agent` instance. `StepName<S>` and `StepOutput<S>` extract name and output types from pipeline step definitions. `AnyPrompt` (from `@use-crux/core`) is the non-generic prompt equivalent.

**Executor interface**: `AgentExecutor(agent, options) → AgentResult`. `ExecuteOptions` includes `maxSteps?: number` for multi-step tool loops. SDK-loop adapters map the neutral budget to their native loop controls, while OpenAI/Anthropic/Google adapters implement manual tool loops.

**Test fake**: `agent/fakes.ts` exports `createFakeAgentExecutor(config?)` — a conformant in-memory executor for testing how compositions drive the executor without an SDK (the agent-layer analogue of `resolver/fakes.ts`). Re-exported from `agent/index.ts` and the package root. `config.agents` maps agent id → behavior (`{ output }` | `{ transfer, reason }` | `{ throws }`, each optionally with `usage`); a behavior may instead be a `(agent, options, callIndex) => behavior` resolver for call-order-dependent fakes; `config.fallback` is a behavior, a resolver, or `'echo'`. It resolves `agent.model ?? options.model`, executes the generated `transfer_to_<id>` tool on a `transfer` behavior, and records every invocation (`agent`, `options`, `resolvedModel`, observed `executionContext`) on `executor.calls` for assertions.

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

**Context summarization:** In `'accumulate'` mode, `summarize: { generate, model, after }` compresses `_previousOutput` via LLM after N handoffs. Uses `GenerateTextFn` from `@use-crux/core`.

### Shared Infrastructure

**Retry utility:** `executeWithRetry()` in `@use-crux/core/retry` — shared by `flow()` steps and immediate compositions. Supports linear/exponential backoff + fallback. It treats Crux policy-terminal errors (`GuardrailBlockedError`, `ConstraintViolationError`, `ValidationExhaustedError`) as non-retryable by default and does not run execution fallback for them, so retries cannot bypass safety, validation, or constraint decisions. Advanced callers can override eligibility with `shouldRetry`.

**Observability context:** All compositions open canonical spans around agent executions. This enables:

- Step-level graphing in devtools (each agent execution is a named span)
- Run grouping and cross-span relationships through canonical ids
- Nested compositions (inner compositions inherit the parent's observability context)

**Composition nesting:** Any composition can run inside any other composition. A pipeline step can run a parallel, a swarm agent can trigger a consensus, etc. Observability context propagates automatically via AsyncLocalStorage in-process and through explicit transport helpers across runtime boundaries.

### Convex Component & Experimental Swarm Integration

The crux Convex component (`@use-crux/convex/convex.config`) provides persistence tables for memory and experimental swarm state. Installed via `app.use(crux)`.

**`createComponentSwarm({ component, generate })`** — experimental swarm routing across action boundaries:

- User provides `generate` function (same as their SDK adapter)
- Component handles transfer tool injection (reuses `buildTransferTools` from `@use-crux/core`), handoff detection via closure, state persistence, and action scheduling
- **`start(ctx, { agents, startAgent, input, resumeAction })`** — creates state, executes first turn, schedules next on handoff
- **`resume(ctx, swarmRunId, { agents, resumeAction })`** — loads state, executes one turn, schedules next
- State stored in component's `swarmRuns` table automatically
- This helper is experimental. The stable launch model is that compositions execute immediately, while durable orchestration uses `flow()`.

**`convexRecordStore({ component, ctx })` / `convexStorage({ component, ctx })`** — storage adapters backed by the component's `memories` table:

- No manual schema or function references needed
- Works with memory blocks, blackboards, plans, workspace metadata, and other `RecordStore` consumers
- Convex storage is records-only; dense recall needs an explicit `VectorStore` such as `upstashVectorStore()`
- `createConvexTransport({ api, useQuery })` uses the same document contract for React reads
- Component `memory.list` owns only `by_key` prefix pagination and returns `{ docs, cursor }`
- Store-document policy owns `_cruxDoc` decoding, TTL cleanup, top-level value filters, vector hit shaping, and filtered-page filling

### Convex Server Boundaries (`@use-crux/convex/server`)

`@use-crux/convex/server` is the first-class Convex runtime boundary. It exports Convex-native `action()`, `internalAction()`, `query()`, and `mutation()` builders that preserve the generated Convex function shape while adding a hidden optional `__crux` argument, `ctx.crux` helpers, context restoration, and bounded action flushes.

**Architecture:**

1. **Action ownership:** Public and internal actions create a Run when no Crux context is already active. Entry actions can set `observabilityName`, `observabilityRootPrimitive`, and `observabilityAttributes` so devtools show the semantic unit (`chat`, `daily-briefing`, `agent.run`) instead of an infrastructure label. Queries and mutations restore incoming context but do not create standalone Runs by default.

2. **`ctx.crux` helper surface:** Handlers receive `ctx.crux.capture()`, `ctx.crux.restore()`, `ctx.crux.span()`, `ctx.crux.flush()`, `ctx.crux.runAction()`, `ctx.crux.runQuery()`, `ctx.crux.runMutation()`, and `ctx.crux.scheduler.runAfter()`. Action helpers emit folded `runtime.convex.*` spans, flush the boundary start record before the child worker runs, and propagate `__crux` to the target function. Scheduler helpers record the enqueue operation and detach by default so later scheduled agents are not parented under an already-ended action; they propagate `__crux` only when the caller passes an explicit observability context. Action and explicit continuation envelopes are two-sided: the parent sends a stable boundary id and the receiving Crux-aware action emits `runtime.convex.boundary.received` plus `runtime.convex.boundary.completed` or `runtime.convex.boundary.failed` span events on the parent boundary span. The Go read model uses those child acknowledgements to reconcile missing parent-side boundary end records without inventing a client-side interpretation layer.

3. **Convex-native flows:** `flow({ name, args, handler })` returns a handle with `.action`, `.handler`, `.args`, and `.signal(...)`. The handler shape stays close to core flow: `(flow, args, ctx)`. `.action` is an internal action definition for start/resume; `.args` and `.handler` let applications build their own public auth wrappers.

4. **Agent integration:** `@use-crux/convex/agent` re-exports a Crux-aware `Agent`, `createTool()`, `createAgent()`, `convexTools()`, and `wrapConvexTool()`. Convex Agent thread generation methods emit an outer `generation.stream` container plus one child `generation.call` span per awaited AI SDK step, so tool-call turns and later text turns are visible as consecutive streamed generation nodes. Direct Convex Agent tools receive `ctx.crux` and emit canonical `tool.call` spans with `tool.args` and `tool.result` artifacts automatically. Streaming generation spans close on the real stream completion path: the Convex Agent finish callback, the returned stream call, or an error. AI SDK step callbacks are recorded as `generation.step` events on the child step span and may recover tool-call detail, emitting `tool.request` on that step generation and completed fallback `tool.call` spans when Convex Agent stops before executing a handler, but they do not close the outer `generation.stream` span because `tool-calls` steps are often intermediate in a multi-step agent loop. Stop-condition tool calls that do not execute a handler, such as UI question tools, are recovered from awaited step callbacks or already-materialized returned stream metadata and recorded as completed `tool.call` spans with `executed: false` when available. Promise-valued returned Convex Agent / AI SDK stream metadata is never awaited by the observability bridge; awaited step/finish callbacks are the source of truth for live stream observability. This prevents late metadata promises from delaying `generation.stream` closure, keeping the outer action running, or creating spans after the action's final flush.

**Plan status as application metadata:** Plan lifecycle (draft→approved→executing→completed) is NOT a crux primitive. Applications model status via `plan.metadata.status`, using `updatePlan({ metadata: { ...plan.metadata, status } })`. The crux `Plan` type stays generic — it stores `title`, `content`, `version`, and an opaque `metadata` record. Version increments only on title/content changes; metadata-only updates (like status transitions) don't bump the version, which enables detecting content edits after approval.

## Adapter Pattern

All adapters follow the same structure. Cross-cutting concerns (prompt resolution, middleware, safety, validation retry, tool lifecycle, routing, hooks, and model-output normalization) are handled by the adapter execution session. Provider packages define `defineSingleTurnProviderBundle()` for raw chat SDKs or `defineProviderRuntime({ ownership: 'loop-owned', loop: { bind } })` for SDK-owned loops. Provider-specific code stays in the runtime spec: request assembly, SDK port binding, transcript conversion/assistant extraction, response metadata normalization, stream delta extraction, settings/schema mapping, and unusual provider dependencies. Headless codecs, `prepare()` handles, and `generate({ transport })` are thin views over those same specs: core-step adapters swap only the provider call port, while the AI SDK adapter swaps its package-local `SdkGateway` seam so `@use-crux/core` remains provider-agnostic.

```
Receive: (prompt, options)
  ↓
Resolve route: resolveModel(model) unwraps router/split/retry/fallback/cascade wrappers
  ↓
Extract model info (provider, modelId)
  ↓
Core calls prompt.resolve(options) → ResolvedPrompt
  ↓
Map to SDK-specific args:
  - system message → SDK's system format
  - output schema → SDK's schema format (zodResponseFormat, JSON Schema, etc.)
  - tools → SDK's tool format
  - settings → SDK's parameter names (temperature, max_tokens, tool_choice/stopWhen, etc.)
  - provider-native exotica → typed adapter `extra`
  ↓
Call SDK function through the provider port/profile
  ↓
Normalize one provider-call step:
  { usage, finishReason, toolCalls, responseId, modelId, cost }
  ↓
Adapter execution handles:
  ├── Apply policy sessions and middleware
  ├── Drive tool rounds or SDK step observation
  ├── Record step facts in result-accumulator.ts
  └── Stamp metadata, memory capture, and observability
  ↓
Return GenerateResult:
  { text, object?, usage?, cost?, steps, finalStep, messages, routing?, pendingApprovals?, raw, _meta }
```

### Adapter Generic Conventions

Each adapter's `generate()` / `stream()` is parameterised as:

```ts
<TOwnInput extends z.ZodType,
 TOutput extends z.ZodType | undefined,
 TContexts extends readonly Context<z.ZodType>[]>
```

`TContexts` is constrained to `Context<z.ZodType>[]` (not `Context<any>[]`), so `MergedInput<TOwnInput, TContexts>` carries each context's input schema through to the `opts.input` parameter — IDE autocomplete on `generate(prompt, { input: { ... } })` surfaces merged context fields without the caller passing explicit type arguments. The matching constraint exists on `createContextHandler()` in `@use-crux/convex`.

Adapter packages share a small set of orchestration helpers that retain their own generic signatures across the adapter boundary:

- `resolveModel<M, R>(model, input, tryModel, extractModelId)` — dispatches raw models and all routing wrappers to a per-adapter `tryModel`. Generic `M` is the adapter's model type, `R` is the result. Router and split dispatch emit `routing.router` / `routing.split`; retry emits `routing.retry` around repeated child attempts; fallback emits `routing.fallback` with per-attempt spans; cascade emits a parent `routing.cascade` plus child tier spans so selected routes, rejected tiers, budget skips, provider errors, and fallbacks are graph-native. Optional stable `id` fields are emitted as `routingId` so runtime spans can join to index definitions.

The indexer treats model-routing definitions as authored architecture, separate from execution observability. It indexes `routing.router` with `routing.router.route` children, `routing.split` with weighted `routing.split.route` children, `routing.retry` with a `routing.retry.target` child, `routing.cascade` with ordered `routing.cascade.tier` children, and `routing.fallback` with ordered `routing.fallback.option` children. Static and TypeScript-semantic relations connect those child nodes to index-visible agents, prompts, nested routers, splits, retries, cascades, and fallbacks when the target can be resolved across local bindings, imports, aliases, barrels, or call-profile objects such as `{ model }`. Semantic evidence from router `classify` and split `seed` `RouteArgs` annotations populates parent `routingContextType` and `routingContextRequired` facts; literal router/split route settings other than `model` populate the child `profile` fact. Child definitions remain first-class while `metadata.indexPresentation` tells web/TUI catalog clients how to fold them under their parent. Higher-level primitives can also link to routing policies with edges such as `agent.uses_routing`, `flow.step.uses_routing`, and `composition.uses_routing`. Index lint rules warn on missing stable routing ids, routers without `default`, unresolved routing targets, and non-terminal cascade tiers that accept by default and make later tiers unreachable.

- `orchestrateGenerate<TArgs extends Record<string, unknown>, TResult>(spec, doGenerate)` and `orchestrateStream<TArgs, TResult>(...)` — wrap adapter-specific `doGenerate` / `doStream` callbacks. `TArgs` is the prepared SDK args object; `TResult` is the SDK result. The shared `MiddlewareResult` interface (`text?`, `object?`, `_meta?`, `[key: string]: unknown`) is the structural contract for middleware-visible result shapes.

Adapters support structured `timeout` budgets on direct `generate()` and `stream()` calls: `totalMs` for the whole managed call, `stepMs` for provider attempts, `chunkMs` for stalled streams, and `toolMs` / `tools[name]` for tool execution. SDK-loop adapters pass `abortSignal` to the underlying SDK where cooperative cancellation is available, and Crux rejects expired budgets with `TimeoutError`. `@use-crux/core` records the total budget as span metadata (`totalTimeoutMs`, `deadlineAt`) and emits an `operation.deadline` event at operation start so the Go read model can distinguish an active long call from a genuinely missed terminal lifecycle record. This matters in serverless/Convex-style runtimes where a provider stall or worker shutdown can prevent the terminal `span:end` from being delivered.

This keeps adapters type-honest across router/fallback dispatch without resorting to `any` at composition boundaries. Where the SDK's own types are intentionally inaccessible (Convex `FunctionReference` triggering `TS2589`, AI SDK alt-form discriminated unions that reject `Record<string, unknown>` spreads), each `any` carries an `eslint-disable-next-line` with a one-line rationale.

### Shared Orchestration (`generation/orchestrate.ts`)

Five functions extracted from adapter duplication, exported as `@internal`. `OrchestrationSpec<TPreparedArgs>` is generic over the prepared args type, enabling typed `generate`/`stream` signatures per adapter:

| Function                | Purpose                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrateGenerate()` | Middleware wrapping, timing, `onGenerate`/`onError` hooks                                                                              |
| `orchestrateStream()`   | Middleware wrapping, `onError` hook                                                                                                    |
| `resolveModel()`        | Model routing resolution for router, split, retry, fallback, cascade, and raw models with routing receipts and canonical routing spans |
| `wrapStreamIterable()`  | Async iterator interception for progress reporting (OpenAI, Google, Anthropic)                                                         |
| `withBudget()`          | Structured timeout budget race with `TimeoutError` and optional `AbortSignal`                                                          |

### Pre-built Generate Functions

Each adapter also exports standalone `GenerateObjectFn` / `GenerateTextFn` implementations for use with primitives that need SDK-agnostic generation (compaction, scoring, extraction):

| Adapter               | Object                                  | Text                                  | Embeddings             | Rerankers          |
| --------------------- | --------------------------------------- | ------------------------------------- | ---------------------- | ------------------ |
| `@use-crux/ai`        | `generateObjectFn` (singleton)          | `generateTextFn` (singleton)          | `embedding()`          | `reranker()`       |
| `@use-crux/openai`    | `createGenerateObjectFn(client)` | `createGenerateTextFn(client, model)` | `embedding(client, …)` | via `@use-crux/ai` |
| `@use-crux/google`    | `createGenerateObjectFn(client)` | `createGenerateTextFn(client, model)` | `embedding(client, …)` | via `@use-crux/ai` |
| `@use-crux/anthropic` | `createGenerateObjectFn(client)` | `createGenerateTextFn(client, model)` | generation-only        | via `@use-crux/ai` |

The Vercel AI SDK adapter exports pre-bound singletons (model is passed at call time via the options). Its `generateObjectFn` is a standalone view over the same internal structured-attempt module used by prompt structured generation, so schema sanitation, core-backed JSON repair, and router/cascade unwrapping stay consistent. The OpenAI, Google, and Anthropic object factories bind a specific client and require a model per call; their text factories still bind client and model. The helper factories are generated from the same single-turn provider runtimes that power `createOpenAI()`, `createGoogle()`, and `createAnthropic()`. Google keeps `CachedContent` lifecycle in `@use-crux/google` by passing a narrow cache resolver through runtime dependencies instead of moving provider cache policy into core.

These provider-native helpers are deliberately smaller than prompt `generate()`: they send the supplied schema to the provider's structured-output surface where supported, return provider/schema parsed `{ object }`, and preserve provider-native errors. They do not imply Crux prompt resolution, validation retry policy, safety sessions, Eval evidence reuse, tools, memory capture, or instrumentation.

### Result Envelope And Metadata Normalization

Core-step adapters build public results through `adapter/result-accumulator.ts`.
Each provider-call step contributes assistant-visible text, optional usage,
finish reason, response id, and actual model id. The accumulator concatenates
step text, exposes `finalStep` as the final provider-call snapshot, and exposes
top-level `usage` only when every provider-call step reported usage. If any step
is unmetered, the total is unknown and `usage` is omitted instead of presenting
a partial sum.

Each adapter still attaches `_meta` to the result with a consistent trace shape.
Public adapter docs should point users to `result.usage`, `result.cost`, and
`result.finalStep`; `_meta` is retained for Devtools middleware, Eval evidence,
and observability plumbing.

```ts
result = {
  text: "checking done",
  usage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
    inputTokenDetails: { cacheReadTokens: 4 },
    outputTokenDetails: {},
  },
  cost: 0.0003,
  steps: 2,
  finalStep: {
    text: "done",
    usage: finalStepUsage,
    finishReason: "stop",
    responseId: "resp_2",
    modelId: "provider-model-id",
  },
  messages,
  raw,
  _meta: {
    usage: finalStepUsage, // final provider-call metadata
    finishReason: "stop",
    toolCalls: [],
    responseId: "resp_2",
    actualModelId: "provider-model-id",
    cost: 0.0003,
  },
};
```

## Storage Adapters

### Convex (`convex/`)

`convexRecordStore({ component, ctx })` and `convexStorage({ component, ctx })` implement Convex-backed Crux record storage. They use the crux Convex component's `memories` table and a structural `ConvexCtxPort`; records mirror embeddings for a future schema-declared vector index, while dense search requires an explicit `VectorStore` (`convexVectorStore()` throws `unsupported_capability` with migration guidance). `createConvexTransport({ api, useQuery })` reads through the same document contract for React hooks. The Convex component query boundary is intentionally small: `memory.list` reads the `by_key` index with `prefix`, `limit`, and `cursor`, then returns `{ docs, cursor }`. The Convex package keeps current `_cruxDoc` JSON decoding, TTL suppression/lazy deletion, top-level filters, filtered-list page filling, and strict React transport reads behind one store-document boundary so server records and React transport cannot drift.

`createCruxConvex({ components, storage })` is the request-scoped Convex runtime profile boundary. It owns the default component-backed storage resolver, optional `storage.create` override, namespace default, ctx/target runtime binding, profile-created Convex Agent wrappers, and HTTP bridge record reads. `crux.run(ctx, target, fn)`, `crux.convexAgent(config)`, and `crux.bridge(http, cruxConfig)` all normalize through the same storage resolver. The profile-backed Convex Agent facade keeps a Convex-Agent-compatible public shape while routing turn preparation through an internal lifecycle and `ConvexAgentDriver` port; only the production SDK adapter imports `@convex-dev/agent`, and boundary tests use a fake driver for request-scoped storage binding, prompt/use merging, tool adaptation, stream callbacks, persistence, and driver failures. Lower-level storage and transport helpers remain package-internal implementation details; application integrations should start from the profile or the Storage Beta factories. The store-doc module remains the document policy boundary for serialization, TTL cleanup, filters, versioned compare-and-set, and capability reporting.

### Upstash (`upstash/`)

`upstashVectorStore(config)` — `VectorStore` backed by Upstash Vector for dense, sparse, and hybrid retrieval.

`upstashRedisRecordStore(config)` — `RecordStore` backed by Upstash Redis for JSON records with native TTL.

Use `upstashVectorStore()` for retrieval/indexing code and pair it with an explicit `RecordStore` when a primitive needs hydration.

## Canonical Observability Runtime

`@use-crux/core/observability` is the only TypeScript write contract for detailed traces. Runtime primitives emit append-only graph records and the Go backend owns all graph complexity: validation, idempotent ingestion, placeholder reconciliation, read-model building, filtering, search, retention, and subscriptions.

`emit()` is the in-process event spine for those records. It validates each graph record once, then
fans out synchronously to `subscribeObservability()` subscribers, publishes `{ schemaVersion,
record }` on the Node diagnostics channel `crux:observability` when that channel has subscribers,
and queues the same record for the async transport when a transport is configured. In-process
subscriber failures are counted in `observabilityDiagnostics().subscriberErrors` and never interrupt
user code, sibling subscribers, or transport delivery. The diagnostics channel is a Node tee for
external observers and degrades to no-op when `node:diagnostics_channel` is unavailable.
Trace and span IDs use W3C lowercase hex formats. Ordinary one-segment writers stamp every record
with a stable `segmentId` and positive `segmentSeq` before validation/fan-out; `segmentSeq` is
monotonic only within that execution segment, so storage and clients must not treat it as a
distributed per-run order.
Correlators are carried by the same observability context: `propagateAttributes()` merges
`sessionId`, `userId`, and flat metadata into active and future run/span scopes. `emit()` stamps
the scalar correlators onto every record and projects metadata into capped `meta.*` attributes.
The Go backend stores `session_id` and `user_id` from `run:start`; run-list reads can filter by
`sessionId` without adding session nodes to the execution graph.

`observe.run()` creates user-facing execution roots. `observe.span()` creates inspectable operations and automatically opens an implicit run when called outside an active run, so compositions such as `pipeline`, `consensus`, `parallel`, and `swarm` remain traceable when used directly. Span families are derived from canonical primitive names at emit time. Manual spans expose `span.setAttributes()` for accumulated metadata and `span.end({ attributes, metrics, status, error })` for terminal data; raw `span.end(attributes)` calls are not part of the contract. `observe.event()`, `observe.artifact()`, and `observe.edge()` attach timestamped detail, payloads, and relations to the active graph context.

A user-visible operation (`operationId`) owns one root run and any independently durable child runs. The root has `operationId === runId`; a durable child gets a distinct `runId`, copies the operation ID, and records immutable `parentRunId` plus `triggeredBySpanId` topology. Nested Flow, named durable defer, and Convex durable swarm boundaries use child runs. Pipeline, parallel, consensus, in-process swarm/delegate, generation calls, and ordinary propagated host continuations remain spans or segments inside their current run. Trace IDs are W3C correlation only and never determine operation membership.

A logical run (`runId`) is distinct from the physical execution segment (`segmentId`) that carries it: a run may suspend and resume across any number of processes/isolates/invocations before it ends exactly once. `openRun(...).suspend({ reason })` ends the current segment and returns a JSON-safe `CruxPropagationCarrier`; `observe.resumeRun(carrier, { reason })` opens a fresh segment (`segmentSeq` restarts at 1) on the same `runId` and emits `run:resume` before any child record. A host continuation that did not logically suspend uses a fresh segment without manufacturing suspend/resume evidence. `observe.withContext()` / `captureContext()` remain context-only — they restore the active span/attribute stack for a callback and can never resume, suspend, or end a run themselves, so first-party Flow/Convex code holds the returned run/segment handle as the explicit lifecycle owner instead of restoring a captured context and hoping an implicit span ends the run. Calling `suspend`/`end`/`error` more than once is locally idempotent; the immutable backend record is the distributed authority, and a conflicting second terminal record is diagnosed rather than applied.

Built-in orchestration primitives write the graph contract through the shared agent composition runtime. `parallel()` opens `composition.parallel` with sibling `agent.run` children. `pipeline()` opens `composition.pipeline`, one `flow.step` per executable step, and nested `agent.run` spans for agent steps. Runtime `flow()` opens `flow.run`, emits `flow.step` children, and records intentional waits as `flow.suspension` markers linked to the causing step. Successful `flow.step` spans also record the step result as an `output` artifact, so step outputs are inspectable from the trace without re-running the flow. `consensus()` opens `composition.consensus` with voter `agent.run` children directly under that composition span. `swarm()` records agent turns, `handoff.prepare`, `handoff.payload` artifacts, and `triggered` edges between turns. `delegate().run()` records `delegate.invoke`, canonical input/output artifacts, and links its handoff preparation with `delegate.invoked`.

Prompt/context and safety primitives also write the graph contract directly. `prompt.resolve()` opens `prompt.resolve`; conditional context evaluation emits `context.predicate` spans with `included`, `predicate`, discriminator/branch, and exclusion reason attributes; context text resolution emits `context.resolve` spans plus `context.contribution` artifacts and `produced` edges. Context contributions that provide tools carry `injectedTools` so readers can explain which contribution supplied each request tool; contributor, memory, blackboard, and retriever tool producers emit the same preview shape even when they have no resolved text. Included context artifacts are carried through `systemBlocks` and linked to each generation span with `consumed` edges, so the backend can expose the exact context for a call in `inspection.context`. Token-budget drops are recorded in `prompt.budget` artifacts. Generation orchestration emits consumed `messages` artifacts for the prepared request payload. The Safety session's constraint phase opens a grouped `constraint.check` span, runs each constraint check as a child span with pass/fail attributes, records `constraint.report` artifacts, and emits `constraint.retry` spans/edges for combined-feedback regeneration. Its guardrail phases open grouped and per-guard `guardrail.run` spans, record each action as span attributes plus `guardrail.report` artifacts with before/after previews when content changes, and emit `guardrail.blocked` edges for blocking decisions.

Memory primitives write the graph contract from the shared block hook path. `recentMessages`, `workingState`, `episodes`, `facts`, `procedures`, proposal lifecycle operations, `blackboard()`, and custom blocks that use the standard context helpers emit `memory.read` / `memory.write` spans, `memory.snapshot` artifacts, recalled-result `memory.recall` artifacts, write-summary `memory.diff` artifacts, and semantic memory edges. Completed-turn scheduling adds one payload-free `memory.capture` lifecycle span to the owning generation Run; it never opens an implicit Run, and existing `memory.write` operations remain nested storage evidence. Empty reads keep the `memory.read` span and omit `memory.recall` so clients do not render empty recalled-block cards. The raw namespace is never emitted; traces receive `namespaceHash`.

Retrieval and data-loading primitives write the same graph contract. `retrieval.query`, `retrieval.recipe`, `retrieval.step`, `indexing.pipeline`, `ingest.parse`, and `corpus.sync` spans are emitted at the public API boundaries so standalone calls create implicit runs and calls during prompt/corpus work nest under the active span stack. Detailed payloads stay in canonical artifacts: `retrieval.hits`, `embedding.report`, `indexing.report`, `ingest.report`, `corpus.report`, `cache.report`, `routing.report`, `compaction.report`, `score.report`, `citation.report`, `composition.report`, `handoff.payload`, `delegate.report`, `memory.snapshot`, and `security.report`. Retrieval hits, memory snapshots/recalls/diffs, stream timelines, and raw error artifacts are output-direction payloads for capture policy, so disabling outputs prevents their preview text from reaching devtools, subscribers, transports, or OTel. A `routing.report` envelope carries the exact caller-visible receipt `{ model, cost, firstTokenAt?, trace }`; `firstTokenAt` is elapsed stream TTFT milliseconds and the receipt itself never carries an inner artifact `kind`. Routing reports preserve router/cascade/fallback decisions for Run Detail cards; cascade reports include the full ordered ladder, skipped configured tiers, and per-tier evaluator note/confidence/budget when supplied. Production OTel export keeps metadata-only defaults unless the telemetry plugin explicitly opts into GenAI message content with `captureMessageContent`.

Tool primitives write the graph from the shared adapter loop. This keeps user-defined tools, context-injected tools, skill tools, swarm transfer tools, and approved resume executions on one contract: `tool.request` for model intent, `tool.call` for execution, `tool.args` / `tool.result` artifacts for inspectable payloads, and `tool.approval` for gates. Devtools, subscribers, diagnostics-channel listeners, and `@use-crux/otel` all consume those canonical graph records directly.

Delivery is intentionally non-blocking for normal Node.js use. The first queued delivery starts immediately so devtools can show live span starts during long-running actions. Later records coalesce per microtask and are delivered FIFO behind the active transport send, so a later `span:end` cannot overtake its own `span:start` across HTTP delivery attempts. HTTP batches are JSON-normalized before transport: cyclic values, `bigint`, functions, non-finite numbers, deep objects, and oversized strings are converted into inspectable safe previews instead of poisoning the POST. If the Go backend rejects a multi-record batch, the transport isolates records and still delivers valid lifecycle records such as `span:end` / `run:end`, so one bad detail artifact cannot strand a successful run as visually running. The Go observability service still reconciles out-of-order lifecycle records by stable ids and timestamps defensively, so externally reordered records do not corrupt the read model. Streaming generation spans close through a single finalizer shared by raw stream drain, stream cancellation, and stream errors. Only the stream's own terminal signal ends the span, immediately, with stream-derived metrics - there is no grace timer and no terminal signal driven by provider completion when a raw stream is observed. Provider completion metadata that is still pending, or that arrives after, is attached by the caller as a linked `usage.observed` span event and output artifact and can never reopen the span or change its recorded duration/status; a late completion error is likewise linked as a diagnostic event rather than mutating the terminal record. When no raw stream is observed, provider completion is itself the sole terminal signal. Generation `timeout.totalMs` is enforced in core orchestration, not only in provider adapters: if a model call never settles, `generation.call` / `generation.stream` emits a terminal error span instead of relying on backend deadline reconciliation. For presentation only, terminal ancestor scopes such as suspended flows can close still-running descendants before operation deadline fallback marks them incomplete; output or usage evidence lets completed generations render as `ok` while the enclosing flow renders as `suspended`. Transport errors are collected by diagnostics and do not throw into user code. Failed batches requeue behind the delivery engine and retry on an unref'd capped backoff, so terminal records do not wait for an unrelated future emit before reaching devtools. Runtime reset and transport replacement advance the delivery epoch; stale in-flight failures are counted as dropped instead of being requeued into a later transport. Bounded `observe.flush({ timeoutMs })` and `observe.shutdown({ timeoutMs })` exist for serverless runtimes and Convex-style request lifecycles where queued writes must be awaited before the platform freezes or kills the process. Bounded flush uses a cancelable timeout primitive so a successful delivery does not leave a timer alive after the flush returns, and it also force-flushes an installed telemetry manager's exporter/processor work (see below), not only the delivery queue.

Delivery success is per record, not per HTTP status: the v2 receipt carries one indexed disposition (`accepted` / `rejected`, with a `retryable` flag) per input record, a malformed or partial receipt retries every unaccounted record, and `recordId` identity is immutable — an exact duplicate is accepted idempotently, a conflicting payload under the same id is rejected permanently and diagnosed rather than overwriting the original. `packages/core/src/observability/delivery/{engine,retry,host-scope,drain}.ts` implement bounded batching/backoff/overflow accounting against a small provider-neutral host lifecycle port (`context`, `defer`, `deadline`) rather than a runtime import; `handler.ts` and the Node subpath bind that port for generic serverless hosts. Cloudflare's `withCrux` boundary lives in `@use-crux/cloudflare` and registers its structured drain on the execution-scope controller before retaining the whole root through `ExecutionContext.waitUntil()`. Every wrapper reports a structured `ObservabilityFlushResult` instead of a boolean. `@use-crux/otel`'s `withTelemetry()` activates a real OTel span around the instrumented callback (not a span created after the fact), ends the segment's root span on `run:suspend`, starts a fresh root span sharing the original `traceId` on `run:resume`, and round-trips the same `CruxPropagationCarrier` through W3C `traceparent`/`tracestate`/an allowlisted baggage projection via `injectCruxPropagationCarrier()` / `extractCruxPropagationCarrier()`.

`config({ observability })` wires a custom transport or an HTTP transport as explicit export behavior.
Default `config()` does not install telemetry, upload, raw-content capture, or delivery policy.
`teeObservabilityTransport()` fans records to multiple sinks while isolating a failing leg.
Evals open an `eval-run` execution scope with a persistent capture-session facet and one
`eval-cell` scope per Case/Variant/trial. Cell scopes use `drain: "capture"` and
`sealedWrites: "drop"`: inline defers become evidence without invoking their callbacks, named
defers return captured references without resolving or writing to Runtime, and observability writes
restored into a timed-out cell are dropped without affecting sibling work. Configured devtools
transports still receive accepted records through the normal delivery engine. The HTTP transport posts canonical `{ records }` batches to
`/api/observability/records`; HTTP, WebSocket, and SSE layers should remain adapters around Go
services rather than owning graph semantics.

Schema governance lives beside the wire contract in `observability/VERSIONING.md`.
Known producer fixtures must pass the TypeScript schema and Go conformance tests.
Forward-compat fixtures prove the Go server stores unknown record types and extra
fields as raw records without widening the TypeScript producer schema.

Devtools run-detail views poll briefly after a root run reaches a terminal status. This keeps Convex/serverless boundary flushes visible when final artifacts or child evidence arrive just after the terminal update. The web Runs list is one revisioned server-owned operation read model (`/api/observability/runs/page`), with exactly one row per `operationId`; Eval runs remain a separate, explicitly linked read model. The Go service retains lifecycle truth per member run, bumps a monotonic revision for the affected operation inside the ingest transaction, and publishes it after commit. Child-before-root ingestion creates a stable incomplete operation shell, explicit deletion tombstones prevent late records from resurrecting a family, and retention removes terminal families atomically while preserving any family with active or suspended members. Devtools performs a bounded `/api/observability/runs/delta?since=` catch-up (or a full invalidate once that window has aged out) instead of an unconditional refetch. Row/detail status distinguishes `running` / `suspended` / `incomplete` / `conflicted` from ordinary terminal states and reports aggregate child and topology health. Delivery/export health is `unknown` / `healthy` / `degraded` — `unknown` is never rendered as healthy. Focused span output streams use the lazy `/api/observability/runs/{runId}/spans/{spanId}/events?name=token.chunk` endpoint instead of loading high-frequency chunks into every operation detail.

The Go read model owns user-facing trace shape. Convex Agent's outer `generation.stream` is visible as `GENERATE stream response` when it carries useful structure such as multiple steps or tool calls; its child `generation.call` steps and `tool.call` executions stay beneath that container in timestamp order. Each child generation receives a complete effective `request`: exact when it consumed its own request-shaped messages, inherited from the nearest enclosing generation request when it only emitted output-shaped messages, and aggregate on run/stream/agent/composition nodes when representing descendant turns. Agent and stream aggregates only consider the agent loop's own generation turns; generations nested inside tool-called flows remain visible where they ran but cannot become the parent agent's representative request. Contextual retrieval, memory, and embedding spans remain in the lossless graph but fold into attached details when they are request-input evidence for a generation. Operational retrieval inside tool, flow, composition, or agent boundaries remains visible even when an ancestor is an agent generation stream; only the retrieval pipeline internals such as query/embed stages fold into the retrieval node. A redundant single-step stream wrapper is folded as detail so simple generations do not gain an empty-looking extra level. Session ids remain run metadata/grouping, not execution nodes.

Eval execution uses the bounded `eval-coordinator.mjs` worker embedded in the
`@use-crux/local` Go binary. The CLI supports the public `crux eval` workflow:

```txt
crux eval [id-or-path...]
crux eval run [id-or-path...]
crux eval list
crux eval show <run-id>
crux eval diff <run-a> <run-b>
crux eval baseline set <run-id>
```

The coordinator loads the project-local Core instance, discovers one default Eval export per file,
hydrates Case files relative to their declaring Eval, plans execution, and emits a bounded NDJSON
protocol to Go. Portable tasks run locally. Host-required tasks are selected from the generated
identity-only registry and execute through the one configured Runtime adapter; no functions,
prompts, models, module paths, or credentials cross that protocol.

`@use-crux/core/eval` owns inert authoring, planning, execution semantics, evidence identity,
assessment, aggregation, gates, and Baseline compatibility. Node-only discovery, persistence, and
programmatic execution live under `@use-crux/core/eval/node`. Internal coordinator access remains
under unexported or explicitly internal subpaths and is not a public authoring API.

Eval run and Baseline records are versioned durable contracts. Reuse is automatic only when Core can
prove exact task, input, Variant, trial, schema, and scorer identity. `--offline` performs no external
work, `--fresh` bypasses reusable task and managed-scorer evidence, and incomplete runs never pass or
become Baselines. The Go CLI reports plans and results but does not redefine those policies.
One controller owns each live task attempt and is the only owner that arms the Eval `totalMs`
deadline. A task-only async-local context exposes that signal plus marked nested timeout ceilings;
scorers and assertions run after the context and deadline have ended. Cancellation is cooperative.
The cell scope seals before abort, so ignored work may continue but cannot publish late evidence,
observability, cost corrections, or remote results.

Current producers write Run V4, whose `timed_out` cells are complete and non-passing; TypeScript,
Go, and Devtools retain explicit Run V3 readers. Baseline remains schema V3 and stores aligned
terminal outcomes plus nullable metric values under fingerprint epoch 5. Eval Host V2 transports
deadline provenance and structured pre-start/in-flight timeout terminals with bounded poll grace.
Host V1 records remain readable, but V1 cannot advertise the capability required for new remote
work.
Cell execution evidence stores ordered logical run IDs, while assertion outcomes
store exact assertion span IDs; neither field is a substitute for W3C trace IDs.

Production feedback uses the configured observability destination. `@use-crux/core/feedback` accepts
the canonical run ID; `@use-crux/ai/feedback` extracts that identity from AI message metadata. Local
persists immutable submissions and Review actions, and Add-to-eval writes a validated Case only after
explicit human action. Feedback never becomes expected truth automatically.
