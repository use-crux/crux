# @use-crux/core

**The SDK-agnostic foundation for harness engineering in TypeScript.**

`@use-crux/core` gives you typed building blocks for everything around the model call: prompts, contexts, memory, retrieval, tools, guardrails, constraints, routing, evaluation, agents, flows, and observability.

Your app still owns product logic, routing, deployment, and data. Your model SDK still makes the call. Crux makes the harness around that call deliberate, inspectable, testable, and portable across adapters.

> [!NOTE]
> `@use-crux/core` is in stable beta for its core composition and adapter
> contracts. See [STABILITY.md](./STABILITY.md) for the exact surface and
> compatibility promise.

## Install

Crux packages are ESM-only and require Node.js 22 or newer.

Most apps install `@use-crux/core` with an execution adapter. For Vercel AI SDK:

```bash
pnpm add @use-crux/core @use-crux/ai ai @ai-sdk/openai zod
```

You can also use the provider-specific adapters:

```bash
pnpm add @use-crux/openai openai
pnpm add @use-crux/anthropic @anthropic-ai/sdk
pnpm add @use-crux/google @google/genai
```

## Start With One Prompt

```ts
import { prompt } from "@use-crux/core";
import { generate } from "@use-crux/ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const classify = prompt({
  id: "classify",
  input: z.object({ text: z.string() }),
  output: z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
  }),
  system: "Classify the sentiment of the given text.",
  prompt: ({ input }) => input.text,
});

const result = await generate(classify, {
  model: openai("gpt-4o"),
  input: { text: "This is incredible." },
});

result.object.sentiment; // 'positive' | 'negative' | 'neutral'
```

That is a complete Crux program: typed input, typed output, and your SDK still making the model call.

## Multimodal Messages

Crux messages share one canonical content vocabulary across core, adapters, tool results, observability, and Convex mirrors. `Message.content` accepts either the existing string form or a readonly `ContentPart[]`:

```ts
import { filePart, imagePart, messageText, prompt, textPart } from "@use-crux/core";
import { generate } from "@use-crux/ai";
import { z } from "zod";

const inspectDashboard = prompt({
  id: "inspect-dashboard",
  input: z.object({ note: z.string() }),
  messages: ({ input }) => [
    {
      role: "user",
      content: [
        textPart(input.note),
        imagePart({ data: dashboardPng, mediaType: "image/png" }),
        filePart({
          url: "https://example.com/q2.pdf",
          mediaType: "application/pdf",
          filename: "q2.pdf",
        }),
      ],
    },
  ],
});

const result = await generate(inspectDashboard, {
  model,
  input: { note: "What changed?" },
});

result.text; // string envelope, unchanged
result.messages; // assistant media round-trips here as ContentPart[]
```

The part kinds are `text`, `image-data`, `image-url`, `image-file-id`, `file-data`, `file-url`, `file-id`, and `custom`. Bytes are JSON-safe base64 strings; `imagePart()` and `filePart()` also accept `Uint8Array`, `ArrayBuffer`, and `URL` values and normalize them immediately.

Use `contentText()` or `messageText()` whenever existing code needs a string. Text parts pass through verbatim, while images/files become bounded placeholders such as `[image image/png 210KB sha256:ab12...]`; raw base64 is never inlined into guardrails, compaction, memory, cache keys, or telemetry. `hasMediaParts()` is available for branching without parsing the projection.

Unsupported provider content degrades deliberately: the adapter sends the placeholder text, emits a diagnostics warning, and records a `content.degraded` span event. Pass `unsupportedContent: "error"` in generation settings when unsupported content should throw `UnsupportedContentError` before the provider call.

## Quality Evaluations

Quality runs live in `@use-crux/core/quality`. `evaluate()` keeps the task as
the only inference anchor, `expect` callbacks run before scorers, and
`afterScores` callbacks run after scorers with typed access to static scorer
outputs through `ctx.score`.

```ts
import { evaluate, scorers } from "@use-crux/core/quality";

export default evaluate({
  task: classify,
  data: [{ input: { text: "This is incredible." }, expected: { sentiment: "positive" } }],
  scorers: [scorers.exact()],
  expect: (ctx) => {
    ctx.expect(ctx.output.sentiment).toBeDefined();
    ctx.recordScore("has-sentiment", 1);
  },
  afterScores: (ctx) => {
    ctx.expect(ctx.score.exact).toBe(1);
  },
});
```

Experiment records are schema-versioned JSON. Current records store executed
cells under `cells` and assertion details under the ordered
`assertions.outcomes` ledger. When a cell reaches `timeoutMs`, Crux records a
timeout result and quarantines later task effects such as trace, cassette, and
score writes; JavaScript user code is not forcibly killed.

Judge scorers pin deterministic generation settings, frame output/reference as
untrusted prompt data, and stamp score metadata with judge model, prompt
version, rubric fingerprint, and rationale. The local CLI can record human
labels with `crux quality label` and compare judge-vs-human agreement with
`crux quality judge-report --json`.

## Adapter Results

Core-step adapters such as `@use-crux/openai`, `@use-crux/anthropic`, and
`@use-crux/google` return the canonical `GenerateResult` envelope from
`generate()`: accumulated `text`, optional accumulated `usage`, optional
`cost`, `steps`, `finalStep`, provider-neutral `messages`, typed `.raw`, and
retained `_meta` for observability plumbing. `usage` is present only when every
provider-call step reported usage; Crux never presents a partial token sum as a
total.

`stream()` returns `StreamResult`: provider-neutral `textStream`, typed `.raw`
for the SDK stream handle, and a `completion` promise resolving to the same
envelope fields except `.raw` and `_meta`.

## Public Codecs And Headless Calls

Adapter packages export `toParams(resolved, options)` and
`fromResponse(response)` for power users who own the SDK call. `ResolvedPrompt`
is provider-neutral and intentionally does not carry a model, so
`options.model` is required. Codecs translate only: they do not run tool
middleware, approvals, validation retry, memory capture, safety, or
observability.

Every first-party generation adapter exposes the headless ladder:

```ts
const call = await anthropic.prepare(myPrompt, { model, input });
const response = await client.messages.create(call.params);
const result = await call.finish(response);
```

Use `step(response)` instead of `finish(response)` when a run may need another
provider turn for tools, validation retry, or approval suspension. The handle
uses the same executor path as managed `generate()`. `generate()` also accepts
`transport: (params, info) => response` when Crux should own the loop but your
code should own the wire call. `stream()` with `transport` is intentionally not
supported and rejects with `CruxTransportStreamUnsupportedError`.

## Tool Approvals

Tool definitions stay policy-free. Require human approval where tools are
composed: `context({ toolApproval })`, `prompt({ toolApproval })`, or the
call-site `generate()`/`stream()` options. Exact tool names beat wildcards;
within the selected exact or wildcard declarations, call site wins over prompt
and prompt wins over context.

```ts
const result = await adapter.generate(assistant, {
  model: "gpt-4o",
  input,
  toolApproval: {
    deletePost: "always",
    "*": "never",
  },
});
```

When a call suspends, persist `result.messages`, append a
`tool-approval-response` with `appendToolApprovalResponse()`, and call the
adapter again with the resumed messages.

## Tool Context

Tools can declare per-tool dependencies with `contextSchema`. Any adapter call
that composes that tool must pass a matching `toolsContext.<toolName>` value;
Crux validates it before the tool loop starts, rejects `toolsContext` keys for
tools without `contextSchema`, and passes the parsed value to `execute`,
middleware, and approval middleware. `runtimeContext` is shared across the
whole run and is also visible to function-form `toolApproval` policies.

```ts
const weather = tool({
  description: "Get weather.",
  input: z.object({ city: z.string() }),
  contextSchema: z.object({ apiKey: z.string() }),
  execute: async ({ city }, { context, runtimeContext }) =>
    fetchWeather(city, context.apiKey, runtimeContext),
});

await generate(assistant, {
  model,
  toolsContext: { weather: { apiKey: process.env.WEATHER_API_KEY } },
  runtimeContext: { tenantId: "tenant_1" },
});
```

## Input Escaping

Prompt resolution uses the parsed Zod output as the source of truth. Defaults
and transforms apply before contexts, gates, tools, memo keys, and prompt
functions read input.

When auto-escape is enabled, Crux escapes top-level string input fields after
your optional `sanitize` hook runs. Nested strings inside objects or arrays are
not rewritten; Crux emits a diagnostic so you can escape nested content
explicitly, flatten the field, or mark trusted top-level fields with
`rawFields`.

```ts
const summarize = prompt({
  input: z.object({
    title: z.string(),
    bodyHtml: z.string(),
  }),
  rawFields: ["bodyHtml"],
  sanitize: (input) => ({
    ...input,
    title: input.title.trim(),
  }),
  system: ({ input }) => `Summarize ${input.title}.`,
  prompt: ({ input }) => input.bodyHtml,
});
```

## Context Memoization And Provider Caching

Context caching has two explicit layers. Use `memo: { ttl }` when a dynamic
context resolver is expensive and its resolved text may be reused app-side for
that many milliseconds. Use `cache: true` when the resolved block is stable
enough for provider prompt caching. The two can be combined, but `memo` requires
an `id` and only applies to dynamic context systems.

Resolved contexts also carry freshness facts. `.inspect().system.parts[]` and
`context.contribution` artifacts report whether a contribution was served live
or from resolver memo, when it was originally resolved, and the age of memo
hits. Structured segments may also carry `observedAt` and `sourceVersion`
metadata from primitives that already know source timestamps, such as
retriever hits.

The prompt's own system text always comes first. Cached contexts (`cache: true`)
follow it as a stable prefix, then uncached contexts; each group keeps `use`
array order. Token-budget pressure can drop only uncached contexts, never the
cached prefix.

```ts
const brand = context({
  id: "brand-voice",
  input: z.object({ orgId: z.string() }),
  system: async ({ input }) => fetchBrandProfile(input.orgId),
  memo: { ttl: 300_000 },
  cache: true,
});
```

## Add Blocks As You Need Them

The `use` array is the bus. Memory, retrieval, guardrails, skills, blackboards, and custom blocks all plug into the same prompt without forcing a framework or runtime around your app.

```ts
import { prompt } from "@use-crux/core";
import { memory, facts, recentMessages } from "@use-crux/core/memory";
import { retriever } from "@use-crux/core/retrieval";
import { boundary, constraint, guardrail } from "@use-crux/core/safety";
import { generate } from "@use-crux/ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const chat = memory({
  id: "assistant",
  store,
  namespace: ({ input }) => `user:${input.userId}`,
  blocks: [
    recentMessages({ id: "recent", maxMessages: 12 }),
    facts({ id: "about-user", embed }),
  ],
});

const docs = retriever({
  id: "docs",
  namespace: "product-docs",
  data,
  vectors,
  dense,
  context: { query: ({ question }) => question },
});

const injection = guardrail({
  id: "injection",
  on: boundary.input.text(),
  run: guardrail.injection({ action: "block" }),
});

const ReplyOutputSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({ title: z.string(), url: z.string() })),
});

type ReplyOutput = z.infer<typeof ReplyOutputSchema>;

const grounded = constraint({
  id: "grounded",
  on: boundary.output.object<ReplyOutput>(),
  severity: "assert",
  run: async (output) =>
    output.citations.length > 0
      ? { pass: true }
      : { pass: false, feedback: "Cite at least one source." },
});

const reply = prompt({
  id: "reply",
  use: [chat, docs],
  input: z.object({ userId: z.string(), question: z.string() }),
  output: ReplyOutputSchema,
  system: "Answer from memory and product docs. Do not invent facts.",
  prompt: ({ input }) => input.question,
});

const result = await generate(reply, {
  model: openai("gpt-4o"),
  input: {
    userId: "user_123",
    question: "What did we decide about the launch plan?",
  },
  guardrails: [injection],
  constraints: [grounded],
});
```

Now the call has memory, retrieval, input screening, structured output, retryable quality checks, adapter execution, and traceable events.

## Give Agents A Workspace

Use `workspace()` when an agent needs durable scratch files and generated outputs.
Workspaces are namespace-scoped, path-addressed file trees backed by a `RecordStore`
for metadata and small text/JSON, plus an optional `BlobStore` for binary and
oversized payloads.

```ts
import { prompt } from "@use-crux/core";
import { inMemoryStorage } from "@use-crux/core/storage";
import { workspace } from "@use-crux/core/workspace";

const ws = workspace({
  id: "research",
  namespace: ({ input }) => `thread:${input.threadId}`,
  storage: inMemoryStorage(),
  retention: { ttlMs: 1000 * 60 * 60 * 24 },
  limits: {
    maxFileBytes: 1_000_000,
    maxNamespaceBytes: 25_000_000,
  },
});

const analyst = prompt({
  id: "analyst",
  use: [ws],
  system: "Use /workspace for notes and write final files to /outputs.",
});

await ws.write("/workspace/notes.md", "# Notes", { namespace: "thread:123" });
await ws.append("/workspace/notes.md", "\nMore notes.", {
  namespace: "thread:123",
});
await ws.rename("/workspace/notes.md", "/outputs/report.md", {
  namespace: "thread:123",
});
await ws.move("/outputs/report.md", "/outputs/final-report.md", {
  namespace: "thread:123",
});
await ws.finalize("/outputs/final-report.md", {
  namespace: "thread:123",
  kind: "report",
});
```

Workspaces keep an append-only version history for every file. History is always
recorded, so a destructive edit is recoverable even when no one planned ahead:

```ts
await ws.history("/outputs/report.md"); // newest-first WorkspaceVersion[]
await ws.read("/outputs/report.md", { version: 1 }); // read an older revision
await ws.diff("/outputs/report.md", { from: 1, to: 2 }); // unified string + structured hunks
await ws.undo("/outputs/report.md"); // restore the previous version as a new one
```

Retention is unlimited by default; set `versioning: { maxVersions }` to bound how
many revisions are kept per file. The `undoWorkspaceFile` tool is opt-in via
`tools: { undo: true }`, like `deleteWorkspaceFile`.

`finalize()` pins the current version as the published artifact: later edits
create new draft versions, but `artifacts()` and the manifest keep surfacing the
pinned revision (`WorkspaceArtifact.version`) until you `finalize()` again.

Use `transaction()` when a deliverable spans multiple files and should appear as
a coherent set. The callback writes to a staged view first; throwing discards
the staged changes, and a successful callback commits the touched paths together.
Transactions use the generic `RecordStore` contract, so they work with in-memory,
Convex, Upstash Redis, and custom conforming record stores for local workspace
mounts. Crash-proof multi-key durability still depends on the backing store.

```ts
const artifact = await ws.transaction(
  async (tx) => {
    await tx.write("/outputs/report.md", "# Report", { status: "draft" });
    await tx.write("/outputs/data.csv", "name,value\nalpha,1\n");
    return tx.finalize("/outputs/report.md", { kind: "report" });
  },
  { namespace: "thread:123" },
);
```

Injected workspaces add a bounded manifest plus file tools for list, read, write,
edit, rename, and grep. Programmatic methods also include `exists`, `stat`,
`append`, `move`, `copy`, `delete`, `history`, `diff`, `undo`, `artifacts`,
`finalize`, and `transaction`. Blob-backed text and JSON read back as text/JSON;
binary files return a URI for app-side fetching. Every operation accepts a
`{ namespace }` override for direct calls and manually created tools.

Mounts can also expose virtual roots backed by a retriever or custom source. The
workspace still owns path normalization. Source-backed files can be listed,
read, grepped, statted, and included with `asContext({ include })` without
copying provider bytes into the workspace store. Retriever mounts and custom
sources without write hooks are read-only by default; a custom source can opt
into `write`/`edit`/`append`, provider-destination `copy`, and `delete` by
using `access: "readwrite"` and implementing `write` and/or `delete`. Explicit
`copy()` calls can materialize readable virtual text/JSON files into writable
local mounts or into provider mounts with write hooks.

```ts
import { retrieverWorkspaceMountSource } from "@use-crux/core/workspace";

const wsWithSources = workspace({
  id: "research",
  namespace: "thread:123",
  mounts: [
    { path: "/workspace", access: "readwrite" },
    {
      path: "/sources",
      access: "read",
      source: {
        kind: "custom",
        list: async () => ({
          entries: [
            {
              kind: "file",
              path: "/sources/brief.md",
              mount: "/sources",
              mimeType: "text/markdown",
              size: 128,
              storage: "virtual",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        }),
        read: async (path) => ({
          kind: "text",
          path,
          mimeType: "text/markdown",
          content: "# Brief",
          size: 7,
        }),
      },
    },
    {
      path: "/knowledge",
      access: "read",
      // myRetriever is any Retriever from @use-crux/core/retrieval.
      source: {
        kind: "retriever",
        retriever: myRetriever,
        query: "current project sources",
      },
    },
    {
      path: "/legacy-knowledge",
      access: "read",
      source: retrieverWorkspaceMountSource(myRetriever, {
        query: "legacy source mapping",
      }),
    },
  ],
});
```

Workspace operations are visible in devtools, OTel, and Project Index without
exporting raw paths to OTel. OTel receives `crux.workspace.operation` and
`crux.workspace.path_hash`; devtools use a stable `hash:<pathHash>` label when
no local-only raw path is available. Project Index records mounts, generated
tool names, blob-storage posture, retention TTL, quota limits, and workspace
read/write relations from indexed owners. Workspace-specific Project Index
data-access facts preserve exact operations such as `grep`, `history`, `diff`,
`undo`, `artifacts`, `rename`, `move`, `copy`, and `finalize`.

## What Core Gives You

| Capability         | What it is for                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Prompt definitions | Typed `prompt()` objects with input/output schemas, settings, tags, tests, and provider overrides.                                   |
| Composable context | `context()` blocks and custom `contributor()` entries for brand voice, policies, retrieved docs, formatting rules, and shared tools. |
| Workspaces         | Durable namespace-scoped files, generated artifacts, blob-backed outputs, and model-safe file tools.                                 |
| Memory             | Recent messages, working state, episodes, facts, procedures, proposals, policies, and pluggable stores.                              |
| Retrieval          | Indexers, corpora, retrievers, rerankers, grounding, citations, and custom RAG pipelines.                                            |
| Tools              | Prompt tools, context tools, middleware, approval flows, and audit events.                                                           |
| Safety             | Guardrails for input/output filtering plus constraints for semantic output validation and retry.                                     |
| Routing and cost   | Model routers, fallback, semantic cache, pricing tables, budgets, and cost spans.                                                    |
| Evaluation         | Quality suites, prompt tests, judges, variants, cassettes, baselines, and CI-friendly runs.                                          |
| Agents and flows   | Agents, pipelines, parallel runs, consensus, swarms, blackboards, handoffs, delegates, suspendable flows, plans, and tasks.          |
| Observability      | Trace records, local devtools, subscribers, diagnostics channel export, source catalog, and OpenTelemetry export.                    |

### Tool Merge Policy

Prompt-time tool names must be unique. Crux merges skill tools, context tools,
contributor tools, blackboard tools, and prompt-level `tools` in that order; if
two prompt-time owners contribute the same name, resolution throws and names
both owners. Call-site `generate()`/`stream()` tools are the only override path
and intentionally win after prompt resolution.

Portable tool-loop controls live in `GenerationSettings`: `toolChoice`,
`stopWhen`, `maxSteps`, plus the `maxSteps(n)` and `hasToolCall(name)` helpers.
Adapters map those settings to provider-native fields. Provider-specific tool
controls that are not portable belong in that adapter's typed `extra` option.
`GenerationSettings.reasoning` provides a portable `'low' | 'medium' | 'high'`
reasoning-effort hint; exact provider budgets, summaries, and disable controls
also belong in `extra`.

Managed `generate()` / `stream()` calls use structured `timeout` budgets:
`totalMs` for the whole call, `stepMs` for provider attempts, `chunkMs` for
stream inactivity, and `toolMs` / `tools[name]` for tool execution. Expired
budgets reject with `TimeoutError`.

## How It Works

Every execution follows the same pipeline:

```txt
define -> resolve -> adapt -> observe
```

| Stage   | What happens                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Define  | Author pure TypeScript definitions: prompts, contexts, memory blocks, tools, agents, flows, tests, and settings.                                                 |
| Resolve | Crux validates input, filters conditional blocks, applies token budgets and provider adaptations, then produces a provider-agnostic resolved prompt.             |
| Adapt   | An adapter maps that resolved prompt to Vercel AI SDK, OpenAI, Anthropic, Google GenAI, Convex Agent, or another runner.                                         |
| Observe | Graph records emit once, are sanitized and validated fail-open, then feed subscribers, the diagnostics channel, bounded devtools transport, and telemetry sinks. |

This separation lets you inspect what the model will see, run the same prompt through multiple providers, and keep quality checks tied to the definitions they protect.

## Observability Privacy

Generation, streaming, and tool spans emit canonical graph records with latency and throughput metrics such as `gen.duration_ms`, `gen.time_to_first_token_ms`, `gen.output_tokens_per_second`, and `gen.time_per_output_chunk_ms`. Streaming text is coalesced into bounded `token.chunk` span events rather than one record per provider delta.

Manual spans use an explicit terminal API: call `span.end({ attributes, metrics, status })` for terminal metadata, or `span.setAttributes(attributes)` for metadata discovered before the span closes. Raw attribute bags are not accepted by `span.end()`, so `{ error: value }` always means an error end instead of an ambiguous attribute object.

Streaming spans close through a single finalizer. Raw stream drain and provider completion metadata are merged before the terminal `span:end` when both are available; if completion metadata is never awaited, the span closes after a bounded grace window with stream-derived metrics. Early stream cancellation ends the span as `cancelled`.

Metric objects may include optional expressions that evaluate to `undefined`. The observability runtime strips `undefined`, `NaN`, and infinite metric values before records reach subscribers, diagnostics-channel consumers, devtools transports, or OTel, so malformed metrics do not interrupt application code.
Custom metric keys must use the `custom.*` namespace; built-in generation and token keys are typed.

`observe.span()` derives the span family from its canonical `primitive`, so callers only pass `name`, `primitive`, optional `attributes`, and lifecycle settings. `subscribeObservability()` can subscribe to the whole graph stream or to a narrowed list of record types, with the callback type narrowed to those discriminants.

Observability IDs are W3C-compatible at the trace/span boundary: `traceId` is 32 lowercase hex characters and `spanId` is 16 lowercase hex characters. Every graph record also carries a per-run monotonic `seq` used by transports and the local read model for deterministic ordering.

The observability wire contract is governed by `packages/core/observability/VERSIONING.md`. TypeScript producer fixtures stay closed over known graph record types, while the Go local runtime preserves unknown record types and extra JSON fields as raw records so newer SDKs can degrade gracefully against older read models.

Use `propagateAttributes({ sessionId, userId, metadata }, fn)` to stamp logical correlators onto every record emitted inside `fn`. `sessionId` and `userId` become top-level graph fields, while `metadata` is copied into attributes as capped `meta.*` strings. Devtools `sessionId` config uses the same path as a default correlator for traces emitted while the devtools transport is active.

The local Go runtime keeps observability history bounded. It marks abandoned running runs through a cheap activity-based lifecycle reconciler, treats fresh `last_activity_at` updates such as streaming `token.chunk` records as live activity, and persists reconciled lifecycle state so the same crashed run is not rebuilt every tick. Startup and periodic retention delete old runs after 14 days or beyond 2000 runs by default, with `CRUX_OBSERVABILITY_RETENTION_DAYS`, `CRUX_OBSERVABILITY_RETENTION_RUNS`, and `CRUX_OBSERVABILITY_PREVIEW_MAX_BYTES` overrides.

The local devtools UI reads backend-owned observability rollups instead of recomputing counts in the browser. The runs list can group by root `sessionId`, shows token/cost/graph-count rollups from the list endpoint, and fetches focused-span `token.chunk` text through the lazy span-events endpoint so unfocused spans stay cheap.

Quality evaluations emit an umbrella `eval.run` run around their case matrix. Case cells keep production-shaped `eval.case` runs, join the evaluation trace, and link back with `eval.case_of` edges. Promoted-baseline comparisons emit `comparison.report` artifacts with `comparison.candidate` and, when the baseline has persisted run identity, `comparison.baseline` edges. Cassette replay can link replayed case runs to the recorded run with `replay.of`; consumers treat edges to missing nodes as external references.

Observability delivery is fail-open and bounded. When no subscribers, diagnostics-channel listeners, or transport are active, emitters skip graph-record construction. Active delivery batches records on `observability.delivery.scheduledDelayMs`, chunks requests with the transport's `maxRecordsPerRequest`, retries failed chunks on capped backoff without waiting for another emitted record, and caps queued records with oldest-record drop accounting in `droppedRecords`. The local HTTP ingest endpoint returns `202` with `{ accepted, rejected }` for valid JSON batches, `400` only for malformed JSON, and retryable `503` responses with `Retry-After: 1` for transient storage failures; the TypeScript HTTP transport retries 5xx responses as whole batches instead of bisecting them record-by-record. Synchronous or asynchronous transport failures are recorded in `observabilityDiagnostics().deliveryErrors` without escaping into application code.

When `AsyncLocalStorage` is unavailable, such as in browser-like or edge runtimes, `observe.run()` and `observe.openRun()` still work. Explicit `withContext()` scopes preserve parent-child relationships for synchronous work, while contextless `event`, `artifact`, and `edge` attempts become counted no-ops via `observabilityDiagnostics().contextlessRecords` instead of throwing.

The OTel plugin follows the same fail-open contract: duplicate `withTelemetry()` installs are ignored after a warn-once diagnostic, open span registries are bounded, and a missing OTel `TracerProvider` falls back to lightweight span tracking instead of producing invalid all-zero span contexts. GenAI export uses the pinned `genai-dev-2026-06` semconv table (`gen_ai.provider.name`, seconds-based client timings, array finish reasons), and message content remains opt-in through `captureMessageContent`.

By default, request and response artifacts include bounded previews for local inspection. Configure capture centrally when traces leave a trusted environment:

```ts
import { config } from "@use-crux/core";

config({
  observability: {
    recordInputs: "reference",
    recordOutputs: "off",
    redactRecord: (record) =>
      record.type === "artifact" && record.kind === "error.raw" ? null : record,
  },
});
```

`recordInputs` and `recordOutputs` accept `true | false | "inline" | "reference" | "off"`. `"reference"` keeps only size/hash metadata, while `"off"` removes preview, size, hash, and URI payload metadata. The emit path also strips payload-shaped span/event attributes such as `text`, `query`, `messages`, `output`, `body`, and `filter`. `redactRecord()` runs after capture policy; returning `null` or throwing drops the record and increments `observabilityDiagnostics().redactedRecords`.

## Configuration Lifecycle

`config()` is process-global: one active project config owns the hook layer for
middleware, plugins, persistence, observability policy, and runtime engine
definition. Re-running `config()` replaces the previous installation before
applying the new one, so hot reload does not stack middleware or duplicate hook
fan-out. Disposing a returned `Crux` object restores only the layer it installed;
independent layers such as imperative devtools remain intact. Multi-tenant or
per-request config scoping is intentionally out of scope for this process-global
API.

## Runtime Engine

Runtime-bound APIs use a configured Runtime Engine for durable work, timers,
event waiters, wake delivery, and maintenance. For local development and tests,
use the in-process `node()` composer:

`@use-crux/core/runtime` and the Runtime Engine store-adapter contract are
stable beta while Crux remains pre-1.0. Breaking changes require a minor-version
bump and migration notes.

```ts
import { config } from "@use-crux/core";
import { node } from "@use-crux/core/runtime";

export default config({
  runtime: node({
    retention: {
      events: "24h",
      terminalWork: "7d",
      terminalSnapshots: "30d",
      sweepLimit: 200,
    },
  }),
});
```

With a runtime configured, flow handles can persist `flow.suspend()` and
`flow.waitFor(...)` state in the Runtime Engine, auto-resume when
`reviewFlow.signal(...)` or a durable event arrives, enqueue durable background
work with `flow.defer(task, input)`, schedule task timers with
`flow.after(task, delay, input)`, and wait for child work with
`flow.untilIdle({ scope: "current-flow" })`.

Delivered event payloads are copied into the durable flow snapshot when a waiter
fires. Flow replay reads those snapshot payloads directly instead of scanning
the event log, so maintenance can prune old events without breaking replay.
Runtime composers accept a `retention` block for events, terminal work,
confirmed outbox rows, idempotency keys, settled timers/waiters, terminal
snapshots, and per-class `sweepLimit`. Defaults keep events for 24h, terminal
work and idempotency keys for 7d, confirmed outbox/timers/waiters for 24h, and
terminal snapshots for 30d. Set a class to `false` to keep it indefinitely.

Outbox dispatch is bounded and defaults to eight in-flight deliveries per
maintenance pass. Store adapters expose `outbox.listByWork(...)` with
`namespace`, `state`, and `limit` options so orphan recovery can check the
specific work item's wake rows without namespace-wide scans.

Wake execution fences every final commit with the worker's lease token. If
maintenance reclaims a long-running item and another worker finishes it first,
the stale worker exits with `LEASE_LOST` instead of retrying, dead-lettering, or
overwriting the winner. Hosts that can schedule timers heartbeat leases while
targets run; timerless hosts can pass `leaseExtension: false` and should size
`leaseTtlMs` for their longest target. Convex host bindings disable the
heartbeat and rely on fencing.

Executable durable task targets are defined from the runtime subpath, not the
root Plans & Tasks ledger `task()` helper:

```ts
import { durableTask, type RuntimeTaskContext } from "@use-crux/core/runtime";

export const embedDocument = durableTask("embed-document", {
  run: async (input: { documentId: string }, _context: RuntimeTaskContext) => {
    const { documentId } = input;
    await embed(documentId);
  },
});
```

The `Crux` object returned by `config()` also exposes name-bound
`crux.flows.signal()`, `crux.flows.resume()`, and `crux.flows.cancel()` for
runtime-backed flows when the object-bound flow handle is not available.

Object-bound flow APIs remain the baseline: `reviewFlow.signal(...)` and
`reviewFlow.run({ resume: flowId })` work without runtime config when your code
already has the handle. Name-bound, event-bound, time-bound, and background APIs
fail with `RUNTIME_REQUIRED` until a runtime is configured.

Serverless entry files use the stable fetch-compatible handler API. Generated
files target the same shape that users can write by hand:

```ts
import { createRuntimeHandler, serverless } from "@use-crux/core/runtime";
import { postgres } from "@use-crux/postgres/runtime";
import { qstash } from "@use-crux/upstash/runtime";
import { reviewFlow } from "@/flows/review";
import { embedDocument } from "@/tasks/embed-document";

const runtime = serverless({
  store: postgres(),
  wake: qstash(),
});

export const { GET, POST } = createRuntimeHandler({
  runtime,
  targets: [reviewFlow, embedDocument],
});
```

Advanced and generated entry files can resolve a composer explicitly with
`createRuntime({ runtime, targets })`. The `@use-crux/core/runtime/testing`
subpath exposes `createTestRuntime()` for app-level flow and task tests, plus
the shared store and kernel conformance suites for adapter authors.

```ts
import { flow } from "@use-crux/core";
import { durableTask } from "@use-crux/core/runtime";
import { createTestRuntime } from "@use-crux/core/runtime/testing";

const sendReminder = durableTask("send-reminder", {
  run: async (input: { userId: string }) => {
    await sendEmail(input.userId);
  },
});

const onboarding = flow("onboarding", async (scope, input: { userId: string }) => {
  await scope.after(sendReminder, "2d", { userId: input.userId });
  await scope.suspend("approval");
});

const rt = createTestRuntime({ targets: [onboarding, sendReminder] });
await onboarding.run({ userId: "user_1" });
await rt.clock.advance("2d");
rt.dispose();
```

Runtime store adapters may implement `runComposite(kind, input)` to execute one
kernel-owned named composite atomically in their native substrate. Ordinary
stores can omit it and use the default `transact()` wrapper; host-bound adapters
such as Convex use it to run the same core composite bodies inside one component
mutation.

Runtime diagnostics throw `CruxRuntimeError` with stable codes:
`RUNTIME_REQUIRED`, `CAPABILITY_MISSING`, `TARGET_NOT_FOUND`,
`TARGET_DUPLICATE`, `TARGET_NOT_EXPORTED`, `REPLAY_DIVERGED`,
`ARTIFACTS_STALE`, `WAKE_UNVERIFIED`, `PUBLIC_URL_UNRESOLVED`,
`SETUP_REQUIRED`, `PAYLOAD_NOT_JSON`, `WORK_DEAD_LETTERED`, `LEASE_LOST`,
`NAMESPACE_AMBIGUOUS`, and `RUNTIME_HOST_ONLY`.

## Import Paths

`@use-crux/core` exposes SDK-agnostic primitives through focused subpaths:

| Import                           | Area                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@use-crux/core`                 | Prompts, contexts, config, runtime helpers, common types.                                                                                                                   |
| `@use-crux/core/memory`          | Memory blocks, stores, capture, recall, and compaction hooks.                                                                                                               |
| `@use-crux/core/retrieval`       | Retrievers, rerankers, grounding inputs, and RAG pipelines.                                                                                                                 |
| `@use-crux/core/safety`          | Guardrails, constraints, safety plugins, and validation retry.                                                                                                              |
| `@use-crux/core/quality`         | Evaluations, suites, assertions, scorers, gates, variants, and baselines.                                                                                                   |
| `@use-crux/core/agent`           | Agents, blackboards, handoffs, delegates, parallel, pipeline, consensus, and swarm.                                                                                         |
| `@use-crux/core/flow`            | Suspendable typed workflows.                                                                                                                                                |
| `@use-crux/core/runtime`         | Runtime Engine composers, port contracts, diagnostics, wake envelopes, kernel composites, outbox dispatch, pure retry/state helpers, and the in-memory runtime store.       |
| `@use-crux/core/runtime/testing` | App-level Runtime Engine test harness plus store and kernel conformance suites for adapter authors.                                                                         |
| `@use-crux/core/observability`   | Canonical graph records, presentation read-model types, devtools transport, subscribers, diagnostics channel, and the per-turn `TurnDecisionReport` explanation read model. |
| `@use-crux/core/project-index`   | Public Project Index contracts for local devtools and source intelligence.                                                                                                  |
| `@use-crux/core/skill`           | Edge-safe skill authoring with inline and registry loaders.                                                                                                                 |
| `@use-crux/core/skill/node`      | Node-only local SKILL.md loading with `skill.fromFile()` and `fileSkill()`.                                                                                                 |

See the full [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) for every subpath and API.

## TypeScript Compatibility

`@use-crux/core` is verified against TypeScript `>=5.5 <7`. TypeScript 7 is tracked with `@typescript/native-preview` / `tsgo` as a preview lane, not a stable support promise yet.

Prompt authoring types are part of the runtime contract: `messages` mode is
exclusive with `system`/`prompt`, `when()` wrapper inputs are partial,
`match()` branch inputs surface as optional merged input fields, and concrete
prompts expose literal `hasOutput` values.

## Learn More

- [Crux docs](https://cruxjs.dev)
- [Get started](https://cruxjs.dev/docs/getting-started)
- [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core)
- [Runtime Engine reference](https://cruxjs.dev/docs/reference/crux-core/runtime-engine)
- [Mental model](https://cruxjs.dev/docs/foundations/mental-model)
- [Examples](https://github.com/use-crux/crux/tree/main/examples)
- [GitHub repository](https://github.com/use-crux/crux)
