# @use-crux/indexer

## 0.5.0

### Minor Changes

- fd6edcc: Harden indexer untrusted-input handling: source-only static syntax planning no longer imports project config, extension loading verifies resolved package identity and containment before import, and source-map disk reads are contained to the project root.

  Preserve semantic source-profile completeness across worker streams so incomplete profiles are not reused through the semantic facts cache, and split Project Index worker transport limits so multi-line fact/artifact streams can exceed the per-line cap without failing.

  Harden Project Index correctness and determinism across patch merging, native/static syntax parity, record-lane extraction, stale provided-record handling, extension diagnostics, and rejected cache reads so cached, incremental, and native-backed runs preserve the same read-model facts.

  Improve Project Index watch latency and live updates with lower save-path debounce windows, exported-interface source hashes that stop body-only edits from cascading to dependents, per-file WebSocket index deltas, cancellable background semantic waves, and watch-run fallback/status telemetry in local devtools. Source rows now include source and interface hash evidence so incremental planning can safely preserve single-file leaf edits across restarts.

  Freeze the indexer stable-beta public surface: `ExtractContext` and extension manifest authoring types now have type-level guards, root syntax-record projection options no longer expose host-only worker controls, host static-index helpers carry those controls through explicit `ForHost` APIs, runtime `use` target matching is data-driven, and docs now mark root/testing/source-resolver/contracts as stable-beta surfaces while keeping extensions experimental and host subpaths Crux-owned.

  Finish stable-beta indexer housekeeping: bump the static, semantic, and Go Project Index cache epochs, store Go snapshot fact caches under epoch-specific directories, align Crux Indexer and Project Index terminology/config docs, and promote the documented stable-beta Index Lint rule set while keeping the remaining rules preview.

  Improve the Rust/Oxc static syntax frontend with `oxc_semantic`-backed scope visibility so match-local initializer resolution respects declaration order and nested shadowing instead of leaking later same-scope bindings. Import-qualified call interests now also resolve through Oxc symbol references so local shadowing cannot be misclassified as a first-party import call. Function return records now resolve direct identifier returns through Oxc binding evidence at record-production time, and the static parse cache epoch is bumped to `static-parse-v53` for the output change.

  Add first-party static golden checks so Rust/Oxc output is compared against the captured Rust-owned golden, and scale the local Rust/Oxc static-index worker pool default to `GOMAXPROCS` while preserving `CRUX_STATIC_INDEX_WORKER_POOL_SIZE` as the explicit tuning override.

  Retire the legacy TypeScript first-party static parser, bundled extractors, bundled lint evaluator, and root in-process project indexing APIs. `@use-crux/indexer` is now the extension-authoring SDK plus Project Index record contracts; bundled first-party extraction and linting are Rust-only binary features owned by Crux Local and the CLI. The TypeScript host remains only for third-party extension contributions and host/config/semantic support lanes.

  Remove the monolithic `compileProjectIndex` host pipeline and syntax-record patch RPC from the TypeScript worker path. Runtime artifact generation now projects supplied native Project Index definitions instead of parsing source in-process, and no-config Quality prompt-test collection no longer falls back to TypeScript source projection.

  Make root/host `createStaticExtraction()` require an explicit syntax frontend, while keeping the TypeScript syntax-record producer as the documented `/testing` fixture default. Fixture traces now report the syntax producer identity used for the run.

  Ship Crux Local platform packages with an enforced Rust/Oxc static-index worker sibling: staged release validation now rejects platform tarballs that omit `bin/crux-static-index-worker` or carry mismatched `os`/`cpu` metadata. The staged `@use-crux/local` manifest injects platform packages as optional dependencies, while committed workspace manifests are guarded against platform optional dependencies so workspace and Karyla installs stay local-path based.

  Run semantic enrichment as shard-local work when the Project Index source graph proves complete shard and dependency evidence. Crux Local now fans semantic requests across a lazy worker pool and merges shard semantic patches without invalidating AST/source facts.

  Move Crux Local incremental watch reindexing onto the production Go to Rust/Oxc Static Index compiler path and remove the TypeScript bundled fallback path. The production watch benchmark now enforces the Tier-A leaf p95 budget on the shipping path.

  Keep source/interface hash evidence consistent across TypeScript and Rust/Oxc static records, including constructor signatures, and bump the static parse cache epoch to refresh stale source-row cache entries.

  Tighten Project Index transport contracts by keeping WebSocket index messages and Rust source snippets on typed payload shapes instead of untyped JSON values.

  Prefer the packaged Rust/Oxc static-index worker for `/testing` fixture extraction when the matching platform package is resolvable, and fully flip the native AST gate to Rust-vs-golden validation with no TypeScript bundled baseline comparison.

  Update Crux Local native build baselines to Go 1.26.4 and Rust 1.96.1, and refresh the Rust/Oxc static syntax frontend dependency identity to Oxc 0.139.

  Align native and semantic definition identity with runtime observability joins: composition definitions now require and use their authored `id`, canonical ids remain byte-identical to the runtime `DefinitionRef` builders, and missing composition ids no longer fall back to a misleading local variable name.

- 0c3ba08: Add request-scoped `defer(callback)` with bounded host-lifetime execution, the
  explicit `@use-crux/core/defer/node` HTTP integration, and Runtime-backed named
  target staging through `await defer(target, input)`. Postgres and Convex Runtime
  stores now persist named deferred intents and recover their release through the
  existing transactional outbox. Public `defer()` is rejected during replayable
  flow execution, and the Runtime snapshot field for replay-visible child work is
  hard-renamed from `scheduledEffects` to `scheduledWork` with no compatibility
  field or read path.
  Inline callbacks now isolate nested named commits per callback and report late
  commit failures without stopping sibling cleanup.
  Project Index now discovers public inline and named scheduling sites as stable
  `deferred-work` definitions, resolves their task and enclosing-definition
  relations, and reports replay-unsafe, floating-promise, missing-scope, and
  explicitly missing-Runtime diagnostics.
  Public deferred work emits `defer.scheduled` and `defer.run` observability
  spans with causal `triggered` edges, one lightweight grouped run when no
  originating Crux run exists, and quiet diagnostics-only internal composition.
  Inline retained tasks flush only after their full graph closes. Named wakes use
  fresh same-trace runs and segments with a causal edge, then flush only after the
  durable outcome commits.
  Devtools Catalog and Runs surface deferred-work kinds, lifecycle states, and
  honest handler-returned streaming notes.
  Provider-neutral serverless hosts live at `@use-crux/core/defer/serverless`
  (injected `waitUntil` / `after` / named-only). `@use-crux/next` binds Next.js
  `after()` as response-finished. Convex bridge runs install a named-only lifetime
  so inline callbacks fail with `DEFER_CAPABILITY_MISSING` while named Runtime work
  remains supported.
  Docs cover host reliability boundaries, completion classes, strict named commit,
  at-least-once edges, cancellation limits, and the distinction from
  `flow.defer()` / future Effects.

  The defer setup contributor now participates in `crux setup`, reporting host
  integration and named Runtime durability readiness without redefining the
  shared `@use-crux/core/setup` contract.
  Deferred intent stores now preserve the first terminal state across memory,
  Postgres, and Convex, and setup distinguishes inline host wrapping from literal
  named-work `durableFinalization: true` capability.

- 64a716b: Stabilize model routing around `router()`, `split()`, `retry()`, `fallback()`, and `cascade()` wrappers with routing receipts, generate/stream support boundaries, and updated adapter docs.

  Breaking routing API changes: router `.with()` and `.select()` are removed in favor of call-site `routing` and `route` options; variadic `fallback(a, b, opts)` is replaced by `fallback([models], opts)`; `_meta.router` / `_meta.cascade` / `_meta.fallback` are replaced by `result.routing`; native OpenAI, Anthropic, Google, and Convex model options now type-reject routing wrappers instead of accepting unsupported values.

  Extend Project Index routing facts, static extraction, native semantic parity, relation policies, and index lints to cover split routes, retry targets, array-form fallback, call-profile model targets, and RouteArgs callback source refs.

  Surface canonical routing receipts in local devtools run detail and Project Index views, including router defaults, split buckets, retry/fallback attempts, cascade budgets, and receipt-backed Turn Decision Report chips.

  Project Index now shows required `RouteArgs` context types and literal route call-profile parameters. Run Detail renders receipt TTFT, bounded attempt errors, and cascade tier note/budget from the same canonical `routing.report` preview.

  Run Detail now accepts the canonical JSON-safe receipt when unavailable routing costs are serialized as `null`, including nested retry, fallback, and cascade cost fields.

  OpenTelemetry span naming now covers all five canonical `routing.*` primitives and no longer treats the `fallback.attempt` edge/name as a primitive.

- 74f27bf: Promote `@use-crux/core/runtime` and its store-adapter contract to stable beta while Crux remains pre-1.0.

  Remove unused Runtime Engine dead port exports, validate `crux.flows.signal()` against the durable flow snapshot before emitting, warn once when a durable target name is re-registered with a different definition, and make production `createRuntimeHandler()` fail closed unless wake request verification is configured explicitly or supplied by the wake adapter.

  Embed delivered event payloads in runtime flow snapshots so flow replay no longer scans the event log after delivery. Store adapters must persist the `payload` field passed to `state.markSnapshotDelivered()`.

  Add Runtime Engine retention config and bounded maintenance pruning for events, terminal work, terminal snapshots, confirmed outbox rows, idempotency keys, settled timers, and settled waiters. The memory, Postgres, and Convex runtime stores implement the new prune contract and conformance coverage.

  Fence Runtime Engine wake commits with lease tokens and heartbeat leases while target code runs. Stale workers now exit cleanly with `LEASE_LOST` instead of retrying, dead-lettering, or overwriting a reclaimed worker's result.

  Add named Runtime Engine composite commits and the optional store-adapter `runComposite(kind, input)` override. Core keeps the default `transact()` runner, and the Convex runtime component now routes composites through one mutation for atomic host-bound commits.

  Run the shared composite conformance cases against Convex's component-backed `runComposite` path, and encode composite Date payloads with Convex-valid object keys.

  Use Convex-compatible filenames for internal Runtime Engine component modules so Convex codegen and deployment can discover them.

  Make `config()` lifecycle-safe by installing one hook layer per active config, replacing the previous active config on repeat calls, and keeping independent layers such as imperative devtools intact when a config is disposed.

  Hard-rename the global hook-store API from the runtime family to the hooks family: `CruxHooks`, `getHooks()`, `setHooks()`, `updateHooks()`, `resetHooks()`, and `mergeHooks()`. The old hook-store names are removed with no deprecated aliases so Runtime Engine terminology can stay unambiguous.

  Rename the Runtime Engine task target factory from `task()` to `durableTask()` and remove the dead task output generic. Project Index runtime target discovery and lint guidance now recognize `durableTask()` declarations. Remove `createConvexRuntimeBridge` from the public `@use-crux/convex` root and package subpath; use `createCruxConvex().run()`, `.storage()`, and `.bridge()` as the single Convex entry point.

  Add `createTestRuntime()` on `@use-crux/core/runtime/testing` for app-level Runtime Engine tests. The harness installs an in-memory runtime hook layer, provides a controllable clock for `flow.after()` and suspend timeouts, and exposes bounded `tick()`/`settle()` helpers without real timers.

  Runtime Engine store adapters now honor the runtime clock when pending work is requeued, keeping `createTestRuntime()` timers deterministic even when the injected clock differs from wall time.

  Bound Runtime Engine outbox dispatch to eight concurrent deliveries by default, add `RuntimeOutboxPort.listByWork()` for targeted orphan recovery, remove shared-counter event append hot spots and the unused `runtimeCounters` table from the Convex runtime component, require namespaces for maintenance scans, and remove `eval.run` plus stale bridge manifest fields from the runtime bridge command contract. Orphan requeue now treats any same-namespace pending wake for the work id as live, even when its idempotency key was refreshed.

  Disable Runtime Engine lease heartbeat timers for Convex host bindings while preserving lease fencing, and make the default heartbeat scheduler a no-op when timer APIs are unavailable.

  Remove unused exported idempotency helpers `flowSignalResumeKey()` and `watchDeliverKey()` from `@use-crux/core/runtime`.

- 58edfa9: Adopt parsed Zod input throughout prompt resolution, run `sanitize` before top-level auto-escape, warn when nested string input cannot be auto-escaped, and collect nested `when()`/`match()`/contributor schemas consistently for prompt input validation.

  Split context resolver memoization from provider cache hints: dynamic contexts now use `memo: { ttl }` for app-side memoization and `cache: true` only for provider cache breakpoints. Prompt definitions now reject duplicate statically reachable entry ids, context memoization requires a dynamic `id`-bearing context, and dynamic context callbacks receive only their declared input fields.

  Provider system adaptations now participate in the typed system block model. In prompt mode, `prependSystem`/`appendSystem` produce `systemBlocks` with `source: "adaptation:<key>"`; prepend adaptations land after the stable cached prefix so provider cache boundaries stay byte-stable. Messages-mode prompts fold the final adapted system text into `messages` without returning parallel `system` or `systemBlocks` fields.

  Tool-name collisions now throw consistently across prompt-time tool sources, with both owners attributed. Skill, context, contributor, blackboard, and prompt-level tools must use unique names; call-site `generate()`/`stream()` tools remain the intentional override path.

  `compilePrompt().inspect()` now runs with quiet observability, instrumentation, and diagnostics ports: it still executes the shared resolver pass and memo-cache path, but emits no spans, artifacts, diagnostics, or cache instrumentation events.

  Harden prompt authoring types for the stable beta surface: `messages` mode is now compile-time exclusive with `system`/`prompt`, `when()` wrapper predicates receive partial context input, `match()` branch input keys are included as optional merged input fields, concrete prompts preserve literal `hasOutput`, and heterogeneous `AnyPromptConfig` remains assignable from precise prompt configs.

  Consolidate custom prompt composition on `contributor()`: remove the public `injectable()` factory and related `InjectableConfig`/`InjectableEntry`/`PromptInjection` exports, rename `ContributorContribution` to `Contribution`, rename `AdapterMap` to `ProviderAdaptations`, and keep primitive-family attribution internal to first-party factories.

  Add portable tool-loop controls to `GenerationSettings`: `toolChoice`, `stopWhen`, `maxSteps`, and the `maxSteps()` / `hasToolCall()` helpers. Core-step adapters honor neutral stop conditions, OpenAI/Anthropic/AI SDK adapters map neutral tool choice to provider-native request fields, and provider-specific tool-control variants move to each adapter's typed `extra` option.

  Make provider prompt caching a stable-prefix contract: cached context blocks now compose before the uncached tail, token budgets can drop only uncached blocks, prompt-level static system text can join the provider cache prefix, `SystemBlock.cacheBoundary` marks the single native breakpoint, and `prompt.budget` artifacts report `prefixOverflow` when the stable prefix exceeds the requested budget.

  Add freshness record metadata for resolved contexts: inspect parts and `context.contribution` artifacts now report live-vs-memo provenance, original resolution time, memo-hit age, and optional segment source facts (`observedAt` / `sourceVersion`) when primitives such as retrievers already provide them.

  Tighten adapter parity and trust behavior: usage metadata no longer fabricates zero-token counts when providers omit usage, forged or mismatched tool approval responses become model-visible denial results instead of thrown errors, agent tool composition avoids prompt type widening, AI SDK call settings pass through to gateway calls, AI SDK structured streams report dropped tool observability through each request's diagnostics, and provider cache boundary conformance now runs across OpenAI, Anthropic, Google, and AI SDK adapters.

  Add adapter contract harness scaffolding for the pre-launch API cleanup: target type assertions, a canonical result validator for shared conformance tests, canonical options fixtures, and headless equivalence TODO rows for the handle/transport phases.

  Nest normalized generation usage details under `inputTokenDetails` and `outputTokenDetails`, preserving no-fabricated-zero usage semantics while exposing cache-read/cache-write/reasoning token classes consistently. Add the portable `GenerationSettings.reasoning` hint and map it across AI SDK, Anthropic, OpenAI, and Google adapters.

  Replace generation `timeoutMs` with structured `timeout` budgets: `totalMs` for the whole managed call, `stepMs` for provider attempts, `chunkMs` for stalled streams, and `toolMs`/`tools[name]` for tool execution. Crux timeouts now reject with typed `TimeoutError`, and loop-runtime step observers use `onStepEnd`.

  Return canonical native adapter result envelopes from `generate()` and `stream()`: accumulated `text`, optional complete `usage`, optional `cost`, `steps`, `finalStep`, provider-neutral `messages`, typed `.raw`, and retained `_meta` for observability. Native streaming now returns `{ textStream, raw, completion }`, with `completion` resolving to the same canonical envelope fields.

  Bring `@use-crux/ai` into the same adapter contract: portable AI SDK call settings now use canonical Crux fields, SDK-native request controls live under `extra`, `generate()` and `stream()` return canonical envelopes with typed `.raw`, and stateless UI-message helpers bridge canonical stream results to AI SDK `useChat` responses.

  Move tool approval policy to composition layers: declare `toolApproval` on contexts, prompts, or call options; tool definitions no longer carry approval policy. Approval resolution now preserves exact-over-wildcard precedence, call-site/prompt/context provenance in inspect output, and the existing suspend/resume token hardening across native and AI SDK adapters.

  Document the `@use-crux/core` stable beta contract in `packages/core/STABILITY.md`, add the `0.4.0-beta.0` changelog entry, and align prompt/context/adapter docs with the stabilized composition, caching, freshness, and tool-control surfaces.

  Add typed per-tool execution context: tools can declare `contextSchema`, callers supply validated `toolsContext` keyed by tool name, and shared `runtimeContext` now threads through tool execution, middleware, and approval-policy callbacks across core and AI adapter calls.

  Expose public adapter codecs and the first headless call handle: all adapters now export `toParams()`/`fromResponse()` translation helpers, and `@use-crux/anthropic` supports `prepare()`/`step()`/`finish()` over the same executor path as managed `generate()`.

  Complete the headless ladder across first-party generation adapters: Anthropic, OpenAI, Google, and AI SDK expose `prepare()` handles, `generate()` accepts typed `transport` callbacks, managed/handle/transport equivalence is covered by adapter tests, and `stream()` with `transport` now fails explicitly with `CruxTransportStreamUnsupportedError`.

  Raise all Crux workspace packages to a Node.js 22 ESM-only contract: package exports no longer include CommonJS `require` conditions, and local skill file loading moved from `@use-crux/core/skill` to the explicit Node-only `@use-crux/core/skill/node` subpath. Replace `import { skill } from '@use-crux/core/skill'` with `import { skill } from '@use-crux/core/skill/node'` anywhere you call `skill.fromFile()`.

  Keep quality signal capture independent from a previously configured observability transport: evaluation cells still capture trace records synchronously, but a stale or hanging forwarding transport no longer stalls quality runs or inflates cell durations.

  Introduce the canonical multimodal message vocabulary: `Message.content` now accepts strings or readonly `ContentPart[]`, `ToolModelOutput` rich content uses `ContentPart[]`, and the old `ToolContentPart`/`media` part surface is removed. Core now exposes the final `text | image | file` content union, `MediaSource`, `textPart`, `contentText`, `messageText`, and `hasMediaParts`; media parts put bytes, URLs, `Asset`, or `Blob` values directly on `source`.

  Make native transcript codecs content-aware beneath the existing public `toParams()`/`fromResponse()` ladder. Anthropic now encodes canonical image and PDF content through one exhaustive part table for messages and tool results, decodes assistant media back into canonical message content, and rejects unsupported media before provider I/O.

  Retire the AI SDK adapter's blind content-array passthrough for recognizable parts: canonical multimodal messages now encode to AI SDK text/image/file parts, native AI SDK `ModelMessage[]` from `convertToModelMessages()` reaches the AI SDK loop without lossy Crux media conversion, and SDK control parts move into `Message.metadata` for canonical result history. The pre-launch v6 `media` compatibility decoder is removed.

  Add native multimodal part tables for OpenAI and Google. OpenAI chat now encodes image, audio, and file data through provider content parts, decodes assistant/user media back into canonical content, and no longer flattens rich tool results with raw base64 text. Google now encodes inline and URI-backed media through `inlineData`/`fileData`, decodes assistant inline media into canonical content, and requires `mediaType` before sending URI-backed parts natively.

  Route guardrails, compaction, memory capture, semantic cache keys, resolver system folding, Convex memory persistence, and OTel message-content export through the canonical `messageText()` projection. Multimodal message previews now use bounded placeholders instead of `[object Object]` or raw base64, and `@use-crux/convex` re-exports the core multimodal content helpers.

  Document the multimodal message layer across the core README, core architecture notes, docs guide, core reference, adapter references, and Convex reference, including the adapter capability matrix and strict/degrade behavior.

  Close multimodal adapter edge cases found during review: AI SDK tool and assistant transcripts now preserve rich content instead of dropping it, Anthropic strict mode applies to tool-result content, OpenAI degrades unsupported audio formats, and tool-result text fallbacks use bounded placeholders rather than raw base64.

  Harden multimodal follow-up edges: AI SDK malformed media parts now warn before being dropped, encode-path unknown parts use request diagnostics, response tool results preserve structured content arrays, large media text descriptors avoid full payload hashing, capture policy redacts reference-only artifacts in off mode, inline data URLs sanitize consistently, and OTel message-content fallbacks continue past empty structured content.

  Introduce the public Asset/AssetStore foundation for multimodal persistence: data, URL, and provider-file assets now share one discriminated union, `inMemoryAssetStore()` provides explicit local persistence, and storage bundles can carry an optional `assets` capability.

  Migrate workspace persistence from the removed byte-store surface to `AssetStore`: `Storage` now uses `assets`, workspaces persist oversized/binary content as data assets, Convex exposes `convexAssetStore()`/`ConvexAssetStoreConfig`, Project Index/devtools storage facts use `storage.assetStore` plus `uses_asset_store` relations, local storage warnings use asset vocabulary, and Project Index cache identities are bumped for the new read model.

  Add safe media-boundary error contracts for the multimodal input pipeline: `InvalidMediaSourceError` reports malformed media source values before provider I/O, and `UnsupportedCapabilityError` aggregates adapter/model capability failures with safe message paths and remediation.

  Activate the final direct message input grammar across core and first-party consumers. `ContentPart` is now the readonly `text | image | file` union with media on `source`; removed helper factories, source-specific variants, degradation settings, and the competing content error no longer ship. Sliding-window persistence now accepts one `Storage` bundle and saves media as asset refs before its message record.

  Lower OpenAI chat media at the shared per-turn request boundary. Managed generation, streaming, call handles, custom transports, and later tool turns now receive equivalent native image/file payloads; OpenAI image detail, MIME, filenames, and provider file IDs are preserved. Known unsupported model/media combinations fail with safe exact paths before any provider request.

  Harden the multimodal boundary before release: data URLs are decoded with bounded allocation, Blob-backed assets remain directly usable, corrective generation repeats the same per-call normalization, OpenAI provider-file audio stays in native file-ID form, ordinary observability emits only private media descriptors, persisted media records are semantically validated, and sliding-window summary plus messages commit atomically.

  Complete direct media input parity for Anthropic and Google language calls. Anthropic now lowers URL/data image and PDF input, preserves supported media cache-control options, and rejects unsupported stable-SDK file IDs before I/O; Google now lowers URL/data/provider-file media to `fileData`/`inlineData`, preserves MIME, filenames, and media-resolution options, and reports selected-model media failures before any provider request.

  Preserve Convex Agent as the media lifecycle owner for `@use-crux/convex`: profile-backed Agent calls now pass native AI SDK image/file parts to Convex Agent, reuse stored Convex file URLs without duplicate Crux asset writes, defer inline media autosave to the installed Agent threshold, and redact media URLs/storage identifiers from memory and observability previews.

  Validate canonical media through provider-owned, side-effect-free hooks after prompt resolution and before native I/O. First-party direct adapters, AI SDK, and Convex Agent now share semantic conformance cases while keeping model support knowledge private to each integration; omitted extensions and capability discovery remain absent from public runtime types and records.

  Sanitize multimodal observability recursively before serialization. Message, tool, result, and error capture now retain only bounded media descriptors with safe scalar facts; raw bytes, Blob contents, base64/data URLs, filenames, bearer references, provider file IDs, and signed URL details cannot reach local transports or OTel message-content attributes.

  Apply the same descriptor allowlist defensively when Crux Local ingests old or untrusted artifact previews, before general retention caps. Devtools recognize retained image/file descriptors and render compact accessible fact labels instead of expandable JSON or raw media viewers.

  Complete OpenAI's native stateless media surface: speech generation now returns immediately usable audio bytes through the shared bounded-operation lifecycle, and supported English audio translation routes to the native translations endpoint. Unsupported speech and transcription controls still fail before provider I/O.

  Add native Google speech generation with typed single- and multi-speaker voices. The operation returns the provider's audio bytes through the shared bounded lifecycle and rejects portable controls Google cannot honor without prompt emulation.

  Expose AI SDK speech as a direct unbound operation alongside image generation and transcription. Custom speech models continue through AI SDK-owned dispatch while Crux preserves native warnings, response metadata, provider metadata, and immediately usable audio bytes.

  Re-export AI SDK image, transcription, and speech operations by exact identity from Convex while leaving the Convex Agent loop, file autosave, thread persistence, and useChat lifecycle unchanged.

  Finalize Anthropic's stable-SDK multimodal boundary: image and PDF input plus rich tool results remain native, audio/video and provider file IDs fail before I/O, and image generation, transcription, and speech remain structurally absent.

  Harden completed-operation option ownership: OpenAI completed speech excludes SSE and translation forwards only translation-native fields; Google keeps Imagen and Gemini extras isolated, defers unknown model IDs to native validation, and requires provider audio MIME; AI SDK speech prevents native extras from shadowing portable fields.

  Make OpenAI transcription and translation extra namespaces mutually exclusive and task-aware at runtime, so an inactive endpoint namespace always fails before provider I/O.

  Account for media in internal message budgeting and compaction metrics without changing the public synchronous text tokenizer. Direct adapters estimate from provider/model identity and already-known asset facts only; unknown media uses a deterministic conservative fallback, invalid provider estimates fail before I/O, and reported provider usage remains authoritative.

  Apply the same private media budgeting path to AI SDK generation and streaming from stable provider/model identity, with a safe fallback reason for custom identities and no direct-adapter dependency. Convex Agent continues to own its native loop and usage accounting without a second rule set or extra model/storage action.

  Define the flat provider-neutral image generation contract: typed Crux prompts lower through the shared resolver, language-only features fail together before provider I/O, native successes normalize to immediately usable ordered data assets, and malformed or empty successes receive a tagged no-image error.

  Add `openai.generateImage()` as one native OpenAI Images API operation, with typed OpenAI controls, native edit support for byte assets, ordered data-asset results, raw response preservation, and unchanged transport errors.

  Expose stateless AI SDK image generation through the injectable gateway, bound `CruxAi`, provider runtime extension, and package-level `generateImage()`, preserving native files, warnings, usage, response metadata, provider metadata, and the raw result without entering the language loop.

  Add `google.generateImage()` through the native Google GenAI `generateImages()` surface, with package-local model/control support declarations, safe preflight rejection, ordered byte results, safety warnings, request metadata, and unchanged provider errors.

  Map Imagen data-asset references and portable masks to Google’s native `editImage` endpoint, expose collision-free `extra.edit` controls, and reject unsupported Gemini masks before provider I/O.

  Complete five-adapter image-operation parity: Convex Agent exactly re-exports the AI SDK function without Agent or storage behavior, Anthropic omits the operation structurally, and tested internal support fixture data projects the OpenAI, AI SDK, Google, Convex, and Anthropic bindings into adapter docs.

  Make conversation compaction media-aware by describing each media part through the configured native generation path before summarizing an ephemeral text-only copy. `GenerateTextFn` now accepts either a prompt or canonical messages plus an output bound, and core sliding windows and Convex compaction share the same optional media controls.

  Define flat provider-neutral transcription contracts with always-present seconds-based segments, tagged semantic-empty failures, storage-free source normalization, and strict result validation. Node adapters share an explicit `@use-crux/core/transcription/node` HTTPS downloader with bounded streaming, redirect and DNS safety, and pinned validated resolutions, while root and neutral transcription entrypoints remain isolate-safe.

  Replace ingest OCR hooks with a readonly application-owned media operations port. File and URL sources now detect common image formats, image files derive ordinary text through one bound generation call, visual-only PDF pages use the same operation with one-page instructions while native text pages remain model-free, and explicitly identified Assets can enter the existing file source pipeline without provider dependencies.

  Add `openai.transcribe()` as one bound native Audio API operation. Crux reuses its storage-free source normalization and secure downloader, maps portable language/prompt controls plus typed OpenAI extras, validates common text and seconds-based segments, warns when timing is absent, and preserves native results and transport failures.

  Expose stateless AI SDK transcription through the injectable gateway, provider runtime extensions, bound `CruxAi`, and package-level `transcribe()`. URL audio always receives Crux's bounded secure downloader, unsupported common mappings fail before I/O, and native segments, warnings, response metadata, provider metadata, raw results, and errors remain intact.

  Complete five-adapter transcription parity: Google uses one composed `generateContent()` call with audio and a fixed transcript-only instruction, returns empty timing arrays, and rejects timestamp requests rather than presenting model-invented timing; Convex Agent exactly re-exports the AI SDK operation; Anthropic remains structurally absent; and an internal all-five fixture locks native, composed, delegated, and absent support expectations.

  Derive ingest documents from MP3, WAV, M4A, OGG, FLAC, and WebM audio through the existing media operations port. Each source invokes transcription once, emits ordinary text parts with explicit seconds locations when timing is valid, preserves only safe language/duration/warnings and StoredAsset refs, strips signed URL data, and carries time provenance into core indexing without retaining audio or provider payloads.

  Complete explicit media derivation in ingest: rename the application-bound semantic operation from `generate` to `describe` with no alias, migrate transcription to the final interval contract, and derive video from caller-supplied visual description, soundtrack transcription, or both. Video evidence records its exact derivation mode, never samples frames implicitly, and preserves soundtrack seconds through indexing and retrieval.

  Extend the existing Quality judge to `JudgeContent` (`string | Asset | readonly ContentPart[]`) while keeping structured outputs selector-driven. Media reaches the bound judge as normal canonical message content, binary outputs are never written implicitly to cassettes or output caches, and media-aware cassette/output identity epochs invalidate stale entries.

  Preserve streamed text in canonical completion content when a provider reports an empty content array, so text, steps, messages, and final-step projections remain lossless.

  Harden Quality media persistence: cell, experiment, and failure snapshots project media to safe descriptors; unknowable Blob identity disables synchronous cache reuse; and both generation and whole-value cassette paths refuse implicit binary or locator-bearing media.

  Preserve allowlisted media source facts through ingest and indexing. Documents and chunks can retain safe HTTPS/path/AssetRef/media-type facts plus validated page or seconds locations, while vector metadata remains source-detail-free and source lifecycle identity remains `sourceId`.

  Replace the pre-v1 flat retrieval-hit `sourceId`/`sourceUrl`/`sourcePath` fields with readonly `source: { id, url?, path?, assetRef?, mediaType?, location? }`. Indexed retrieval, custom retrievers, recipes, rerankers, tools, citations, Quality signals, workspaces, Convex, observability, and devtools now use one structured attribution value without media hydration on retrieval paths.

  Publish the final progressive multimodal guide and fixture-generated five-adapter matrix for chat media, image generation, transcription, explicit AssetStore persistence, media ingest, and attributed retrieval. The public story keeps provider/model support checks adapter-owned and exposes no runtime capability registry or automatic persistence path.

  Make mixed generation output lossless: `GenerateResult.content` is now the authoritative ordered assistant output, `text` is its text-only projection, `steps` exposes ordered step facts, and stream completion buffers exact media, reasoning, tool-call, warning, metadata, and message content without adding live media delta events.

  Unify bounded media operation contracts before provider migration: image generation, transcription, and speech now share required warnings, provider metadata, native/composed execution facts, raw results, cancellation, and total/step timeout vocabulary. Image edits enforce reference-mask and size/aspect-ratio laws, transcription exposes honest segment/word/speaker intervals, generated URLs remain usable without hidden downloads, and the new speech seam returns one explicit data asset.

  Run bounded media operations through one immutable functional lifecycle for normalization, private support preflight, native invocation, result validation, and descriptor-only reporting. Known unsupported routed candidates fail before provider I/O, unknown models reach native validation, total and per-attempt deadlines compose with cancellation, retry/fallback/router/split preserve call counts and original failures, and completed operations remain outside the language/tool loop.

  Index authored media operations and ingest sources through backend-neutral Project Index contracts. Static TypeScript extraction records only proven modalities and allowlisted authored options, preserves named and nested operation structure plus compiler-owned relations, and excludes prompts, locators, references, filenames, provider identifiers, and arbitrary provider options.

  Match those authored media facts exactly in the Rust/Oxc static frontend, including nested ownership and ingest relations. Static cache epoch `static-parse-v61`, Oxc projection identity `crux_native_group3.8`, and native primitive manifest v11 prevent pre-media output from being reused.

  Resolve authored media operations through backend-neutral semantic evidence, including imported and local aliases, routing relations, deterministic misuse findings, and discarded outputs. The TypeScript backend now consumes the shared source profile without rereading local closure files, and semantic cache epoch `semantic-facts-v27` prevents pre-media facts from being reused.

  Match authored media evidence exactly in the TypeScript-Go backend through the complete shared analyzer. Native backend identity `tsgo-native-preview-v2` and runtime identity `native-preview-v2` prevent cached pre-media native evidence from being reused.

  Expose all seven deterministic media lint contracts and preserve safe authored media facts through shared events and the Go Project Index read model. Semantic cache epoch `semantic-facts-v27`, authored media manifest v2, native backend/runtime v3, and Go snapshot epoch 33 prevent stale pre-lint projections after restart.

  Correct Project Index media extraction to follow public `generate(prompt, options)` and `stream(prompt, options)` calls, derive adapter identity only from resolved package/binding provenance, preserve prompt/model-routing relations, and index transcription `task`. Static TS/Rust and semantic TS/native backends now prove exact parity from real package-resolved fixtures; native primitive manifest v11 and defer compiler projection v2 invalidate their structured compiler identities.

  Normalize authored transcription tasks in Project Index and Catalog to `task: 'transcribe' | 'translate'`, including object-form translation requests, without retaining target language or media locators. Bump the Go Project Index snapshot cache to epoch 33.

  Migrate OpenAI, Google, and AI SDK image generation and transcription onto that shared lifecycle without changing their native endpoint ownership. Specialized results now expose the common warnings, provider metadata, execution, and raw tail; provider errors remain unchanged, Convex keeps exact AI SDK re-exports, Anthropic keeps structural omission, and adapter authors can bind future speech definitions without adding persistence or a second loop.

  Preserve provider-native multimodal continuation without leaking opaque state into text or observability: Anthropic redacted thinking, Google thought signatures and assistant media, and OpenAI generated-audio IDs now survive tool loops. OpenAI audio output supports WAV, AAC, MP3, FLAC, Opus, and PCM16 with honest MIME types; AI SDK output accepts every documented media data shape; safety-transformed stream text retains the provider's mixed-content slot ordering.

  Instrument completed media operations with the closed media observability vocabulary (`media.generate_image`, `media.transcribe`, `media.generate_speech`, `media.describe`), allowlisted `media.report` artifacts, and canonical `derived.from` lineage. The shared completed-operation runner emits exact provider/model/execution/call facts, nests composed children such as `generation.call`, and never retains raw media under any capture mode. Safe descriptor `sourceCategory` is the closed union `data | url | provider-file | asset-ref | bytes | blob | unknown` across core, OTel, local retention, and Devtools Runs (data URLs project as `data`; arbitrary tokens become `unknown`). Ingest describe/transcribe derivation links under those primitives; OTel maps media spans to documented `gen_ai.operation.name` values (`generate_image`, `transcribe`, `generate_speech`, `generate_content`) with production text off by default. Devtools Catalog and Runs gain purpose-built media projections, filters, descriptor cards, attempt/composition timelines with provider/model, transcript timelines, complete input→operation→output→ingest/index/retrieval lineage with relationship edges and page/time attribution, and Catalog joins without thumbnails, players, locators, or raw media.

  Publish the complete progressive v1 documentation and fixture-checked five-adapter matrix for every message modality, mixed assistant media, image generation, transcription, and speech. Adapter references and package READMEs now state exact native/composed/structurally absent boundaries, explicit persistence, safe observability, Project Index linting, and framework-owned AI SDK/Convex behavior without adding a runtime capability API.

  Restore Crux Local startup Runtime preflight by validating the complete operation vocabulary in the embedded worker, and move cross-plane injection-state and judge-report presentation into shared Devtools modules so feature dependency boundaries remain enforceable.

  Harden final media privacy edges: Devtools Catalog join labels never derive from `definitionId` (including suffix stripping) and fall back to a fixed generic label when no safe display name is recorded; local retention reconstructs audio/video descriptors with the same allowlist and `sourceCategory` normalization as image/file; Convex Agent message previews emit canonical descriptor-shaped media facts (`kind` + `sourceCategory`) so data URLs stay `data` and never re-enter Core as fake `url` markers.

- 089ba6f: Add the provider-neutral `@use-crux/core/setup` contributor and planner contract
  and the aggregate `crux setup` check/apply/JSON workflow. Runtime setup now
  participates as a contributor through that single setup command.
  Unhealthy reports exit nonzero, contributor failures remain isolated and
  privacy-safe, and apply reports retain planning and adapter-reported failures.

### Patch Changes

- cd3e235: Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.

  Harden Quality determinism by adding explicit cache identity epochs, including structured-output schemas and tool parameter schemas in cassette keys, including case input, prompt, params, dataset content, and scorer identity in output-cache/baseline fingerprints, failing loudly on corrupt committed baselines, and rejecting invalid scorer values instead of aggregating them.

  Make Quality artifact writes atomic and safer under concurrent runs: cassette recording now single-flights duplicate misses, flushes merge with on-disk entries under a lock, timed-out cells quarantine late trace/cassette writes, and local read-model records write via temp-file rename.

  Harden judge-backed scoring by pinning judge generation settings, framing untrusted output/reference/context in judge prompts, stamping judge provenance on score metadata and baseline identity, and adding human-label plus judge-report tooling for judge-vs-human agreement.

  Structured judge inputs are serialized before prompt framing, so Safety's judge-backed constraints can evaluate object-shaped outputs without losing fields or throwing during escaping.

  Harden the Quality local pipeline by making `crux eval run --json` emit a single run summary object, adding worker/core protocol version checks and run-scoped event ids, surfacing worker crashes as structured exit-2 failures, fixing live read-model collisions and source-frame path containment, reporting skipped legacy records, and requiring an explicit devtools promotion variant.

  Quality observability capture now uses an observability-owned hook registry, preserving run-scoped trace capture without importing Node-only Quality internals into platform-neutral runtime bundles.

  Add the Quality machine contract surface: `@use-crux/core/eval/schemas` exports validation schemas and JSON Schema generation for records and CLI JSON, experiment records embed agent-readable `failures` artifacts, and `crux eval diff <expA> <expB> --json` compares saved experiment records through core-owned diff policy.

  Add the Quality adoption path: `crux eval init` scaffolds first evals for uncovered prompt definitions, `crux eval import-traces` converts retained local traces into JSONL dataset rows, and dataset-backed failures now surface dataset path plus content fingerprint in persisted records, run summaries, failure artifacts, and experiment diffs.

  Add the Quality agent loop: `crux eval run` now supports `--failed`, deterministic `--sample`/`--seed`, `--max-cost`, and `--changed-since` subsets, `crux eval mcp` exposes list/run/show/diff/evidence/judge-report/label tools over MCP, and `crux eval init` scaffolds a local Quality skill for coding agents.

  Declare Quality beta: the authoring surface, experiment/manifest schemas, CLI JSON outputs, and exit codes are stable within 0.x minors; future breaking changes require a minor bump and migration note while the first-party runner facade remains internal.

  Finish Quality Project Index parity for beta: native static extraction now treats `afterScores` assertions as evaluation-level `ctx.expect()` sites, evaluation definitions expose catalog facts for devtools chips, spec experiment records enrich `evaluation:*` and covered definitions in the local read model, and `crux eval init` discovers uncovered targets from Project Model evidence before falling back to config exports.

  Complete Quality observability coverage by removing the unused `quality.snapshot` artifact kind, emitting `baseline.promotion` artifacts on successful promotion, emitting diff-mode `comparison.report` artifacts from core experiment diffs, and forwarding `quality diff` events into local activity.

  Make the Quality machine contract operable from the UI: devtools serves `GET /api/quality/judge-report/{evaluationId}` and `GET /api/quality/experiments/diff?a=&b=` (the latter runs the core diff op in a worker), the experiment read model surfaces core-owned `failures` artifacts, and the workbench renders fix-surface chips that deep-link to the covered definition, a Failure Artifact panel with dataset provenance and cassette id, Pass/Fail cell labeling, a judge-trust panel (agreement, confusion matrix, kappa, disagreements), and an experiment Compare picker with a per-score/per-case diff and a drift banner. The TUI shows fix-surface letters on failing cells, the dataset fingerprint, and a CLI hint for the judge-report and diff views.

- 2ab4bd9: Promote Safety to its stable beta boundary model. Guardrails and constraints now author through `{ id, on, run }` with typed `boundary.*` targets, duplicate policy ids fail fast, `safety.tune` controls per-call posture, structured-output rewrites keep returned text/object synchronized, and Safety audit/error/observability records are safe-by-default.

  Streaming guardrails now protect ordinary output streams by default through sentence-gated checks, explicit final/disabled modes, bounded hold behavior, and the AI SDK stream bridge preserves policy-terminal completion errors without unhandled rejections.

  Add the provider-agnostic Safety strategy pack (`guardrail.pii`, `guardrail.secrets`, `guardrail.injection`, `guardrail.classifier`, `constraint.judge`, `constraint.citations`, and `toolPolicy.*`), Project Index Safety facts/lints, Devtools Safety intervention surfacing, and updated docs with migration notes plus beta roadmap RFC links.

- aa37b64: Add runtime-backed `workspace.watch()` subscriptions for durable create, update, delete, and rename events, including cursor polling, unsubscribe, and transaction-aware event emission.

  Classify `workspace.watch()` as read-style Project Index data access and bump local/indexer cache identities so existing snapshots do not mask the new facts.

  Update local devtools workspace read models so deleted files are removed from the tree and observed rename/move operations update the visible destination path.

  Render `watch` as a recognized read-style Project Index data-access operation in the devtools intelligence panel.

- Updated dependencies [fd6edcc]
- Updated dependencies [37ebe22]
- Updated dependencies [cd3e235]
- Updated dependencies [0c3ba08]
- Updated dependencies [64a716b]
- Updated dependencies [74f27bf]
- Updated dependencies [2ab4bd9]
- Updated dependencies [58edfa9]
- Updated dependencies [089ba6f]
- Updated dependencies [aa37b64]
  - @use-crux/core@0.5.0

## 0.4.0

### Minor Changes

- cdc9c16: Remove the old direct flow executor surface from `@use-crux/core`; `flow()` handles are now the only public flow authoring API.

  Flow input is now inferred from the handler's second parameter. Input-bearing handles expose `run(input, options?)`, no-input handles expose `run(options?)`, and suspended flows resume through `resume(flowId, options?)`.

  Flows can now declare local typed signal maps with `flow(name, { signals }, handler)`. Signal schemas type both `flow.suspend('name')` and `handle.signal(flowId, 'name', payload)`, and `noPayload()` declares notification-only signals.

  Declared signal schemas now validate payloads before `handle.signal()` writes to persistence and again when `flow.suspend()` delivers a stored signal during resume.

  Invalid declared signal payloads now throw `InvalidSignalPayloadError`, allowing callers to distinguish payload contract failures from flow lifecycle control errors.

  Resumed flows now persist terminal lifecycle metadata when they complete, cancel, or expire. Terminal snapshots are retained for inspection and listing, but `completed`, `cancelled`, and `expired` snapshots cannot be resumed again.

  Delivered flow signals are now consumed after validation and replayed from the flow snapshot for earlier suspend points, preventing stale pending signals from satisfying later waits.

  The Project Index now records local flow signal names and emits lint findings for duplicate literal `flow.suspend()` names and literal suspend names missing from a local signal map.

  Flow step labels are now enforced as durable replay identities. Duplicate labels throw at runtime, the Project Index records ordered step label metadata, and linting reports duplicate literal `flow.step()` labels.

  Flow lifecycle control errors thrown inside `flow.step()` now bypass step retry and fallback handling, preserving suspend, cancel, and expire outcomes.

  Persisted flow input, step outputs, signal payloads, and terminal snapshot metadata are now validated as JSON-serializable before flow state is written.

  Convex flow actions now start and resume through the accepted core `run(input)` and `resume(flowId)` handle APIs. Convex flows can also declare local signal maps, and `.signal()` validates declared payload schemas before writing a pending signal or scheduling the resume action.

  Refresh OTel package README wording to describe `flow().run()` spans.

- 4b29d0c: Add the `@use-crux/core/runtime` subpath with Runtime Engine port contracts, typed runtime diagnostics, wake envelope validation, retry helpers, the pure work state-machine surface, kernel composite operations, outbox dispatch, the in-memory runtime store, and the `@use-crux/core/runtime/testing` conformance suites for adapter authors.

  Add the first Runtime Engine composer surface: `node()` for in-process local/test execution, `createRuntime()` for resolving composers with targets, store-backed timers and maintenance, cancellation, scoped-idle counters, and the standard `RUNTIME_REQUIRED` diagnostic factory.

  Wire existing flow handles into the Runtime Engine: runtime-backed `flow.suspend()` snapshots, reserved signal events with automatic resume from `FlowHandle.signal()`, `{ resume: false }` plus runtime-backed `FlowHandle.resume(flowId)`, replay fingerprint drift blocking, and delivery recording for multiple waiter events that arrive before replay.

  Add the flow runtime API layer: runtime-only executable `task()` targets from `@use-crux/core/runtime`, `flow.waitFor()`, barrier-buffered `flow.defer()` and `flow.after()` durable effects, scoped `flow.untilIdle()`, and name-bound `crux.flows.signal/resume/cancel`.

  Add `@use-crux/postgres/runtime` with a durable Postgres Runtime Engine store adapter, additive setup check/apply support for the Crux-owned schema, and real-Postgres conformance coverage gated by `CRUX_TEST_DATABASE_URL`.

  Add the HTTP wake layer for serverless Runtime Engine deployments: `createRuntimeHandler({ targets })`, `serverless({ store, wake })`, `genericQueue()`, and `@use-crux/upstash/runtime` `qstash()` wake delivery with QStash signature verification.

  Add host-bound Runtime Engine declarations and Convex runtime entry helpers: `RuntimeEngineDefinition` now distinguishes in-process and host-bound runtimes, `bindHostRuntime()` composes host bindings through the shared kernel path, `RUNTIME_HOST_ONLY` reports runtime use outside a required host, and `@use-crux/convex/runtime` exposes `convex()` plus `createConvexRuntimeHandlers()`.

  Add Runtime Engine artifact generation: the indexer can discover runtime flow/task targets, emit deterministic `.crux/generated/runtime/manifest.json` plus readable Next and Convex entry files, expose drift preflight helpers, and `withCrux()` can regenerate artifacts during Next builds.

  Add Runtime Engine operator tooling: `crux runtime setup`, `status`, `inspect`, `retry`, and `cancel` now route through the local worker, use typed runtime diagnostics, support JSON output, and preflight generated artifacts against durable runtime state.

  Harden Runtime Engine delivery and adapter parity: scheduled wake rows now honor `notBefore`/retry delays end-to-end, runtime-backed flows preserve object-bound replay semantics for errors, cancellation, resume options, and repeated suspend labels, Convex handler/component boundaries validate and encode runtime payloads consistently, and cross-adapter conformance now covers retry source-status guards, waiter matching, and idle-counter invariants.

  Tighten runtime artifact and handler DX: generated entry files are host-specific and marker-protected, target exports are validated before manifest generation, `withCrux()` runs during Next config evaluation for Webpack and Turbopack, unresolved name-only handler targets now fail with `TARGET_NOT_FOUND`, and malformed wake envelopes return terminal client responses instead of queue poison loops.

  Add Project Index runtime lint rules for durable target identity, exported targets, runtime API use without configured runtime support, closure-based defers, nondeterministic flow bodies, and non-serializable deferred payloads, with docs metadata and native lint parity.

  Expose bounded Runtime Engine inspection reads for work, timers, and outbox state so local tooling can show runtime status details without mutating durable state.

  Move the Postgres adapter's `pg` client to a caller-controlled peer dependency while retaining it as a repo dev dependency for tests, and refresh the package homepage to a live source URL.

  Add the Runtime Engine documentation set: core runtime reference, runtime deployment guides, recipe-only adapter mappings, package references for Postgres/QStash/Convex runtime surfaces, runtime lint navigation, and per-code Runtime Engine error pages.

  Fix final Runtime Engine hardening gaps: wake delivery now rechecks leased work before execution, null waiter payloads replay correctly, manual resume/retry keys are unique per invocation, runtime status counts use adapter-owned counting instead of silently truncated list samples, Postgres setup checks validate required columns, Convex component status queries avoid unindexed full-table scans, runtime artifact host detection no longer guesses from raw config text, and `runtime.missing_runtime_config` now runs in production Project Index lint paths without claiming native parity.

  Close follow-up Runtime Engine review gaps: Project Index snapshots now cache runtime-config presence for linting, destructured flow-scope runtime APIs retain TypeScript/Rust parity, manual resume/retry keys include an isolate nonce, delayed wake rows dedupe duplicate `notBefore` reschedules, Convex status counts stay under a bounded read budget, Convex outbox confirmation retains rows like other adapters, and Postgres setup column checks are covered by DDL parity tests.

  Finish the review-tail hardening: outbox duplicate suppression no longer hides legitimate re-enqueues while a row is being dispatched, maintenance re-enqueues orphaned pending work, config-load failures no longer produce false missing-runtime lint findings, status count truncation is surfaced in CLI and devtools, and runtime artifact preflight now uses the worker-owned stale-target result instead of duplicating status rules in the CLI.

  Complete native Project Index parity for runtime task targets and missing-runtime linting so the Rust/Oxc production path matches the TypeScript baseline.

  Fix npm release staging so exported package subpaths, including `@use-crux/core/runtime`, are typechecked through their declared public entry files.

  Make the public Runtime Engine barrels isolate-safe for Convex and edge-style bundlers by moving custom wake HMAC signing/verification to WebCrypto, run the Convex runtime store through the shared adapter conformance suite with declared substrate-atomic exclusions, and keep caller-provided Convex event IDs from colliding with internal event cursors.

  Improve Convex runtime generation DX: `crux dev` now refreshes runtime artifacts on startup and watched source changes, generated writes are idempotent, Convex no longer emits a top-level `convex/crux.ts` shim, generated target imports run behind a Node action boundary via `@use-crux/convex/runtime/node`, and Convex-native `flow()` handles can execute as generated Runtime Engine targets.

  Fix Convex direct flow starts under `createCruxConvex().run()`: core runtime-backed flow APIs now resolve host-bound declarations through an active request-scoped host binding, and the Convex profile bridge installs that binding before user code starts runtime-backed work.

### Patch Changes

- 78592f0: Harden Memory namespace handling and capture scheduling: dynamic proposal operations now resolve from input, synchronous tool collection throws clear errors for async namespaces or async block tools, and `memory({ capture: { mode } })` is available with `processing` kept as a deprecated alias.

  Align Memory store adapters with the beta `RecordStore` contract: `@use-crux/core` now exposes a reusable store conformance helper for adapter tests, deprecated private `memory/types` store aliases point to `RecordStore`, and the Upstash adapter supports page-shaped Convex component lists with decoded filtering and hydrated vector search metadata.

  Add the canonical Storage Beta type surface at `@use-crux/core/storage`, including `RecordStore`, `RecordEntry`, `RecordPage`, `RecordWriteOptions`, exact scalar filters, discriminated vector queries, `{ records, vectors, blobs }` bundles, and typed `StorageError` codes.

  Harden the in-memory Storage Beta adapters: record stores now validate JSON and TTL inputs, apply lazy TTL and exact null-aware filters, vector stores validate dense/sparse queries and pre-filter metadata correctly, blob stores expose `head`/delete lifecycle behavior, and `@use-crux/core/storage/testing/vitest` provides reusable record/vector/blob conformance suites.

  Move core workspace, indexing, retrieval, indexed knowledge, embedding cache, and semantic cache consumers onto Storage Beta `records`/`vectors`/`blobs` configuration, with vector-backed search requiring pre-filter-capable vector stores.

  Expose Convex and Upstash Storage Beta adapters: Convex now provides `convexRecordStore`, dense-only `convexVectorStore`, `convexStorage`, and a full-lifecycle workspace blob store; Upstash now provides a SCAN-backed Redis `RecordStore` and a stricter Vector `VectorStore` that validates filters, wraps backend errors, and reports conservative capabilities by default.

  Harden Memory capture and proposal review: adapter-bound memory capture now preserves settled tool results and errors when available, proposal approve/reject/edit operations are pending-only to prevent duplicate writes, and proposal write observations include flattened source metadata.

  Make Memory rendering predictable under token pressure: `budget.maxTokens` is now enforced for memory contexts and individual blocks, and extractive memory blocks support explicit list/recent and semantic render strategies.

  Expose Memory beta behavior in observability and Project Index surfaces: budgeted memory rendering now emits inspectable `memory.read` observations, static memory extraction records capture mode, budgets, render strategies, and retention metadata, and devtools memory details can show indexed episodic retention policy.

  Expose Storage Beta in Project Index facts: static extraction now records record/vector/blob store definitions, storage bundles, scoped storage, storage dependencies on retrievers/workspaces, and matching Rust/Oxc native parity.

  Resolve Storage Beta Project Index facts semantically: TypeScript and native semantic backends now agree on storage aliases, imported stores, config object indirection, bundle composition, scoped storage, and retriever/workspace storage relations.

  Surface Storage Beta in Crux Local and devtools: local Project Index payloads now include privacy-safe storage summaries, component usage, warnings, lint findings, cache replay support, and devtools storage inventory/detail panels.

  Refresh Storage Beta docs and public JSDoc so `RecordStore`, `VectorStore`, `BlobStore`, `{ records, vectors, blobs }` bundles, adapter capability claims, and devtools storage inspection are documented as the primary public storage path.

  Refresh Memory beta docs and public JSDoc so capture modes, render strategies, budgets, strict proposal review, retention metadata, and the `RecordStore` adapter contract are documented from the exported API surface through the user guides.

  Polish Memory beta inspection surfaces: local devtools memory details now expose capture mode, memory and block budgets, block render strategies, write/proposal mode, and retention metadata from the Project Index; run detail memory spans surface render-budget decisions and proposal status; docs include concrete memory observability record examples.

  Keep native indexing in parity for Memory beta metadata: Rust/Oxc static extraction now carries the same capture mode, budget, render strategy, disabled-render, write mode, and retention fields as the TypeScript extractor, with semantic backend parity fixtures covering the beta syntax.

- dcee4fa: Introduce the Retrieval & RAG stable beta public API spine at `@use-crux/core/retrieval`, including `knowledgeBase`, named `retrievalRecipe`, typed retrieval steps, canonical `RetrieveRequest`, schema-derived metadata filters, recipe traces, and grounding/tool integration types.

  Wire `knowledgeBase` lifecycle methods to the existing indexing, corpus, indexed-knowledge, storage, and retriever primitives. Knowledge bases can now index, reindex, remove sources, create namespace-scoped handles, retrieve through store-backed indexes, and inspect lifecycle/storage capability metadata.

  Implement the named single-retriever `retrievalRecipe` runtime. Recipes now execute typed steps, expose `.retrieveWithTrace()` and `.asRetriever()`, capture failed-step traces, run fanout with bounded concurrency, keep score history in structured hit provenance, support recipe-level and per-step models, emit recipe/step observability spans, and replace the old internal pipeline/stage modules.

  Add federated `retrievalRecipe` sources. The built-in retrieve step now accepts multiple retrievers or weighted source entries, runs source/query retrieval concurrently, fuses cross-source hits with structured per-source provenance, supports `fail` and `skip-with-warning` source failure policies, and records per-source retrieve attribution in recipe traces.

  Add session-backed grounding and typed retrieval tool payloads. Grounded citation validation now accounts for both injected and tool-discovered hits without parsing tool strings or closing over mutable hit arrays, retrieval tools return lean structured `crux.retrieval.hits` payloads with model-facing renderers, and `getSource` can read discovered session hits or active store-backed indexed chunks with explicit visibility.

  Add Retrieval/RAG storage conformance coverage and Convex profile mirroring. Core now exposes a vector-store conformance suite that verifies namespace filtering, delete and sparse/hybrid capability claims, and indexed-knowledge hydration diagnostics; hydration misses now fail with `RetrievalRunError("hydration_miss")` instead of silently returning empty results. `@use-crux/convex/retrieval` mirrors the core retrieval API with Convex runtime storage defaults for `knowledgeBase()` and store-backed `retriever()`.

  Add provider-agnostic RAG evaluation metrics to the Quality system. `scorers.rag.*` now includes deterministic recall@k, MRR, expected source coverage, context precision, citation validity, and trace-shape snapshot scorers, and `evaluate()` can run retrieval recipes directly or through `target.recipe()`. New retriever spans emit the beta `retrieval.retrieve` observability primitive.

  Document the stable beta Retrieval/RAG surface around knowledge bases, retrievers, recipes, grounding sessions, typed retrieval tools, and Quality-based RAG evaluation. `knowledgeBase().grounding()`, `knowledgeBase().recipe()`, and `retrievalRecipe().asGrounding()` now delegate to the functional retriever/recipe/grounding runtime paths.

  Add the shared reranking contract and adapter bindings for the beta recipe surface. Core now exports `Reranker` and `judgeReranker()`, `rerank()` accepts custom engines, `@use-crux/ai` binds native AI SDK reranking, and the Anthropic, OpenAI, and Google adapters expose matching `retrievalModel()` and judge-backed `reranker()` factories on their adapter instances. Devtools and Project Index now understand beta retrieval recipe/step primitives while keeping historical pipeline/stage compatibility.

  Promote `reranker()` to an index-visible RAG primitive. Static, semantic, native, and local Project Index paths now emit `rag.reranker` definitions, `rag.recipe.step.uses_reranker` relations from `rerank({ engine })` recipe steps, and a cache epoch migration for the updated static output. The experimental indexer authoring API also exposes ordered object-or-helper config readers so mixed recipe step arrays keep authored order. Devtools renders rerankers as first-class catalog nodes, shows authored recipe steps and step dependencies in the recipe hero, and the built-in `rag.recipe_step_unresolved_target` lint surfaces recipe step dependencies that cannot be resolved to indexed retrievers, scorers, or rerankers.

- 41cf753: Fix workspace blob text/JSON read-back, byte-windowed text reads, globstar listings, bounded manifests, list limit pushdown, and privacy-safe workspace path hashes in OTel attributes.

  Add per-call workspace namespace overrides for direct methods and manually created tools, tighten generated workspace tool map types, and allow write tools to accept JSON arrays and scalar JSON values.

  Add filesystem-style workspace operations for `exists`, `stat`, `append`, `rename`/`move`, `copy`, and `grep`, plus default generated `renameWorkspaceFile` and `grepWorkspace` tools.

  Add the workspace artifacts facet with draft/final status, artifact kind metadata, finalization, artifact queries, download references, provenance capture, and manifest deliverables.

  Add workspace retention and quota controls with TTL passthrough for supporting stores plus `maxFileBytes` and `maxNamespaceBytes` write-time guards, and document the complete V0 workspace surface.

  Expose V0 workspace activity in local devtools, OTel, and Project Index: workspace OTel spans now use workspace-specific operation/path-hash attributes, devtools preserve privacy-safe path-hash labels and artifact metadata, and Project Index facts include workspace operator config, generated tool posture, and exact V0 workspace data-access operations.

  Harden V0 workspace filesystem and artifact edge cases: filesystem mutations now share write-limit and retention enforcement, `move` is distinct from `rename` in operation metadata, glob/list/grep reads respect mount access, and artifact observability avoids raw workspace paths.

  Add source-backed workspace mounts for virtual provider roots. `read`, `list`, `grep`, `exists`, and `stat` can now delegate to custom or retriever mount sources, retrievers can also be adapted with `retrieverWorkspaceMountSource()`, prompt context includes can read virtual files without copying bytes into the workspace store, local copies can materialize readable virtual text/JSON files, unscoped grep searches source-backed mounts, and custom source mounts can opt into provider-backed `write`/`edit`/`append`, provider-destination `copy`, and `delete` hooks when mounted with `access: "readwrite"`.

  Tighten source-backed mount correctness: copied string JSON now stays JSON, missing or truncated source reads fail instead of silently materializing partial local copies, provider write read-backs tolerate eventual consistency, fallback grep uses bounded source listings, retriever-backed limits apply after filtering, regex grep rejects risky patterns, and workspace JSON value guards now reject non-finite, cyclic, and non-plain values.

  Expose source-backed mount shape in Project Index and devtools: static/native and semantic/native analysis now preserve custom, retriever, helper, and capability metadata for workspace mounts, and local devtools show authored source-backed mounts even before runtime workspace events occur.

  Add `Workspace.transaction()` for staging multi-file workspace changes and committing touched paths together over the generic `RecordStore` contract, with README and docs coverage. Transaction callbacks get a restricted workspace surface with staged read-your-own-writes behavior; callback failures discard staged changes, observed commit failures roll back touched live paths, and source-backed mount mutations fail before provider hooks run.

  Expose `Workspace.transaction()` in Project Index data-access facts and workspace observability so source intelligence, semantic parity checks, and devtools activity can treat transaction calls as workspace writes.

  Add `StaticObjectReader.callName()` so Indexer Extensions can distinguish direct helper calls from identifier-backed references in object config metadata.

- 8927775: Add workspace versioning & history. Every content change (`write`, `edit`, `append`, `undo`) appends an immutable, append-only version, so destructive edits are recoverable without opting in beforehand.

  New `Workspace` methods: `history(path)` (newest-first revisions), `read(path, { version })` (read an older revision), `diff(path, { from, to })` (git-style unified-diff string plus structured hunks), and `undo(path)` (restore the previous version as a new version — history is never rewritten). Blob-backed content uses version-scoped blob keys so older revisions are never clobbered.

  Retention is unlimited by default; `versioning: { maxVersions }` bounds how many revisions are kept per file and GCs the oldest snapshots and their blobs. The `undoWorkspaceFile` tool is opt-in via `tools: { undo: true }`, like `deleteWorkspaceFile`. `rename`/`move`/`copy` start fresh history at the destination path, and `delete` purges a file's history.

  Each recorded version emits a single privacy-safe observability marker (path hash, version number, and operation only — no paths or content). Local devtools reconstruct a file's version timeline in the inspector's Versions tab from these markers, counting one entry per content change even though an `edit`/`undo` performs a nested write internally.

  `finalize()` now pins the current version as the published artifact (exposed as `WorkspaceArtifact.version`). Editing a finalized file creates new draft versions, but `artifacts()` and the manifest keep surfacing the pinned revision until `finalize()` is called again — the publish-a-snapshot model. `read()` returns the live working copy, while `read(path, { version })` is the general snapshot API for reading any retained revision, including but not limited to the pinned published version.

  Project Index workspace analysis now also surfaces `versioning.maxVersions`, the generated `undoWorkspaceFile` tool posture, and exact `history`/`diff`/`undo` data-access operations across the TypeScript static extractor, Rust/Oxc static frontend, and TypeScript/TSGO semantic backends.

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
