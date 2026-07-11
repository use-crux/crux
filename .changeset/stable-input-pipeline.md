---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/anthropic": minor
"@use-crux/convex": minor
"@use-crux/devtools": minor
"@use-crux/google": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
"@use-crux/otel": minor
"@use-crux/openai": minor
---

Adopt parsed Zod input throughout prompt resolution, run `sanitize` before top-level auto-escape, warn when nested string input cannot be auto-escaped, and collect nested `when()`/`match()`/contributor schemas consistently for prompt input validation.

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
