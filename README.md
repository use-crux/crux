<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/crux-logo-dark.svg">
    <img src="assets/crux-logo.svg" alt="Crux" width="320">
  </picture>
</p>

<h1 align="center">Crux</h1>

<p align="center">
  <strong>Typed building blocks for everything around your LLM call.</strong>
</p>

<p align="center">
  Bring your own SDK. Use one block or ten. Compose prompts, memory, retrieval, tools, guardrails, routing, evals, and observability without locking into a framework.
</p>

> [!WARNING]
> Crux is in alpha development. APIs may change, things may break, and examples may lag behind the implementation until the first stable release.

<p align="center">
  <a href="https://cruxjs.dev/docs/getting-started">Get started</a>
  |
  <a href="https://cruxjs.dev/why">Why Crux</a>
  |
  <a href="https://cruxjs.dev/docs/foundations/mental-model">How it works</a>
  |
  <a href="https://cruxjs.dev/observability">Observability</a>
  |
  <a href="https://cruxjs.dev/docs/reference/crux-core">@crux/core</a>
</p>

## What is Crux?

Crux is an open-source TypeScript toolkit for building the harness around an LLM call.

Your app still owns the product logic, routing, deployment, and data. Your chosen SDK still calls the model. Crux gives you typed, observable building blocks around that call: prompts, memory, retrieved knowledge, tools, guardrails, constraints, routing, evals, traces, costs, and local devtools.

Use one block or use ten. Context engineering is part of the harness, but Crux also covers what happens before the model, during tool and provider execution, after output validation, and across the feedback loop that tells you whether the system still works.

## Start With One Prompt

```ts
import { prompt } from '@crux/core'
import { generate } from '@crux/ai'
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
import { prompt } from '@crux/core'
import { memory, facts, recentMessages } from '@crux/core/memory'
import { retriever } from '@crux/core/retrieval'
import { constraint, guardrail } from '@crux/core/safety'
import { generate } from '@crux/ai'
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

Now the call has memory, retrieval, input screening, structured output, retryable quality checks, adapter execution, and traceable events. Replace any block with your own implementation when the default stops fitting.

## What the harness handles

| Capability         | What Crux gives you                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Prompt definitions | Typed `prompt()` objects with input/output schemas, settings, tags, tests, and provider overrides                          |
| Composable context | `context()` blocks for brand voice, policies, retrieved docs, formatting rules, and shared tools                           |
| Memory             | Recent messages, working state, episodes, facts, procedures, proposals, policies, and pluggable stores                     |
| Retrieval          | Indexers, corpora, retrievers, rerankers, grounding, citations, and custom RAG pipelines                                   |
| Tools              | Prompt tools, context tools, middleware, approval flows, and audit events                                                  |
| Safety             | Guardrails for I/O filtering plus constraints for semantic output validation and retry                                     |
| Routing and cost   | Model routers, fallback, semantic cache, pricing tables, budgets, and cost spans                                           |
| Evaluation         | Local quality suites, prompt tests, judges, variants, cassettes, baselines, and CI-friendly runs                           |
| Agents and flows   | Agents, pipelines, parallel runs, consensus, swarms, blackboards, handoffs, delegates, suspendable flows, plans, and tasks |
| Observability      | Devtools, trace timelines, event graphs, source catalog, lint findings, and OpenTelemetry export                           |

## How it works

Every execution follows the same pipeline:

```txt
define -> resolve -> adapt -> observe
```

| Stage   | What happens                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Define  | Author pure TypeScript definitions: prompts, contexts, memory blocks, tools, agents, flows, tests, and settings. They do not import a provider SDK.             |
| Resolve | At call time, Crux validates input, filters conditional blocks, merges tools/settings, applies token budgets, and produces a provider-agnostic resolved prompt. |
| Adapt   | An adapter maps that resolved prompt to Vercel AI SDK, OpenAI, Anthropic, Google GenAI, Convex Agent, or another runner.                                        |
| Observe | Hooks emit structured events for generations, context resolution, memory reads/writes, retrieval, tools, evals, judge scores, artifacts, errors, and cost.      |

This separation is the point. You can inspect what the model will see, run the same prompt through multiple providers, and keep evals tied to the definitions they protect.

## Where it fits

Crux is deliberately modular. Use one primitive or build the whole harness; either way, your model SDK, application architecture, and data stores stay yours.

| If you need...                    | Crux gives you...                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Vercel AI SDK execution           | A typed memory, retrieval, safety, eval, and observability harness on top of an excellent execution and UI toolkit.         |
| Direct provider SDK access        | Structure, portability, schemas, traceability, and testability while preserving direct provider access.                     |
| Your own agent loop               | Typed prompts, handoffs, blackboards, memory, evals, and telemetry that compose with your existing runtime.                 |
| A scalable prompt system          | Shared definitions, context blocks, tests, and catalog visibility without moving prompts into a hosted system.              |
| An alternative to a big framework | Small primitives around the SDK call: compose memory, retrieval, safety, evals, and observability only where you need them. |

Use raw strings for one-off prompts. Reach for Crux when the call needs memory, retrieval, structured output, safety, evaluation, tracing, or provider flexibility. Start with one block, add more as the system asks for it, and replace any block with your own when you outgrow the default.

## What Crux Is Not

- **Not another model SDK.** Crux delegates execution to Vercel AI SDK, OpenAI, Anthropic, Google GenAI, or your own adapter.
- **Not a required runtime.** `@crux/local` is the local devtools/runtime for development; production calls run in your application.
- **Not an application framework.** Crux does not own routing, deployment, data fetching, or project structure.
- **Not a prompt-management SaaS.** Prompts live in code, versioned in git, reviewed in pull requests.
- **Not all-in orchestration.** Adopt the pieces you need and replace them independently.

## Get started

Install the core package and an adapter:

```bash
pnpm add @crux/core @crux/ai ai @ai-sdk/openai zod
```

Pick a walkthrough:

- [Next.js](https://cruxjs.dev/docs/getting-started/nextjs)
- [Node.js](https://cruxjs.dev/docs/getting-started/node)
- [Convex](https://cruxjs.dev/docs/getting-started/convex)
- [Expo / React Native](https://cruxjs.dev/docs/getting-started/expo)

## Packages

| Package           | Purpose                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@crux/core`      | SDK-agnostic primitives for prompts, contexts, memory, storage, retrieval, safety, routing, quality, agents, flows, plans, tasks, skills, and observability. |
| `@crux/ai`        | Vercel AI SDK adapter for `generate`, `stream`, structured output, and Crux-aware stream integration.                                                        |
| `@crux/openai`    | OpenAI SDK adapter.                                                                                                                                          |
| `@crux/anthropic` | Anthropic SDK adapter.                                                                                                                                       |
| `@crux/google`    | Google GenAI SDK adapter.                                                                                                                                    |
| `@crux/convex`    | Convex storage, server boundaries, agent bridge, compaction, and swarm integration.                                                                          |
| `@crux/upstash`   | Upstash Vector and Redis-backed storage adapters.                                                                                                            |
| `@crux/otel`      | OpenTelemetry integration for production traces.                                                                                                             |
| `@crux/ingest`    | Source loaders for text, files, folders, globs, and URLs.                                                                                                    |
| `@crux/react`     | React provider, hooks, transports, and SSE helpers for live Crux state.                                                                                      |
| `@crux/devtools`  | React devtools UI bundle for traces, evals, source catalog, memory, plans, and runtime inspection.                                                           |
| `@crux/local`     | Native local runtime, CLI, TUI, HTTP/WS server, embedded devtools, eval runner, catalog, lint, and bounded helper workers.                                   |

## Learn more

- [Why Crux](https://cruxjs.dev/why)
- [Foundations](https://cruxjs.dev/docs/foundations)
- [Primitives](https://cruxjs.dev/docs/foundations/primitives)
- [Cookbook](https://cruxjs.dev/docs/cookbook)
- [Observability](https://cruxjs.dev/observability)
- [API reference](https://cruxjs.dev/docs/reference)

## Contributing

Crux is alpha software and the project is still changing quickly. Contributions are welcome, but please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.
