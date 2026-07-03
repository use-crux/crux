# @use-crux/core

**The SDK-agnostic foundation for harness engineering in TypeScript.**

`@use-crux/core` gives you typed building blocks for everything around the model call: prompts, contexts, memory, retrieval, tools, guardrails, constraints, routing, evaluation, agents, flows, and observability.

Your app still owns product logic, routing, deployment, and data. Your model SDK still makes the call. Crux makes the harness around that call deliberate, inspectable, testable, and portable across adapters.

> [!WARNING]
> Crux is in alpha development. APIs may change before the first stable release.

## Install

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

## Add Blocks As You Need Them

The `use` array is the bus. Memory, retrieval, guardrails, skills, blackboards, and custom blocks all plug into the same prompt without forcing a framework or runtime around your app.

```ts
import { prompt } from "@use-crux/core";
import { memory, facts, recentMessages } from "@use-crux/core/memory";
import { retriever } from "@use-crux/core/retrieval";
import { constraint, guardrail } from "@use-crux/core/safety";
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
  name: "injection",
  phase: "input",
  validate: detectPromptInjection,
});

const grounded = constraint({
  name: "grounded",
  severity: "assert",
  check: async (output) =>
    output.parsed.citations.length > 0
      ? { pass: true }
      : { pass: false, feedback: "Cite at least one source." },
});

const reply = prompt({
  id: "reply",
  use: [chat, docs],
  input: z.object({ userId: z.string(), question: z.string() }),
  output: z.object({
    answer: z.string(),
    citations: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
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

| Capability         | What it is for                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Prompt definitions | Typed `prompt()` objects with input/output schemas, settings, tags, tests, and provider overrides.                          |
| Composable context | `context()` blocks for brand voice, policies, retrieved docs, formatting rules, and shared tools.                           |
| Workspaces         | Durable namespace-scoped files, generated artifacts, blob-backed outputs, and model-safe file tools.                        |
| Memory             | Recent messages, working state, episodes, facts, procedures, proposals, policies, and pluggable stores.                     |
| Retrieval          | Indexers, corpora, retrievers, rerankers, grounding, citations, and custom RAG pipelines.                                   |
| Tools              | Prompt tools, context tools, middleware, approval flows, and audit events.                                                  |
| Safety             | Guardrails for input/output filtering plus constraints for semantic output validation and retry.                            |
| Routing and cost   | Model routers, fallback, semantic cache, pricing tables, budgets, and cost spans.                                           |
| Evaluation         | Quality suites, prompt tests, judges, variants, cassettes, baselines, and CI-friendly runs.                                 |
| Agents and flows   | Agents, pipelines, parallel runs, consensus, swarms, blackboards, handoffs, delegates, suspendable flows, plans, and tasks. |
| Observability      | Trace records, local devtools, subscribers, diagnostics channel export, source catalog, and OpenTelemetry export.           |

## How It Works

Every execution follows the same pipeline:

```txt
define -> resolve -> adapt -> observe
```

| Stage   | What happens                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Define  | Author pure TypeScript definitions: prompts, contexts, memory blocks, tools, agents, flows, tests, and settings.                                  |
| Resolve | Crux validates input, filters conditional blocks, merges tools/settings, applies token budgets, and produces a provider-agnostic resolved prompt. |
| Adapt   | An adapter maps that resolved prompt to Vercel AI SDK, OpenAI, Anthropic, Google GenAI, Convex Agent, or another runner.                          |
| Observe | Graph records emit once, are sanitized and validated fail-open, then feed subscribers, the diagnostics channel, bounded devtools transport, and telemetry sinks. |

This separation lets you inspect what the model will see, run the same prompt through multiple providers, and keep quality checks tied to the definitions they protect.

## Observability Privacy

Generation, streaming, and tool spans emit canonical graph records with latency and throughput metrics such as `gen.duration_ms`, `gen.time_to_first_token_ms`, `gen.output_tokens_per_second`, and `gen.time_per_output_chunk_ms`.

Manual spans use an explicit terminal API: call `span.end({ attributes, metrics, status })` for terminal metadata, or `span.setAttributes(attributes)` for metadata discovered before the span closes. Raw attribute bags are not accepted by `span.end()`, so `{ error: value }` always means an error end instead of an ambiguous attribute object.

Streaming spans close through a single finalizer. Raw stream drain and provider completion metadata are merged before the terminal `span:end` when both are available; if completion metadata is never awaited, the span closes after a bounded grace window with stream-derived metrics. Early stream cancellation ends the span as `cancelled`.

Metric objects may include optional expressions that evaluate to `undefined`. The observability runtime strips `undefined`, `NaN`, and infinite metric values before records reach subscribers, diagnostics-channel consumers, devtools transports, or OTel, so malformed metrics do not interrupt application code.

Observability delivery is fail-open and bounded. When no subscribers, diagnostics-channel listeners, or transport are active, emitters skip graph-record construction. Active delivery batches records on `observability.delivery.scheduledDelayMs`, chunks requests with the transport's `maxRecordsPerRequest`, retries failed chunks on capped backoff without waiting for another emitted record, and caps queued records with oldest-record drop accounting in `droppedRecords`. Synchronous or asynchronous transport failures are recorded in `observabilityDiagnostics().deliveryErrors` without escaping into application code.

When `AsyncLocalStorage` is unavailable, such as in browser-like or edge runtimes, `observe.run()` and `observe.openRun()` still work. Explicit `withContext()` scopes preserve parent-child relationships for synchronous work, while contextless `event`, `artifact`, and `edge` attempts become counted no-ops via `observabilityDiagnostics().contextlessRecords` instead of throwing.

The OTel plugin follows the same fail-open contract: duplicate `withTelemetry()` installs are ignored after a warn-once diagnostic, open span registries are bounded, and a missing OTel `TracerProvider` falls back to lightweight span tracking instead of producing invalid all-zero span contexts.

By default, request and response artifacts include bounded previews for local inspection. Configure capture centrally when traces leave a trusted environment:

```ts
import { config } from "@use-crux/core";

config({
  observability: {
    recordInputs: "reference",
    recordOutputs: "off",
    redactRecord: (record) => (record.type === "artifact" && record.kind === "error.raw" ? null : record),
  },
});
```

`recordInputs` and `recordOutputs` accept `true | false | "inline" | "reference" | "off"`. `"reference"` keeps only size/hash metadata, while `"off"` removes preview, size, hash, and URI payload metadata. The emit path also strips payload-shaped span/event attributes such as `text`, `query`, `messages`, `output`, `body`, and `filter`. `redactRecord()` runs after capture policy; returning `null` or throwing drops the record and increments `observabilityDiagnostics().redactedRecords`.

## Runtime Engine

Runtime-bound APIs use a configured Runtime Engine for durable work, timers,
event waiters, wake delivery, and maintenance. For local development and tests,
use the in-process `node()` composer:

```ts
import { config } from "@use-crux/core";
import { node } from "@use-crux/core/runtime";

export default config({
  runtime: node(),
});
```

With a runtime configured, flow handles can persist `flow.suspend()` and
`flow.waitFor(...)` state in the Runtime Engine, auto-resume when
`reviewFlow.signal(...)` or a durable event arrives, enqueue durable background
work with `flow.defer(task, input)`, schedule task timers with
`flow.after(task, delay, input)`, and wait for child work with
`flow.untilIdle({ scope: "current-flow" })`.

Executable durable task targets are defined from the runtime subpath, not the
root Plans & Tasks ledger `task()` helper:

```ts
import { task } from "@use-crux/core/runtime";

export const embedDocument = task("embed-document", {
  run: async ({ documentId }: { documentId: string }) => {
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
subpath exposes the shared store and kernel conformance suites for adapter
authors.

Runtime diagnostics throw `CruxRuntimeError` with stable codes:
`RUNTIME_REQUIRED`, `CAPABILITY_MISSING`, `TARGET_NOT_FOUND`,
`TARGET_DUPLICATE`, `TARGET_NOT_EXPORTED`, `REPLAY_DIVERGED`,
`ARTIFACTS_STALE`, `WAKE_UNVERIFIED`, `PUBLIC_URL_UNRESOLVED`,
`SETUP_REQUIRED`, `PAYLOAD_NOT_JSON`, `WORK_DEAD_LETTERED`,
`NAMESPACE_AMBIGUOUS`, and `RUNTIME_HOST_ONLY`.

## Import Paths

`@use-crux/core` exposes SDK-agnostic primitives through focused subpaths:

| Import                         | Area                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@use-crux/core`               | Prompts, contexts, config, runtime helpers, common types.                                                                                    |
| `@use-crux/core/memory`        | Memory blocks, stores, capture, recall, and compaction hooks.                                                                                |
| `@use-crux/core/retrieval`     | Retrievers, rerankers, grounding inputs, and RAG pipelines.                                                                                  |
| `@use-crux/core/safety`        | Guardrails, constraints, safety plugins, and validation retry.                                                                               |
| `@use-crux/core/quality`       | Evaluations, suites, assertions, scorers, gates, variants, and baselines.                                                                    |
| `@use-crux/core/agent`         | Agents, blackboards, handoffs, delegates, parallel, pipeline, consensus, and swarm.                                                          |
| `@use-crux/core/flow`          | Suspendable typed workflows.                                                                                                                 |
| `@use-crux/core/runtime`       | Runtime Engine composers, port contracts, diagnostics, wake envelopes, kernel composites, outbox dispatch, pure retry/state helpers, and the in-memory runtime store. |
| `@use-crux/core/runtime/testing` | Runtime Engine store and kernel conformance suites for adapter authors.                                                                    |
| `@use-crux/core/observability` | Canonical graph records, devtools transport, subscribers, diagnostics channel, and the per-turn `TurnDecisionReport` explanation read model. |
| `@use-crux/core/project-index` | Public Project Index contracts for local devtools and source intelligence.                                                                   |

See the full [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) for every subpath and API.

## TypeScript Compatibility

`@use-crux/core` is verified against TypeScript `>=5.5 <7`. TypeScript 7 is tracked with `@typescript/native-preview` / `tsgo` as a preview lane, not a stable support promise yet.

## Learn More

- [Crux docs](https://cruxjs.dev)
- [Get started](https://cruxjs.dev/docs/getting-started)
- [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core)
- [Runtime Engine reference](https://cruxjs.dev/docs/reference/crux-core/runtime-engine)
- [Mental model](https://cruxjs.dev/docs/foundations/mental-model)
- [Examples](https://github.com/use-crux/crux/tree/main/examples)
- [GitHub repository](https://github.com/use-crux/crux)
