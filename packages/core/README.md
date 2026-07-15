# @use-crux/core

**The SDK-agnostic foundation for harness engineering in TypeScript.**

`@use-crux/core` gives you typed building blocks for everything around the model call: prompts, contexts, memory, retrieval, tools, guardrails, constraints, routing, evaluation, agents, flows, and observability.

Your app still owns product logic, routing, deployment, and data. Your model SDK still makes the call. Crux makes the harness around that call deliberate, inspectable, testable, and portable across adapters.

> [!NOTE]
> `@use-crux/core` is in stable beta for its core composition and adapter
> contracts. See [STABILITY.md](./STABILITY.md) for the exact surface and
> compatibility promise.

## Install

Crux packages are ESM-only and require Node.js 22 or newer. Most apps install `@use-crux/core` with an execution adapter. For the Vercel AI SDK:

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
ordinary middleware, approval, Safety, observability, and Quality lifecycle.
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
approval resume, Quality mocks, and lifecycle guidance.

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

## Compose more as you need it

Prompts declare what they need through the `use` array. Memory, retrieval, guardrails, skills, and custom blocks all plug into the same call, so you add capability without adopting a framework or runtime:

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

Now the same call has memory, retrieval, input screening, structured output, retryable quality checks, and traceable events. The SDK still makes the model call; Crux makes the harness around it deliberate.

## What's inside

`@use-crux/core` exposes SDK-agnostic primitives through focused subpaths:

| Import                         | Area                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `@use-crux/core`               | Prompts, contexts, config, injection-defense helpers (`safe`, `escapeXml`), and common types.      |
| `@use-crux/core/memory`        | Memory blocks, stores, capture, recall, and compaction hooks.                                      |
| `@use-crux/core/retrieval`     | Retrievers, rerankers, grounding inputs, and RAG pipelines.                                        |
| `@use-crux/core/safety`        | Guardrails, constraints, safety plugins, and validation retry.                                     |
| `@use-crux/core/quality`       | Evaluations, suites, assertions, scorers, gates, variants, and baselines.                          |
| `@use-crux/core/agent`         | Agents, blackboards, handoffs, delegates, and compositions (parallel, pipeline, consensus, swarm). |
| `@use-crux/core/flow`          | Suspendable, resumable typed workflows.                                                            |
| `@use-crux/core/runtime`       | The durable Runtime Engine composers, ports, and diagnostics.                                      |
| `@use-crux/core/observability` | Canonical graph records, transports, and the per-turn decision report read model.                  |
| `@use-crux/core/skill`         | Skill authoring with inline and registry loaders.                                                  |

## Documentation

The README stays short on purpose. Full guides and the complete API reference live at [cruxjs.dev](https://cruxjs.dev):

- [Prompts](https://cruxjs.dev/docs/guides/prompts), [Contexts](https://cruxjs.dev/docs/guides/contexts), and [Tools](https://cruxjs.dev/docs/guides/tools)
- [Memory](https://cruxjs.dev/docs/guides/memory) and [Retrieval & RAG](https://cruxjs.dev/docs/guides/retrieval)
- [Safety](https://cruxjs.dev/docs/guides/safety) (guardrails, constraints) and [Routing & Fallback](https://cruxjs.dev/docs/guides/routing)
- [Agents](https://cruxjs.dev/docs/guides/agents), [Flows](https://cruxjs.dev/docs/guides/flows), and [Workspaces](https://cruxjs.dev/docs/guides/workspaces)
- [Durable Execution](https://cruxjs.dev/docs/guides/durable-execution) (the Runtime Engine)
- [Quality](https://cruxjs.dev/docs/guides/quality) and [Observability](https://cruxjs.dev/docs/guides/observability)
- [Multimodal messages](https://cruxjs.dev/docs/guides/advanced/multimodal), [tool approvals](https://cruxjs.dev/docs/guides/tools/approvals), and [headless calls](https://cruxjs.dev/docs/guides/advanced/headless)
- [Full `@use-crux/core` API reference](https://cruxjs.dev/docs/reference/crux-core)

## TypeScript compatibility

`@use-crux/core` is verified against TypeScript `>=5.5 <7`. TypeScript 7 is tracked through `@typescript/native-preview` / `tsgo` as a preview lane, not a stable support promise yet.

## Learn more

- [Get started](https://cruxjs.dev/docs/getting-started)
- [Mental model](https://cruxjs.dev/docs/foundations/mental-model)
- [Cookbook](https://cruxjs.dev/docs/cookbook)
- [Examples](https://github.com/use-crux/crux/tree/main/examples)
- [GitHub repository](https://github.com/use-crux/crux)
