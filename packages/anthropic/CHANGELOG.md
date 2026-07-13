# @use-crux/anthropic

## 0.5.0

### Minor Changes

- 37ebe22: Promote `@use-crux/core/observability`, `@use-crux/otel`, and the local Go observability read model to stable beta, replacing process-local reliability assumptions with an explicit multi-invocation contract. See ADR 0002 for the full rationale.

  Cut the graph record wire/storage contract over to schema v2 only (`runId` for the logical operation, `traceId` for distributed correlation, and `segmentId`/`segmentSeq` for one physical process/isolate/invocation). There is no v1 compatibility window: on first startup against the new schema, the local Go backend transactionally discards pre-v2 observability rows, which carry no truthful execution-segment identity, and rebuilds automatically. Every other local table is untouched and no manual `.crux` deletion is required.

  Add explicit lifecycle ownership for suspend/resume: `run.suspend({ reason })` ends the current segment and returns a serializable `CruxPropagationCarrier`, and `observe.resumeRun(carrier, { reason })` opens a fresh segment on the same logical run and emits `run:resume` before any child record. `observe.withContext()` remains context-only and can no longer be mistaken for a resume/suspend/end mechanism. Flow suspension and Convex swarm turns now use this shape instead of persisting a captured context and calling an implicit end.

  Make delivery lossless and per-record. The transport now inspects an indexed disposition (`accepted`/`rejected`, with a `retryable` flag) for every sent record instead of trusting `response.ok`; a malformed or partial receipt retries every unaccounted-for record. `recordId` identifies immutable content: an exact duplicate is accepted idempotently, and a conflicting payload under the same id is rejected and diagnosed rather than silently overwriting the original.

  Add a framework-neutral host lifecycle port (context/defer/deadline) with first-party bindings: Node (`withNodeObservableInvocation`), generic serverless (`withObservableInvocation`), Cloudflare Workers (`withWorkersObservableInvocation` from the new `@use-crux/core/observability/workers` subpath, using `ExecutionContext.waitUntil` with no `nodejs_compat` requirement), and Convex (`createCruxConvex()`/`action`/`internalAction`/agent/swarm wrappers, bound automatically). Every wrapper reports a structured `ObservabilityFlushResult` (`status`, `delivered`, `rejected`, `remaining`, `deadlineExceeded`) instead of a boolean; pass `onDrain` to inspect it. The Convex default flush bound drops from 20 seconds to a fixed 3-second window, since Convex exposes no per-invocation deadline API — existing callers relying on the old window should inspect `onDrain` or pass an explicit timeout.

  Remove the stream-finalizer grace timer. Only a stream's own terminal signal (drain, early return, or throw) ends its span, immediately, with stream-derived metrics; a late or never-arriving provider completion attaches as a linked `usage.observed` event/artifact and can never reopen the span or change its recorded duration/status.

  Build a real active OTel execution bridge in `@use-crux/otel`: `withTelemetry()` now activates the SDK span around the actual instrumented callback (`trace.getActiveSpan()` resolves correctly inside real work, nested spans parent correctly), maps `run:suspend`/`run:resume` correctly instead of crashing the subscriber on those record types, and starts a fresh root span sharing the original `traceId` on resume rather than reopening a stale one. Add W3C `traceparent`/`tracestate` inject/extract helpers and an explicit `baggageAttributeAllowlist` (nothing copied by default). `observe.flush()`/`observe.shutdown()` now also force-flush the installed telemetry manager's exporter/processor work, bounded by the host lifecycle port above.

  Add one revisioned Go Runs read model (`/api/observability/runs/page`, `/api/observability/runs/delta`) that joins observability and Quality server-side through an explicit correlation field, bumping a monotonic revision per affected run inside the same ingest transaction it publishes after commit. The page envelope is the sole Runs list HTTP surface; web DevTools, Global Search, and local TUI/CLI clients all consume it instead of a separate bare-array route. Fix a duplicate-`recordId` conflict path that previously let a second, different payload overwrite immutable raw content, and fix a Quality/observability correlation bug that could key an unrelated run's feedback/score data onto the wrong run's `traceId`/`runId` collision.

  Move DevTools Runs and run detail onto that one read model: delete the client-side merge of a Quality-terminal row list and a separately-fetched observability-running row list, add truthful `suspended`/`incomplete`/`conflicted` status and `unknown`/`healthy`/`degraded` delivery-health rendering, and gate WebSocket invalidation on the published revision so a reconnect performs a bounded catch-up instead of an unconditional refetch or stale cache.

  Attach bounded `DefinitionRef[]` evidence to observability records so every directly-observed Project Index definition kind joins directly to its canonical definition without stack or name guessing: prompt, context, tool, agent, flow, retriever, blackboard, and composition, plus routing (`router`/`split`/`retry`/`cascade`/`fallback`), skill, guardrail, constraint, task, workspace, memory, and the retrieval `rag.recipe`/`rag.reranker` families. A closed `DirectlyObservedKind → DefinitionRefRole` map is checked against the coverage manifest at compile time, so a new directly-observed kind cannot ship without a canonical ref. Anonymous or non-authored spans omit the ref rather than guess. Composition APIs already require an authored `id`; the random per-execution `compositionId` remains a separate execution identity.

  Extend that join to canonical runtime contributors and executed children: knowledge bases, tool policies, flow steps, parallel branches, recipe steps, and authored scorers now attach their own role-specific refs when the runtime genuinely holds their authored identity. Other structural children use explicitly parent-derived Catalog activity—“parent ran; this child is not independently observed”—while static-only kinds remain truthful zero-runtime states. No identity is inferred from a display name.

  Make recipe reranking authored-id-required so `rag.reranker` runtime evidence is truthful and collision-free: `rerank()` now takes a required, named `engine` (there is no anonymous default-model judge path), and `judgeReranker()` requires a `name`. Build the engine with `judgeReranker({ name, model })` or an adapter `reranker()` and pass it to `rerank({ engine })`. The engine's `name` is the canonical `rag.reranker:<name>` identity.

  Project those references transactionally into a rebuildable local runtime-activity overlay and add revision-aware Runs filtering by canonical definition id. The overlay follows run deletion and retention, reuses the existing observability revision stream, and never stores a denormalized Project Index snapshot.

  Normalize completed generation outcomes across `@use-crux/openai`, `@use-crux/anthropic`, `@use-crux/google`, and `@use-crux/ai` into closed `CruxFinishReason` and `CruxProviderError` / `CruxAdapterError` shapes (`kind` / namespaced `code` / `retryable` / optional redacted `message`). Stream completion failures surface instead of silent missing metadata; completed tool calls are assembled for both `generate()` and `stream()`; progressive tool-call argument deltas are not exposed. Abort and budget timeouts classify as `aborted` / `timeout`. `retryable` is classification only — SDK clients keep their own network retries.

  Finish Catalog Observability sections and View Runs for every definition kind via the coverage manifest, add Run Detail → Catalog links for all `DefinitionRef`s (including unresolved since-deleted ids), and share one delivery-health presentation (`unknown` / `healthy` / `degraded`) with plain-language status copy for `suspended` / `incomplete` / `conflicted`. Quality signal capture follows nested `triggered` child runs so flow step matchers are not falsely uncaptured under an `eval.case` cell.

  Keep Catalog activity truthful for runtime-observed primitives that do not yet carry authored definition identity. Deferred work, media operations, and ingest sources remain visible in Runs and Run Detail, while their per-definition Catalog sections explicitly report that runtime evidence is not joined and never fabricate activity counts or View Runs links.

  See ADR 0003 for the durable definition↔runtime join and adapter-outcome decision record.

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

### Patch Changes

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
