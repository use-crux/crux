# @use-crux/ai

## 0.3.0

### Minor Changes

- 890d660: Deepen the loop-owned execution boundary into a single gateway-closed `LoopRuntimePort`, replacing the per-call `client` threading of the old `ExecutorSpec`/`SdkLoopDialect` seam.

  `@use-crux/core`:
  - Replace `ExecutorSpec` with `LoopRuntimePort` (`id`, `describeModel`, `mapSettings`, `runTextLoop`, `runStructuredAttempt`, `runStream`, `replayStream`). The port is already bound to its SDK client, so each run method takes only an `ExecutorRequest` — there is no per-call `client` argument.
  - `bind()` now returns the client-dependent `BoundLoopRuntime` (renamed from `BoundLoopOwnedRuntime`), which core assembles with `id`/`describeModel`/`mapSettings` into the port.
  - Rename `executorAdapter(spec)(client)` to `loopRuntimeAdapter(port)`.
  - Testing: `fakeExecutor` → `fakeLoopRuntime` (returns `{ runtime, calls }`); `executorSpecConformance` → `loopRuntimePortConformance` (harness `prepare()` returns `{ runtime, model }`).

  `@use-crux/ai`:
  - Add `createAiSdkLoopRuntime(gateway): LoopRuntimePort<LanguageModel>` and the `AiSdkLoopRuntime` type — the adapter from `SdkGateway` to the core port. `aiSdkProviderRuntime` and `createCruxAi({ gateway })` are unchanged.

  `defineProviderRuntime({ ownership: 'loop-owned', loop })` authoring is unchanged except that `loop.bind()` now returns `runTextLoop`/`runStructuredAttempt`/`runStream` (was `run`/`attemptStructured`/`stream`).

### Patch Changes

- 53b04a3: Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

  Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

  Document the single-turn provider bundle authoring path in adapter package READMEs.

- 5477724: Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

  Remove the legacy runtime instrumentation hook bus. `withTelemetry()` now subscribes to the canonical graph-record stream by default, and `createOtelRecordSubscriber()` remains available for custom OTel wiring.

  Migrate AI agent, Convex swarm/compaction, and ingest parser instrumentation to canonical graph records so they continue emitting observability after the hook bus removal. `TelemetryOptions.recordContent` is removed; use the core `observability.recordInputs` / `recordOutputs` policy instead.

  Add observability capture policy controls: `config({ observability: { recordInputs, recordOutputs } })`. Disabled input/output artifacts are emitted as reference records with size/hash metadata and no preview.

  Generation and streaming span-end records now carry `gen.*` performance metrics, and `@use-crux/otel` maps them to exported `gen_ai.client.*` attribute constants.

  Restore the documented default `withTelemetry()` behavior: when no lightweight exporter is configured, `@use-crux/otel` now uses the globally registered OpenTelemetry tracer instead of silently dropping spans.

- Updated dependencies [2cd8c52]
- Updated dependencies [890d660]
- Updated dependencies [53b04a3]
- Updated dependencies [5477724]
- Updated dependencies [a9fd8f9]
- Updated dependencies [fd4b17f]
- Updated dependencies [5a164be]
  - @use-crux/core@0.3.0
  - @use-crux/react@0.3.0

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
  - @use-crux/react@0.2.0
