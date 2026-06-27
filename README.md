<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/crux-logo-dark.svg">
    <img src="assets/crux-logo.svg" alt="Crux" width="320">
  </picture>
</p>

<h1 align="center">Crux</h1>

<p align="center">
  <strong>The TypeScript toolkit for harness engineering.</strong>
</p>

<p align="center">
  Bring your SDK, models, and app framework. Crux helps you deliberately assemble, inspect, and test the whole model turn around the call you already own.
</p>

> [!WARNING]
> Crux is in alpha development. APIs may change, things may break, and examples may lag behind the implementation until the first stable release.

<p align="center">
  <a href="https://github.com/use-crux/crux/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/use-crux/crux/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://cruxjs.dev"><img alt="Docs" src="https://img.shields.io/badge/docs-cruxjs.dev-111111"></a>
  <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-orange">
</p>

<p align="center">
  <a href="https://cruxjs.dev/docs/getting-started">Get started</a>
  |
  <a href="https://cruxjs.dev/why">Why Crux</a>
  |
  <a href="https://cruxjs.dev/docs/foundations/mental-model">How it works</a>
  |
  <a href="https://cruxjs.dev/observability">Observability</a>
  |
  <a href="https://cruxjs.dev/docs/reference/crux-core">@use-crux/core</a>
</p>

## What is Crux?

Crux is an open-source TypeScript toolkit for **harness engineering**: typed building blocks for everything around the model call.

Your app still owns the product logic, routing, deployment, and data. Your chosen SDK still calls the model. Crux composes around that call with typed, observable building blocks: prompts, contexts, memory, retrieved knowledge, tools, guardrails, constraints, routing, quality suites, traces, costs, and local devtools.

When AI features fail, the problem is often not "the model is bad." It is stale context, missing memory, dropped instructions, unsafe input, an undeclared fallback, or a test that should have caught the regression. Crux gives those pieces structure so you can see what the model saw, why it saw it, and whether the setup still works.

Use one block or use ten. Start with a typed prompt, add memory when state gets messy, add retrieval when facts matter, add guardrails when inputs get risky, add quality suites when regressions start hurting. Crux stays modular while the pieces keep working together around the SDK you already use.

The mission line is "Same Prompt. Same Output. Every Time." In practice, that means deterministic setup around the model call, not a claim that model outputs are deterministic.

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

Now the call has memory, retrieval, input screening, structured output, retryable quality checks, adapter execution, and traceable events. The SDK still makes the model call; Crux makes the harness around it deliberate.

## Get started

Install the core package and an adapter:

```bash
pnpm add @use-crux/core @use-crux/ai ai @ai-sdk/openai zod
```

Pick a walkthrough:

- [Next.js](https://cruxjs.dev/docs/getting-started/nextjs)
- [Node.js](https://cruxjs.dev/docs/getting-started/node)
- [Convex](https://cruxjs.dev/docs/getting-started/convex)
- [Expo / React Native](https://cruxjs.dev/docs/getting-started/expo)

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

This separation is the point. You can inspect what the model will see, run the same prompt through multiple providers, and keep quality checks tied to the definitions they protect.

Under the hood, Crux has three layers:

- **Catalog:** adopt typed prompts, contexts, memory, retrieval, guardrails, routing, quality, or devtools one block at a time.
- **Bus:** every contribution enters the model call through the same `use[]` composition model, instead of becoming another hidden side channel.
- **Proof:** because the pieces share one composition model, Crux can show what happened and test the setup around the answer.

## What Crux Is Not

- **Not another model SDK.** Crux delegates execution to Vercel AI SDK, OpenAI, Anthropic, Google GenAI, or your own adapter.
- **Not a required runtime.** `@use-crux/local` is the local devtools/runtime for development; production calls run in your application.
- **Not an application framework.** Crux does not own routing, deployment, data fetching, or project structure.
- **Not a prompt-management SaaS.** Prompts live in code, versioned in git, reviewed in pull requests.
- **Not all-in orchestration.** Adopt the pieces you need and replace them independently.

## Packages

| Package               | Purpose                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@use-crux/core`      | SDK-agnostic primitives for prompts, contexts, memory, storage, retrieval, safety, routing, quality, agents, flows, plans, tasks, skills, and observability. |
| `@use-crux/ai`        | Vercel AI SDK adapter for `generate`, `stream`, structured output, and Crux-aware stream integration.                                                        |
| `@use-crux/openai`    | OpenAI SDK adapter.                                                                                                                                          |
| `@use-crux/anthropic` | Anthropic SDK adapter.                                                                                                                                       |
| `@use-crux/google`    | Google GenAI SDK adapter.                                                                                                                                    |
| `@use-crux/convex`    | Convex storage, server boundaries, agent bridge, compaction, and swarm integration.                                                                          |
| `@use-crux/upstash`   | Upstash Vector and Redis-backed storage adapters.                                                                                                            |
| `@use-crux/otel`      | OpenTelemetry integration for production traces.                                                                                                             |
| `@use-crux/ingest`    | Source loaders for text, files, folders, globs, and URLs.                                                                                                    |
| `@use-crux/react`     | React provider, hooks, transports, and SSE helpers for live Crux state.                                                                                      |
| `@use-crux/devtools`  | React devtools UI bundle for traces, evals, source catalog, memory, plans, and runtime inspection.                                                           |
| `@use-crux/local`     | Native local runtime, CLI, TUI, HTTP/WS server, embedded devtools, eval runner, catalog, lint, and bounded helper workers.                                   |

## Project status

Crux is alpha. The shipped foundation includes typed prompts and contexts, conditional and budgeted context resolution, memory blocks, retrieval and grounding, guardrails and constraints, routing and fallback, quality suites, a canonical observability graph, local devtools/runtime, OpenTelemetry export, and Project Index source intelligence.

The deeper proof layer is still being completed. The whole-call decision report, richer rationale artifacts for routing/consensus/fallback/boundaries, a unified freshness vocabulary, context contract metadata, and the polished harness-decision matcher library are in progress.

Planned work includes definition-centric health pages, PR/CI review mode, suggested fixes, an open decision-provenance specification, pluggable runtime profiles, advanced reliability workflows, and an optional context planner. The docs label these as planned instead of pretending they are already shipped.

## TypeScript compatibility

Crux public TypeScript packages are verified against TypeScript `>=5.5 <7`. The repository keeps explicit compatibility checks for the lower bound (`typescript@5.5.4`), the current stable major (`typescript@6.0.3`), and the checked-in compiler version.

TypeScript 7 is tracked through `@typescript/native-preview` / `tsgo` as a preview lane. That lane validates the public package type surfaces where the native preview can run today, but it is not a stable support promise until the TypeScript 7 compiler and programmatic APIs settle.

`@use-crux/indexer` is different from the other packages: it uses the TypeScript compiler as a runtime dependency for source intelligence and includes the compiler version in cache identity. Its stable compatibility is tested with the JavaScript `typescript` package; TypeScript 7 native-preview support is intentionally treated as a separate indexer-runtime project.

## Learn more

- [Why Crux](https://cruxjs.dev/why)
- [Foundations](https://cruxjs.dev/docs/foundations)
- [Primitives](https://cruxjs.dev/docs/foundations/primitives)
- [Cookbook](https://cruxjs.dev/docs/cookbook)
- [Examples](./examples)
- [Observability](https://cruxjs.dev/observability)
- [API reference](https://cruxjs.dev/docs/reference)

## Community and security

- Bugs and feature requests: [GitHub Issues](https://github.com/use-crux/crux/issues)
- Security reports: read [SECURITY.md](./SECURITY.md) before disclosing a vulnerability
- Contributor expectations: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## Contributing

Crux is alpha software and the project is still changing quickly. Contributions are welcome, but please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.
