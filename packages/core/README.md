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
import { prompt } from '@use-crux/core'
import { generate } from '@use-crux/ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const classify = prompt({
  id: 'classify',
  input: z.object({ text: z.string() }),
  output: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
  }),
  system: 'Classify the sentiment of the given text.',
  prompt: ({ input }) => input.text,
})

const result = await generate(classify, {
  model: openai('gpt-4o'),
  input: { text: 'This is incredible.' },
})

result.object.sentiment // 'positive' | 'negative' | 'neutral'
```

That is a complete Crux program: typed input, typed output, and your SDK still making the model call.

## Add Blocks As You Need Them

The `use` array is the bus. Memory, retrieval, guardrails, skills, blackboards, and custom blocks all plug into the same prompt without forcing a framework or runtime around your app.

```ts
import { prompt } from '@use-crux/core'
import { memory, facts, recentMessages } from '@use-crux/core/memory'
import { retriever } from '@use-crux/core/retrieval'
import { constraint, guardrail } from '@use-crux/core/safety'
import { generate } from '@use-crux/ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const chat = memory({
  id: 'assistant',
  store,
  namespace: ({ input }) => `user:${input.userId}`,
  blocks: [recentMessages({ id: 'recent', maxMessages: 12 }), facts({ id: 'about-user', embed })],
})

const docs = retriever({
  id: 'docs',
  namespace: 'product-docs',
  data,
  vectors,
  dense,
  context: { query: ({ question }) => question },
})

const injection = guardrail({
  name: 'injection',
  phase: 'input',
  validate: detectPromptInjection,
})

const grounded = constraint({
  name: 'grounded',
  severity: 'assert',
  check: async (output) =>
    output.parsed.citations.length > 0 ? { pass: true } : { pass: false, feedback: 'Cite at least one source.' },
})

const reply = prompt({
  id: 'reply',
  use: [chat, docs],
  input: z.object({ userId: z.string(), question: z.string() }),
  output: z.object({
    answer: z.string(),
    citations: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
  system: 'Answer from memory and product docs. Do not invent facts.',
  prompt: ({ input }) => input.question,
})

const result = await generate(reply, {
  model: openai('gpt-4o'),
  input: { userId: 'user_123', question: 'What did we decide about the launch plan?' },
  guardrails: [injection],
  constraints: [grounded],
})
```

Now the call has memory, retrieval, input screening, structured output, retryable quality checks, adapter execution, and traceable events.

## What Core Gives You

| Capability         | What it is for                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Prompt definitions | Typed `prompt()` objects with input/output schemas, settings, tags, tests, and provider overrides.                          |
| Composable context | `context()` blocks for brand voice, policies, retrieved docs, formatting rules, and shared tools.                           |
| Memory             | Recent messages, working state, episodes, facts, procedures, proposals, policies, and pluggable stores.                     |
| Retrieval          | Indexers, corpora, retrievers, rerankers, grounding, citations, and custom RAG pipelines.                                   |
| Tools              | Prompt tools, context tools, middleware, approval flows, and audit events.                                                  |
| Safety             | Guardrails for input/output filtering plus constraints for semantic output validation and retry.                            |
| Routing and cost   | Model routers, fallback, semantic cache, pricing tables, budgets, and cost spans.                                           |
| Evaluation         | Quality suites, prompt tests, judges, variants, cassettes, baselines, and CI-friendly runs.                                 |
| Agents and flows   | Agents, pipelines, parallel runs, consensus, swarms, blackboards, handoffs, delegates, suspendable flows, plans, and tasks. |
| Observability      | Trace records, local devtools, subscribers, diagnostics channel export, source catalog, and OpenTelemetry export.            |

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
| Observe | Graph records emit once, then feed subscribers, the diagnostics channel, devtools transport, and telemetry sinks.                                |

This separation lets you inspect what the model will see, run the same prompt through multiple providers, and keep quality checks tied to the definitions they protect.

## Import Paths

`@use-crux/core` exposes SDK-agnostic primitives through focused subpaths:

| Import                         | Area                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `@use-crux/core`               | Prompts, contexts, config, runtime helpers, common types.                           |
| `@use-crux/core/memory`        | Memory blocks, stores, capture, recall, and compaction hooks.                       |
| `@use-crux/core/retrieval`     | Retrievers, rerankers, grounding inputs, and RAG pipelines.                         |
| `@use-crux/core/safety`        | Guardrails, constraints, safety plugins, and validation retry.                      |
| `@use-crux/core/quality`       | Evaluations, suites, assertions, scorers, gates, variants, and baselines.           |
| `@use-crux/core/agent`         | Agents, blackboards, handoffs, delegates, parallel, pipeline, consensus, and swarm. |
| `@use-crux/core/flow`          | Suspendable typed workflows.                                                        |
| `@use-crux/core/observability` | Canonical graph records, devtools transport, subscribers, and diagnostics channel.   |
| `@use-crux/core/project-index` | Public Project Index contracts for local devtools and source intelligence.          |

See the full [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) for every subpath and API.

## TypeScript Compatibility

`@use-crux/core` is verified against TypeScript `>=5.5 <7`. TypeScript 7 is tracked with `@typescript/native-preview` / `tsgo` as a preview lane, not a stable support promise yet.

## Learn More

- [Crux docs](https://cruxjs.dev)
- [Get started](https://cruxjs.dev/docs/getting-started)
- [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core)
- [Mental model](https://cruxjs.dev/docs/foundations/mental-model)
- [Examples](https://github.com/use-crux/crux/tree/main/examples)
- [GitHub repository](https://github.com/use-crux/crux)
