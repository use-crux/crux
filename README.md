<p align="center">
  <img src="assets/crux-logo.svg" alt="Crux" width="320" />
</p>

<h1 align="center">Crux</h1>

<p align="center">
  <strong>Typed context engineering for production LLM apps.</strong>
</p>

<p align="center">
  Compose prompts, memory, retrieval, tools, guardrails, routing, evals, and observability around the model SDK you already use.
</p>

<p align="center">
  <a href="./apps/docs/content/docs/getting-started/index.mdx">Get started</a>
  |
  <a href="./apps/docs/content/docs/foundations/index.mdx">What is Crux?</a>
  |
  <a href="./apps/docs/content/docs/foundations/mental-model.mdx">How it works</a>
  |
  <a href="./apps/docs/content/docs/foundations/comparison.mdx">Compare</a>
  |
  <a href="./packages/core/README.md">@crux/core</a>
</p>

> Status: Crux is pre-1.0 and preparing for its initial open source release.
> Package names, APIs, and install commands reflect the intended public shape,
> while packages remain private in this repository during release cleanup.

## What is Crux?

Crux is the typed harness around an LLM call.

Your app still owns the product logic. Your chosen SDK still calls the model. Crux owns the layer that decides what the model sees, what tools it can use, how memory is recalled, how output is validated, how quality is tested, and how the whole run is observed.

That layer usually starts as template strings and helper functions. In production it becomes the hard part: shared context, stale retrieval, missing memory writes, prompt injection checks, model routing, token budgets, evals, trace inspection, and provider migration. Crux gives those concerns first-class TypeScript primitives instead of scattering them across call sites.

```ts
import { context, prompt } from '@crux/core'
import { generate } from '@crux/ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const brand = context({
  id: 'brand',
  priority: 30,
  input: z.object({ tone: z.string().optional() }),
  when: ({ input }) => !!input.tone,
  system: ({ input }) => `Write in a ${input.tone} tone.`,
})

const answerQuestion = prompt({
  id: 'answer-question',
  use: [brand],
  input: z.object({
    question: z.string(),
  }),
  output: z.object({
    answer: z.string(),
    confidence: z.enum(['low', 'medium', 'high']),
  }),
  system: 'Answer clearly and only use information you can support.',
  prompt: ({ input }) => input.question,
})

const result = await generate(answerQuestion, {
  model: openai('gpt-4o'),
  input: {
    question: 'What did we decide about the launch plan?',
    tone: 'direct',
  },
})

result.object.answer
result.object.confidence
```

The prompt is portable data: typed input, typed output, composable context, inspectable resolution, and adapter-specific execution only at the edge.

## Why teams use it

| Need                             | What Crux gives you                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Reuse context without copy-paste | `context()` blocks for brand, policy, retrieved docs, formatting rules, and tools                      |
| Keep prompts type-safe           | Zod input/output schemas with inferred `result.object` types                                           |
| Swap providers                   | Define once, run through Vercel AI SDK, OpenAI, Anthropic, Google GenAI, or agent-framework adapters   |
| Add memory deliberately          | Recent messages, working state, episodes, facts, procedures, and custom memory blocks                  |
| Control token pressure           | Priority-based context merging, sliding windows, budget managers, and compaction                       |
| Ship safer model calls           | Guardrails, constraints, validation retries, tool middleware, and human approvals                      |
| Prove quality before release     | Inline prompt tests, LLM-as-judge scoring, variants, cassettes, and CLI evals                          |
| Debug what happened              | Local devtools, structured traces, artifacts, source catalog, and OpenTelemetry export                 |
| Coordinate agents                | Pipelines, parallel runs, consensus, swarms, blackboards, handoffs, delegates, flows, plans, and tasks |

## How it works

Every execution follows the same pipeline:

```txt
define -> resolve -> adapt -> observe
```

| Stage   | What happens                                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Define  | Author pure TypeScript definitions: prompts, contexts, memory blocks, tools, agents, tests, and settings. They do not import a provider SDK.                                      |
| Resolve | At call time, Crux validates input, filters conditional contexts, merges tools/settings, applies priorities and token budgets, and produces a provider-agnostic `ResolvedPrompt`. |
| Adapt   | An adapter maps that resolved prompt to the SDK you chose: Vercel AI SDK, OpenAI, Anthropic, Google GenAI, Convex Agent, or another runner.                                       |
| Observe | Hooks emit structured events for generations, context resolution, memory reads/writes, tool calls, eval cases, judge scores, artifacts, and errors.                               |

This separation is the point. You can inspect the full prompt payload without calling a model, run the same prompt through multiple providers, and keep evals tied to the definition they protect.

## Where it fits

Crux is complementary to the tools you already know.

| If you use...           | Crux adds...                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Vercel AI SDK           | A typed context, memory, safety, eval, and observability layer on top of an excellent execution and UI toolkit.          |
| Raw provider SDKs       | Structure, portability, schemas, traceability, and testability while preserving direct provider access.                  |
| LangChain or LlamaIndex | Lightweight TypeScript primitives for teams that want the context layer without adopting a full orchestration framework. |
| Your own agent loop     | Typed prompts, handoffs, blackboards, memory, evals, and telemetry that compose with your existing runtime.              |

Use raw strings for one-off prompts. Reach for Crux when prompts share context, need memory, need structured output, must be evaluated, or are important enough to debug like production code.

## Quick start

Once the public packages are published:

```bash
pnpm add @crux/core @crux/ai ai @ai-sdk/openai zod
```

For this repository today:

```bash
pnpm install
pnpm typecheck
pnpm test
```

Pick a stack-specific walkthrough:

- [Next.js](./apps/docs/content/docs/getting-started/nextjs.mdx)
- [Node.js](./apps/docs/content/docs/getting-started/node.mdx)
- [Convex](./apps/docs/content/docs/getting-started/convex.mdx)
- [Expo / React Native](./apps/docs/content/docs/getting-started/expo.mdx)

## Packages

| Package           | Purpose                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@crux/core`      | SDK-agnostic primitives for prompts, contexts, memory, storage, retrieval, compaction, safety, routing, scoring, quality, agents, flows, plans, tasks, skills, and observability. |
| `@crux/ai`        | Vercel AI SDK adapter for `generate`, `stream`, structured output, and Crux-aware stream integration.                                                                             |
| `@crux/openai`    | OpenAI SDK adapter.                                                                                                                                                               |
| `@crux/anthropic` | Anthropic SDK adapter.                                                                                                                                                            |
| `@crux/google`    | Google GenAI SDK adapter.                                                                                                                                                         |
| `@crux/convex`    | Convex store, blob storage, server boundaries, agent bridge, compaction, and swarm integration.                                                                                   |
| `@crux/upstash`   | Upstash Vector and Redis-backed storage adapters.                                                                                                                                 |
| `@crux/otel`      | OpenTelemetry integration for production traces.                                                                                                                                  |
| `@crux/ingest`    | Source loaders for text, files, and URLs.                                                                                                                                         |
| `@crux/react`     | React provider, hooks, transports, and SSE helpers for live Crux state.                                                                                                           |
| `@crux/devtools`  | React devtools UI bundle for traces, evals, source catalog, memory, plans, and runtime inspection.                                                                                |
| `@crux/local`     | Native Go local runtime, CLI, TUI, HTTP/WS server, embedded devtools, and bounded Node workers.                                                                                   |

## Local runtime

`@crux/local` packages the local developer loop as a native Go binary:

```bash
crux dev
crux dev --tui
crux traces
crux eval
crux eval --ci
```

It hosts the local HTTP/WebSocket server, embeds the devtools UI, stores local traces and quality runs, and spawns bounded Node workers only for source indexing, source lookup, and eval execution.

## Repository development

Crux is a pnpm workspace and Turborepo monorepo. Prefer the root `Makefile` for common workflows:

```bash
make install     # install workspace dependencies
make dev         # run dev tasks through Turbo
make docs        # run the docs app
make build       # build devtools, embed assets, and build Crux Local
make local       # same local runtime build pipeline
make local-go    # rebuild only Go from already embedded assets
make local-all   # cross-compile local binaries
make test
make typecheck
```

The local build pipeline is:

1. `pnpm --filter @crux/devtools build` builds Node workers into `packages/devtools/dist/` and the React UI into `packages/devtools/ui/dist/`.
2. `make -C packages/local embed` copies worker and UI assets into Go `//go:embed` directories.
3. `make -C packages/local build-go` compiles the native `crux` binary.

## Design principles

- Prompts are data, not strings.
- Composition beats monolithic configuration.
- Provider adapters stay thin; `@crux/core` stays SDK-agnostic.
- Tests live next to the prompts they protect.
- Observability is structured, optional, and zero-cost when disabled.
- Crux is a toolkit, not a hosted prompt platform and not a required runtime.

## Contributing and release

Crux uses Changesets for release management:

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

Before public npm release, packages will be converted from source entrypoints to compiled `dist` entrypoints and published under the public `@crux/*` npm scope.

See [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), and the [open source checklist](./docs/OPEN_SOURCE_CHECKLIST.md) for the current pre-1.0 process.
