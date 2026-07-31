# @use-crux/core

**The SDK-agnostic foundation for harness engineering in TypeScript.**

`@use-crux/core` gives you typed building blocks for everything around the model call: prompts, contexts, memory, retrieval, tools, guardrails, constraints, routing, Evals, agents, flows, and observability.

Your app still owns product logic, routing, deployment, and data. Your model SDK still makes the call. Crux makes the harness around that call deliberate, inspectable, testable, and portable across adapters.

> [!NOTE]
> `@use-crux/core` is in stable beta for its core composition and adapter
> contracts. See [STABILITY.md](./STABILITY.md) for the exact surface and
> compatibility promise.

## Install

Crux packages are ESM-only. The `@use-crux/core` root and portable runtime
subpaths work in web-standard runtimes, including Workers-style isolates. Node
22 or newer is required only for the explicitly Node/build-time subpaths noted
below. Most apps install `@use-crux/core` with an execution adapter. For the
Vercel AI SDK:

```bash
pnpm add @use-crux/core @use-crux/ai ai @ai-sdk/openai zod
```

Prefer a provider SDK directly? Use `@use-crux/openai`, `@use-crux/anthropic`, or `@use-crux/google` instead of `@use-crux/ai`.

```bash
pnpm add @use-crux/openai openai
pnpm add @use-crux/anthropic @anthropic-ai/sdk
pnpm add @use-crux/google @google/genai
```

To compose portable tools from an MCP server, install `@use-crux/mcp` and add
its inert `mcp()` definition to a prompt or context `use[]`. The active adapter
materializes that source before provider I/O, while the resulting tools keep the
ordinary middleware, approval, Safety, observability, and Eval lifecycle.
Core owns only this provider-neutral tool-source boundary; the opt-in MCP
package owns protocol clients and transports.

```ts
import { mcp, streamableHttp } from "@use-crux/mcp";

const catalog = mcp({
  id: "catalog",
  transport: streamableHttp({ url: "https://mcp.example.com" }),
  tools: { allow: ["lookup"], prefix: "catalog_" },
});
```

See the [MCP guide](https://cruxjs.dev/docs/guides/tools/mcp) for credentials,
approval resume, Eval materialization, and lifecycle guidance.

## Start with one prompt

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

## Operation result correlation

Successful observed public operation envelopes expose readonly `_meta.traceId`
and `_meta.spanId`, identifying the exact Core span that produced the result.
That operation pair is distinct from a provider's `_meta.responseId`, a logical
`runId`, and a physical execution `segmentId`. Streaming exposes the stable pair
immediately and retains it on completion. See the
[operation result correlation reference](https://cruxjs.dev/docs/reference/crux-core/operation-results)
for ownership and compatibility details.

## Compose more as you need it

Prompts declare what they need through the `use` array. Memory, retrieval, guardrails, skills, and custom blocks all plug into the same call, so you add capability without adopting a framework or runtime:

```ts
import { prompt } from "@use-crux/core";
import { memory, facts } from "@use-crux/core/memory";
import { retriever } from "@use-crux/core/retrieval";
import { boundary, constraint, guardrail } from "@use-crux/core/safety";
import { generate, stableModel } from "@use-crux/ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const chat = memory({
  id: "assistant",
  records,
  namespace: ({ input }) => `user:${input.userId}`,
  blocks: [facts({ id: "about-user", embed })],
});

const docs = retriever({
  id: "docs",
  namespace: "product-docs",
  records,
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

const grounded = constraint({
  id: "grounded",
  on: boundary.output.object<z.infer<typeof ReplyOutputSchema>>(),
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

Now the same call has memory, retrieval, input screening, structured output, retryable constraints, and traceable events. The SDK still makes the model call; Crux makes the harness around it deliberate.

Input Safety is semantic model ingress. `boundary.input.text()` covers user,
converted tool, and rendered retrieval text by default;
`boundary.input.media()` covers user and tool media. Source-specific policy can
use `{ from: "tool" }` or `{ from: "retrieval" }`. Trusted authored instructions
use `boundary.input.instructions()`, but retrieval folded into a system message
remains untrusted retrieval text.

Tool results pass through two explicit layers:
`toolPolicy.result(raw) → toModelOutput → boundary.input.* → model`. Crux never
auto-hydrates retrieved media, and custom model-output conversion cannot bypass
the input guardrails.

## Test the production task

Create a normal callable task with your adapter, then point an inert Eval at
that exact task. Cases and output remain inferred from the task.

```ts
import { generate, stableModel } from "@use-crux/ai";
import { evaluate } from "@use-crux/core/eval";
import { supportModel, supportPrompt } from "./src/support-config";

export const support = generate.task(supportPrompt, {
  model: stableModel(supportModel),
  temperature: 0.2,
});

export default evaluate({
  id: "support",
  task: support,
  cases: [{ id: "refund", input: { question: "Can I get a refund?" } }],
  expect: ({ output, expect }) => {
    expect(output.answer).toContain("refund");
  },
});
```

`crux eval` always includes Current, compares declared Variants, and reuses
only exact safe evidence. Use `--offline` for zero network access, `--plan` to
inspect admitted work, or explicitly accept a complete run as a Baseline.
Each Eval cell is an isolated execution scope. Calls to `defer()` made by the
task are captured as cell evidence instead of executing side effects or
staging named Runtime work.

## Background work

Inside a Crux agent turn, adapter call, tool execution, or Safety session,
`defer()` works without a wrapper or host configuration. Work registers on the
nearest execution scope and starts when that scope closes, so a nested tool can
begin its cleanup while the enclosing model call continues.

On a freezing platform, the configured `host` capability applies to these
primitive roots too: it keeps an already-started drain alive without delaying
that drain until the response boundary.

At a handler's root level, configure an explicit platform retention capability
once, then call `defer()` without a route wrapper on ambient hosts:

```ts
import { config, defer } from "@use-crux/core";
import { next } from "@use-crux/next";

config({ host: next() });
defer(() => flushAnalytics());
```

Each config-only call owns an ephemeral invocation. Crux primitives group
registrations within their execution lifetime; use a wrapper when the handler
needs outcome classification or a strict named-work commit barrier. Inline
callbacks registered by failed or cancelled scopes are recorded as skipped and
are not invoked. Replayable flow bodies remain special: use `flow.defer()`
instead of public `defer()`.

## What's inside

`@use-crux/core` exposes SDK-agnostic primitives through focused subpaths:

| Import                         | Area                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `@use-crux/core`               | Prompts, contexts, config, injection-defense helpers (`safe`, `escapeXml`), and common types.      |
| `@use-crux/core/memory`        | Memory blocks, storage, capture, proposals, and recall.                                            |
| `@use-crux/core/embedding`     | Dense/sparse embeddings, typed media inputs, vector-space identity, governance, and caching.       |
| `@use-crux/core/indexing`      | Text/media document indexing, corpus sync, attribution, and embedding-stage caching.               |
| `@use-crux/core/retrieval`     | Text/media retrievers, rerankers, grounding inputs, and RAG pipelines.                             |
| `@use-crux/core/safety`        | Guardrails, constraints, safety plugins, and validation retry.                                     |
| `@use-crux/core/eval`          | Inert Evals, typed Cases, Variants, checks, scorers, and Gates.                                    |
| `@use-crux/core/eval/node`     | Node discovery, Case hydration, planning, execution, and `runEval()`.                              |
| `@use-crux/core/feedback`      | Awaited durable production feedback linked to a canonical run id.                                  |
| `@use-crux/core/agent`         | Agents, blackboards, handoffs, delegates, and compositions (parallel, pipeline, consensus, swarm). |
| `@use-crux/core/flow`          | Suspendable, resumable typed workflows.                                                            |
| `@use-crux/core/runtime`       | The durable Runtime Engine composers, ports, and diagnostics.                                      |
| `@use-crux/core/observability` | Canonical graph records, transports, and the per-turn decision report read model.                  |
| `@use-crux/core/skill`         | Skill authoring with inline and registry loaders.                                                  |

Node-only/build-time subpaths are explicit: `eval/node`, `setup`,
`runtime/next` (`withCruxBuild`), `defer/node`, `observability/node`, `transcription/node`,
`skill/node`, and the Vitest testing helpers. Portable application code should
not re-export them from a Workers or browser entrypoint.

## Search text and media in one space

Native multimodal embeddings use the same indexing and retrieval API as text.
The provider declares which inputs belong to its shared vector space:

```ts
import { GoogleGenAI } from "@google/genai";
import { indexer } from "@use-crux/core/indexing";
import { retriever } from "@use-crux/core/retrieval";
import { inMemoryStorage } from "@use-crux/core/storage";
import { embedding } from "@use-crux/google";

const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const embed = embedding(client, { model: "gemini-embedding-2" });
const storage = inMemoryStorage();

const productsIndexer = indexer({
  id: "products",
  namespace: "products",
  storage,
  dense: embed,
});

await productsIndexer.indexDocuments([
  { namespace: "products", sourceId: "rex", title: "Rex", asset: dogPhoto },
  { namespace: "products", sourceId: "faq", content: "Our return policy…" },
]);

const products = retriever({
  id: "products",
  namespace: "products",
  storage,
  dense: embed,
});

const textHits = await products.retrieve("dog");
const imageHits = await products.retrieve(dogPhoto);
const photo = await storage.assets?.get(textHits[0].source.assetRef!);
```

An indexed namespace is bound to the dense embedding space that built it.
Changing model, dimensions, normalization, or role-task semantics throws
`EmbeddingSpaceMismatchError` before writes or search; clear and fully reindex
the namespace, or use a new one.

Media payloads live in `AssetStore`, never in vector metadata, records, caches,
or traces. Similarity ranking is not an exact-duplicate guarantee—use SHA-256
for exact identity, and evaluate text-to-image, image-to-image, and image-to-text
quality separately on representative domain fixtures. See the
[multimodal search guide](https://cruxjs.dev/docs/guides/retrieval/multimodal-search).

## Cache expensive indexing work

`indexer({ cache: true })` caches both preparation stages and final dense/sparse
embedding bundles per source. Identical content can therefore be reindexed—after
an `indexVersion` change or a dry run—without another embedding provider call.
Use `{ cache: "refresh" }` to recompute and replace entries, or
`{ cache: "bypass" }` to read and write no stage entries for that call.

Embeddings created with `embedding()` carry a vector-semantic `fingerprint`.
Set `version` when provider behavior can change without changing the embedding
name; hand-written structural embeddings without a fingerprint are deliberately
never stage-cached. The optional `embeddingCache()` is a separate, finer-grained
per-input cache and can be used together with the indexer cache.

## Documentation

The README stays short on purpose. Full guides and the complete API reference live at [cruxjs.dev](https://cruxjs.dev):

- [Prompts](https://cruxjs.dev/docs/guides/prompts), [Contexts](https://cruxjs.dev/docs/guides/contexts), and [Tools](https://cruxjs.dev/docs/guides/tools)
- [Memory](https://cruxjs.dev/docs/guides/memory) and [Retrieval & RAG](https://cruxjs.dev/docs/guides/retrieval)
- [Safety](https://cruxjs.dev/docs/guides/safety) (guardrails, constraints) and [Routing & Fallback](https://cruxjs.dev/docs/guides/routing)
- [Agents](https://cruxjs.dev/docs/guides/agents), [Flows](https://cruxjs.dev/docs/guides/flows), and [Workspaces](https://cruxjs.dev/docs/guides/workspaces)
- [Durable Execution](https://cruxjs.dev/docs/guides/durable-execution) (the Runtime Engine)
- [Evals](https://cruxjs.dev/docs/guides/evals) and [Observability](https://cruxjs.dev/docs/guides/observability)
- [Media and multimodal](https://cruxjs.dev/docs/guides/media), [tool approvals](https://cruxjs.dev/docs/guides/tools/approvals), and [headless calls](https://cruxjs.dev/docs/guides/advanced/headless)
- [Full `@use-crux/core` API reference](https://cruxjs.dev/docs/reference/crux-core)

## TypeScript compatibility

`@use-crux/core` is verified against TypeScript `>=5.5 <7`. TypeScript 7 is tracked through `@typescript/native-preview` / `tsgo` as a preview lane, not a stable support promise yet.

## Learn more

- [Get started](https://cruxjs.dev/docs/getting-started)
- [Mental model](https://cruxjs.dev/docs/foundations/mental-model)
- [Cookbook](https://cruxjs.dev/docs/cookbook)
- [Examples](https://github.com/use-crux/crux/tree/main/examples)
- [GitHub repository](https://github.com/use-crux/crux)
