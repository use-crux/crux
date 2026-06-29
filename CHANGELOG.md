# Changelog

Human-friendly release notes for synchronized Crux releases. Package-specific changelogs live next to each package.

## 0.3.0

### Highlights

- Deepen the loop-owned execution boundary into a single gateway-closed `LoopRuntimePort`, replacing the per-call `client` threading of the old `ExecutorSpec`/`SdkLoopDialect` seam.

  `@use-crux/core`:
  - Replace `ExecutorSpec` with `LoopRuntimePort` (`id`, `describeModel`, `mapSettings`, `runTextLoop`, `runStructuredAttempt`, `runStream`, `replayStream`). The port is already bound to its SDK client, so each run method takes only an `ExecutorRequest` — there is no per-call `client` argument.
  - `bind()` now returns the client-dependent `BoundLoopRuntime` (renamed from `BoundLoopOwnedRuntime`), which core assembles with `id`/`describeModel`/`mapSettings` into the port.
  - Rename `executorAdapter(spec)(client)` to `loopRuntimeAdapter(port)`.
  - Testing: `fakeExecutor` → `fakeLoopRuntime` (returns `{ runtime, calls }`); `executorSpecConformance` → `loopRuntimePortConformance` (harness `prepare()` returns `{ runtime, model }`).

  `@use-crux/ai`:
  - Add `createAiSdkLoopRuntime(gateway): LoopRuntimePort<LanguageModel>` and the `AiSdkLoopRuntime` type — the adapter from `SdkGateway` to the core port. `aiSdkProviderRuntime` and `createCruxAi({ gateway })` are unchanged.

  `defineProviderRuntime({ ownership: 'loop-owned', loop })` authoring is unchanged except that `loop.bind()` now returns `runTextLoop`/`runStructuredAttempt`/`runStream` (was `run`/`attemptStructured`/`stream`).

- Complete the profile-backed `convexAgent()` lifecycle around the Convex Agent method surface.
  - Align thread continuation with Convex Agent: call `continueThread(ctx, target)` first, then pass Crux prompt `input` to `thread.generateText()`, `thread.streamText()`, `thread.generateObject()`, or `thread.streamObject()`.
  - Add profile-backed `generateObject()` and `streamObject()` support, injecting resolved Crux prompt state and prompt output schemas through the same lifecycle/driver boundary as text generation.
  - Derive public generation args/options/results from upstream Convex Agent method types while omitting Crux-owned `system`, `prompt`, `messages`, and `tools`.
  - Add the `crux` config namespace for Crux-owned lifecycle controls: `crux.prepare`, `crux.runtime.store`, `crux.runtime.namespace`, `crux.observe`, `crux.persistence`, and advanced `crux.driver`. Existing top-level `prepare`, `store`, and `namespace` remain as deprecated compatibility aliases.
  - Move Crux-only prompt resolution to `agent.crux.resolve()` with direct `agent.resolve()` kept as a deprecated compatibility alias.
  - Deepen the Convex store document contract with a substitutable `ComponentDocumentPort`, normalized `ConvexStoreDocumentComponent`, and `createInMemoryConvexStoreDocumentComponent()` for server/React boundary tests.

- Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

  Remove the legacy runtime instrumentation hook bus. `withTelemetry()` now subscribes to the canonical graph-record stream by default, and `createOtelRecordSubscriber()` remains available for custom OTel wiring.

  Migrate AI agent, Convex swarm/compaction, and ingest parser instrumentation to canonical graph records so they continue emitting observability after the hook bus removal. `TelemetryOptions.recordContent` is removed; use the core `observability.recordInputs` / `recordOutputs` policy instead.

  Add observability capture policy controls: `config({ observability: { recordInputs, recordOutputs } })`. Disabled input/output artifacts are emitted as reference records with size/hash metadata and no preview.

  Generation and streaming span-end records now carry `gen.*` performance metrics, and `@use-crux/otel` maps them to exported `gen_ai.client.*` attribute constants.

  Restore the documented default `withTelemetry()` behavior: when no lightweight exporter is configured, `@use-crux/otel` now uses the globally registered OpenTelemetry tracer instead of silently dropping spans.

- Deepen the core prompt-resolution pipeline behind one private pass primitive and complete the resolver-port seam.
  - Introduce `createPromptResolverPlan(config, ports)` — the single private pass primitive. `compilePrompt()` is now a thin boundary that validates the config, binds ports, and projects `resolve()` / `inspect()` over the plan's one `run(opts, mode)` call, so the two projections can never drift across ordering, gating, skills, budget, settings, or inspection.
  - Add a `TokenizerPort` (`{ count(text) }`): every token count the pipeline reports (system parts, prompt text, dropped contexts) now flows through it, so a deterministic counter pins token-budget behavior without depending on the production chars/4 estimate.
  - Broaden the `skills` port to own registry fetch **plus** skill-index generation and activation-session creation — the resolution pass no longer imports the skill module directly.
  - Add `createResolverFakes()`: a one-call bundle of deterministic in-memory ports (observability, skills, cache, clock, tokenizer, policy, diagnostics, instrumentation), each also exposed as a named handle for assertions. New `staticTokenizer()` fake.
  - `compilePrompt()` now returns a `PromptResolutionPipeline`; `CompiledPrompt` remains as a deprecated alias. New public exports: `PromptResolutionPipeline`, `TokenizerPort`, `staticTokenizer`, `createResolverFakes`, `ResolverFakes`, `ResolverFakesOptions`.
  - Internal-only refactor of the resolution internals (split port contracts in `resolver/ports.ts` from their production adapters in `resolver/default-ports.ts`). No change to the `prompt().resolve()` / `prompt().inspect()` runtime behavior or to resolved prompt args.

- Add `defineSingleTurnProviderBundle()` for provider packages that compile single-turn SDK wire hooks into the standard Crux provider runtime and helper factories.

- Stabilize Plan & Tasks task-list state handling: duplicate IDs, removed tasks, discarded lists, terminal transitions, pending/cancelled status derivation, and stale counter repair now resolve through typed lifecycle errors and row-derived state.

  Cut over the experimental Plans & Tasks API to the canonical `plan()`, `tasks()`, and `task()` surface. Plan and task handles are command handles with `get()`/`list()` reads, existing entities are bound with `plan.ref()` and `tasks.ref()`, creation tools live at `plan.tool()` and `tasks.tool()` with safe `created()` accessors, and the old `tasklist`, top-level agent/tool factories, and first-match task-list lookup exports are removed from public entrypoints.

  Add typed task definitions for `tasks({ items })`: keyed `task()` specs now infer literal task IDs for reads, lifecycle methods, and workers, infer schema-backed `complete()` result payloads, validate completed results at runtime, and reject non-JSON plan/task metadata, list metadata filters, and task results before persistence.

  Tighten the final beta contract with root-level task lifecycle error exports, schema-input completion typing for transforming result schemas, JSON guard coverage for dropped object properties, and consistent plan-list metadata filtering.

  Align React and devtools with the canonical beta surface: React hooks now expose `usePlan()` and `useTasks()` with ID-or-handle inputs and no public `useTaskList()` alias, while local/devtools plan details project canonical task activity with core task statuses and separate progress messages.

  Rewrite the public Plans & Tasks docs around the final beta API, including `plan()`, `tasks()`, `task()`, handle methods, dynamic vs defined ledgers, status derivation, lifecycle errors, React hooks, and guidance on when to use `flow()` or an external durable runner.

- Deepen Google CachedContent into a single `GoogleCachedContentLifecycle`. `createGoogle({ cachedContent })` now resolves one lifecycle that owns prefix detection, cache keying/reuse, SDK cache operations, and fallback policy, returning a request-ready config patch that both `generate()` and `stream()` merge.
  - Configure the built-in lifecycle with `GoogleCacheConfig` (`defaultTtlSeconds`, `maxEntries`, `onError: 'fallback' | 'throw'`, or a custom `GoogleCachedContentCachePort`), pass `false` to disable, or pass a fully custom `GoogleCachedContentLifecycle`.
  - Invalid TTL/config values are rejected (per-call TTL overrides fall back to the default; bad `defaultTtlSeconds`/`maxEntries` throw a clear error).
  - New exports: `GoogleCacheConfig`, `GoogleCacheName`, `GoogleCachedContentCachePort`, `GoogleCachedContentErrorMode`, `GoogleCachedContentLifecycle`, `GoogleCachedContentOption`, `GoogleCachedContentPlan`, `GoogleCachedContentPrepareArgs`.

### Fixes

- Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

  Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

  Document the single-turn provider bundle authoring path in adapter package READMEs.

- Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

  Remove the legacy runtime instrumentation hook bus. `withTelemetry()` now subscribes to the canonical graph-record stream by default, and `createOtelRecordSubscriber()` remains available for custom OTel wiring.

  Migrate AI agent, Convex swarm/compaction, and ingest parser instrumentation to canonical graph records so they continue emitting observability after the hook bus removal. `TelemetryOptions.recordContent` is removed; use the core `observability.recordInputs` / `recordOutputs` policy instead.

  Add observability capture policy controls: `config({ observability: { recordInputs, recordOutputs } })`. Disabled input/output artifacts are emitted as reference records with size/hash metadata and no preview.

  Generation and streaming span-end records now carry `gen.*` performance metrics, and `@use-crux/otel` maps them to exported `gen_ai.client.*` attribute constants.

  Restore the documented default `withTelemetry()` behavior: when no lightweight exporter is configured, `@use-crux/otel` now uses the globally registered OpenTelemetry tracer instead of silently dropping spans.

- Reorganize `@use-crux/core` into package-root domain folders (`prompt/`, `resolver/`, `runtime/`, `generation/`, `tools/`, `shared/`) and split the largest single-file domains into curated barrels plus focused implementation files. The root `types.ts` mega file was drained into the owning domains and reduced to the dependency-free base contracts (`AnyModel`/`AnyToolSet`/`AnyMessage`, `FlowToolDef`, `ModelInfo`).

  This is an internal restructuring only: the public `@use-crux/core` API, every package subpath (including `./tools` and `./tool-middleware`), and `package.json` exports/`typesVersions` are unchanged. No import paths change for consumers.

  Deepen agent composition internals behind a shared composition runtime that owns composition ids, canonical composition spans, child execution contexts, retry wrapping, and report artifacts for `parallel`, `pipeline`, `consensus`, and `swarm`. Public composition factories are unchanged; consensus observability now reports voter agent spans directly under the consensus composition instead of adding a nested parallel composition span.

- Rename the bundled native worker binary from `crux-indexer-worker` to `crux-static-index-worker` to reflect its Static Syntax / Static Index ownership. The `crux` CLI is unchanged and discovers the renamed sibling binary automatically; the only visible change is the binary filename shipped inside the `@use-crux/local-<os>-<cpu>` platform packages.

## 0.2.0

### Highlights

- Prepare the first npm release under the `@use-crux` package scope.

  Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
  troubleshooting guidance.

  Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
  worker process is still running.
