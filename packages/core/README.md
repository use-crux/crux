# @crux/core

**It was never the prompt.**

The TypeScript toolkit for memory, retrieval, tools, guardrails, constraints, routing, evaluation, multi-agent coordination, and observability — everything around your LLM call. Your SDK still makes the call; Crux is everything around it. Compose once, run with Vercel AI SDK, OpenAI, Google GenAI, or Anthropic.

`@crux/core/project-index` owns the public Project Index snapshot contract used by local devtools. Snapshots include concrete `lintFindings` plus `ruleDescriptors`, the available-rule metadata for built-in and extension-provided index lint rules, so clients can explain rule docs, fixes, and suppression affordances without hard-coding rule knowledge. Prompt/context/injectable definitions may also expose effective input contracts through `metadata.intelligence.contract.expandedInputSchema` and `inputContributions`, letting devtools and lints explain fields contributed through nested injection.

## TypeScript Compatibility

`@crux/core` is verified against TypeScript `>=5.5 <7`. The lower-bound check protects the public inference surfaces for prompts, contexts, raw fields, routing, testing, flows, and related primitives, while the TypeScript 6 check protects newer compiler behavior such as explicit ambient `types` resolution.

TypeScript 7 is tracked with `@typescript/native-preview` / `tsgo` as a preview lane. Core should avoid public type syntax that would raise the stable minimum above TypeScript 5.5 unless the compatibility contract is intentionally changed.

## Table of Contents

- [Why](#why)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Contexts](#contexts)
  - [Prompts](#prompts)
  - [Adapters](#adapters)
- [Organizing Prompts](#organizing-prompts)
  - [`createPrompts()`](#createpromptstree)
  - [`createContexts()`](#createcontextstree)
  - [`config()`](#configoptions)
- [Execution](#execution)
  - [Vercel AI SDK](#vercel-ai-sdk)
  - [OpenAI SDK](#openai-sdk)
  - [Google GenAI SDK](#google-genai-sdk)
  - [Anthropic SDK](#anthropic-sdk)
  - [Agent Frameworks](#agent-frameworks)
  - [Same Prompt, Multiple SDKs](#same-prompt-multiple-sdks)
- [Tool Support](#tool-support)
  - [Tool Middleware and Approvals](#tool-middleware-and-approvals)
- [Token-Aware Rendering](#token-aware-rendering)
- [Context Caching](#context-caching)
- [Provider-Specific Adaptations](#provider-specific-adaptations)
- [Multi-turn / Few-shot](#multi-turn--few-shot)
- [Middleware](#middleware)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Testing & Evaluation](#testing--evaluation)
  - [Suites](#suites)
  - [Targets](#targets)
  - [Expectations](#expectations)
  - [Variants And Comparisons](#variants-and-comparisons)
- [Flows](#flows)
  - [`flow()`](#flowt-tinputname-handler)
  - [`FlowHandle`](#flowhandlet-tinput)
  - [`FlowRunOptions`](#flowrunoptionstinput)
- [Memory](#memory)
  - [Memory Blocks](#memory-blocks)
  - [Capture and Proposals](#capture-and-proposals)
  - [Embeddings](#embeddings)
  - [Retrieval & Indexing](#retrieval--indexing)
  - [Memory Store](#memory-store)
- [Reactive Hooks (`@crux/react`)](#reactive-hooks-cruxcorereact)
  - [CruxProvider & CruxTransport](#cruxprovider--cruxtransport)
  - [Domain Hooks](#domain-hooks)
  - [Testing](#testing-1)
  - [AI SDK Stream Transport](#ai-sdk-stream-transport)
  - [SSE Transport](#sse-transport)
  - [Polling Transport](#polling-transport)
- [Compaction](#compaction)
  - [`summarizeMessages()`](#summarizemessages)
  - [`createSlidingWindow()`](#createslidingwindow)
  - [`createBudgetManager()`](#createbudgetmanager)
  - [`extractKeyFacts()`](#extractkeyfacts)
- [Scoring](#scoring)
  - [`llmJudge()`](#llmjudge)
  - [Pre-Built Metrics](#pre-built-metrics)
  - [`judgeConstraint()`](#judgeconstraint)
  - [Using Scores In Quality](#using-scores-in-quality)
  - [`evaluateContext()`](#evaluatecontext)
  - [`evaluateCompaction()`](#evaluatecompaction)
- [Agent Coordination](#agent-coordination)
  - [Composition Utilities](#composition-utilities)
    - [`agent()`](#agent)
    - [`parallel()`](#parallel)
    - [`pipeline()`](#pipeline)
    - [`consensus()`](#consensus)
    - [`swarm()`](#runswarm)
  - [Building-Block Primitives](#building-block-primitives)
    - [`blackboard()`](#blackboard)
    - [`handoff()`](#handoff)
    - [`delegate()`](#delegate)
- [Skills](#skills)
  - [`skill.inline()`](#skillinlineconfig)
  - [`skill.fromFile()`](#skillfromfilepath)
  - [`skill.fromRegistry()`](#skillfromregistryidentifier)
  - [`.dump()`](#dump)
  - [Custom Registries](#custom-registries)
- [Plugins](#plugins)
  - [`withCostTracking()`](#withcosttracking)
  - [`withDevtools()`](#withdevtools)
  - [`withTelemetry()` (`@crux/otel`)](#withtelemetry-cruxotel)
  - [Writing Custom Plugins](#writing-custom-plugins)
- [Devtools](#devtools)
- [Security](#security)
- [Resolution & Inspection](#resolution--inspection)
  - [Custom Contributors](#custom-contributors)
  - [Testable Resolution](#testable-resolution)
- [Type System](#type-system)
- [Recipes](#recipes)
  - [Chat with Sliding Window](#chat-with-sliding-window)
  - [Agent with Memory + Tools](#agent-with-memory--tools)
  - [Multi-Agent Pipeline with Handoff](#multi-agent-pipeline-with-handoff)
  - [Eval Suite with Quality Scoring](#eval-suite-with-quality-scoring)
- [Package Structure](#package-structure)

## Why

Bad LLM output is rarely a model problem. When LLM features fail in production, the fix usually isn't the prompt and isn't the model — it's a missing memory write, a stale retrieval, a guardrail that should've blocked the input, a router that picked the wrong model, an eval that should've caught it before ship. That layer — everything around the model call — is the harness every production LLM app already needs.

Most projects cobble it together with ad-hoc strings, custom memory wrappers, hand-rolled tool routing, and manual token counting, all tightly coupled to one SDK. `@crux/core` provides a single coherent toolkit of typed, composable building blocks:

**Compose** — Typed prompts and composable contexts with Zod schemas. SDK-agnostic from day one — switch from OpenAI to Gemini without touching your prompts.

**Remember** — Block-based memory for recent messages, working state, episodes, facts, procedures, and custom product memory. Compaction (sliding window, budget tracking, structured extraction) built in.

**Retrieve** — `embedding()`, `indexer()`, `retriever()`, `reranker()`. Drop a retriever straight into `use` as context or tools.

**Equip** — Skills from inline, file, or registry. Per-tool audit, policy gates, and human-approval middleware.

**Guard** — PII detection, prompt-injection defense, content safety. Screens inputs before the model ever sees them.

**Constrain** — Semantic output validation with retry-with-feedback. Get the shape you asked for, not just one that parses.

**Route** — Classifier-based model selection, quality cascade, semantic cache, cost tracking. Stop sending every call to the most expensive model.

**Evaluate** — LLM-as-a-judge scoring, pre-built quality metrics, context impact measurement, flow evaluation, and a CLI runner that tests every prompt across a model matrix.

**Coordinate** — Multi-agent composition (pipeline, parallel, consensus, swarm) and primitives (blackboard, handoff, delegate) for shared state and structured transfer.

**Observe** — Devtools trace every generation, memory operation, compaction, judge score, eval result, artifact, and semantic relation through the canonical `@crux/core/observability` graph. OpenTelemetry to your production stack. Zero overhead when disabled.

## Quick Start

```ts
import { context, prompt } from '@crux/core'
import { generate } from '@crux/ai'
import { z } from 'zod'

// Reusable context — contributes system text based on input
const brand = context({
  priority: 30,
  input: z.object({ brandContext: z.string().optional() }),
  system: ({ input }) => (input.brandContext ? `## Brand\n${input.brandContext}` : ''),
})

// Prompt — composes contexts, defines its own input/output
const editDraft = prompt({
  id: 'draft-edit',
  use: [brand],
  input: z.object({
    instruction: z.string(),
    draftTitle: z.string(),
  }),
  output: z.object({
    edits: z.array(z.object({ blockId: z.string(), text: z.string() })),
  }),
  system: 'You are an expert content editor.',
  prompt: ({ input }) => `## Draft: ${input.draftTitle}\n\n${input.instruction}`,
})

// Execute — TypeScript merges input types from prompt + contexts
const result = await generate(editDraft, {
  model,
  input: {
    instruction: 'Fix the typo in paragraph 2',
    draftTitle: 'My Post',
    brandContext: 'Use a casual tone', // from the brand context
  },
})

result.object.edits // { blockId: string; text: string }[]
```

## Core Concepts

### Contexts

A context is a reusable fragment that can contribute system message text, input fields, and tools to any prompt that uses it.

```ts
import { context } from '@crux/core'
import { z } from 'zod'

// Static — always contributes the same text
const rules = context({
  system: '## Rules\nAlways respond in valid JSON.',
})

// Dynamic — text depends on input
const brand = context({
  priority: 30,
  input: z.object({ brandContext: z.string().optional() }),
  when: ({ input }) => !!input.brandContext,
  system: ({ input }) => `## Brand\n${input.brandContext}`,
})

// Conditional — excluded entirely when predicate returns false
const responseLang = context({
  id: 'response-language',
  input: z.object({ lang: z.string().optional() }),
  when: ({ input }) => !!input.lang && input.lang !== 'English',
  system: ({ input }) => `Respond in ${input.lang}.`,
})

// With tools — contributes system text AND callable tools
const search = context({
  id: 'search',
  priority: 80,
  input: z.object({ apiKey: z.string() }),
  system: () => '## Search\nUse searchWeb to find information.',
  tools: ({ input }) => ({
    searchWeb: {
      description: 'Search the web',
      execute: async (query: string) => fetchResults(input.apiKey, query),
    },
  }),
})
```

**Properties:**

| Property      | Description                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `system`      | String or function returning system message text. Return `''` to omit.                                           |
| `input`       | Zod schema for fields this context needs. Merged into the prompt's input type.                                   |
| `when`        | Predicate `({ input }) => boolean`. When false, context is excluded entirely (no systemFn, no tools, no tokens). |
| `priority`    | 0–100 (default: 50). Higher = kept first when dropping contexts under token pressure.                            |
| `tools`       | Static tool set or function returning tools. Merged into the prompt's tool set.                                  |
| `id`          | Identifier for debugging and devtools display.                                                                   |
| `description` | Human-readable description for devtools.                                                                         |

`system` may also return segmented text for inspectable static/dynamic attribution:

```ts
context({
  id: 'workspace',
  input: z.object({ workspaceName: z.string() }),
  system: ({ input }) => ({
    segments: [
      { text: 'Current workspace: ', dynamic: false },
      { text: input.workspaceName, dynamic: true, source: 'workspaceName' },
    ],
  }),
})
```

The resolved system string is the concatenation of segment text. `.inspect()` and observability previews preserve `segments`, `staticTokens`, and `dynamicTokens`, so devtools can highlight authored boilerplate separately from interpolated runtime values.

### Prompts

A prompt composes contexts, declares its own input/output schemas, and defines the system message and user prompt.

```ts
import { prompt } from '@crux/core'

const editDraft = prompt({
  id: 'draft-edit',
  tags: ['editing'],
  use: [brand, responseLang],                    // compose contexts
  input: z.object({ instruction: z.string() }),  // prompt's own input
  output: z.object({ edits: z.array(...) }),     // structured output (omit for text)
  system: 'You are an expert content editor.',
  prompt: ({ input }) => input.instruction,
  settings: { temperature: 0 },
})
```

The presence of `output` determines how adapters execute the prompt:

- **With `output`** — structured generation (e.g. `generateObject`, `chat.completions.parse`)
- **Without `output`** — text generation (e.g. `generateText`, `chat.completions.create`)

**All config properties:**

| Property      | Description                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Identifier for registry lookup and devtools.                                                                                                |
| `description` | Human-readable description.                                                                                                                 |
| `tags`        | String tags for filtering (e.g. `config.byTag('editing')`).                                                                                 |
| `use`         | Array of contexts to compose. Accepts `Context`, `when()`, `match()`, and falsy values (see [Conditional Contexts](#conditional-contexts)). |
| `input`       | Zod schema for the prompt's own input fields.                                                                                               |
| `output`      | Zod schema for structured output. Omit for text generation.                                                                                 |
| `system`      | System message — string or `({ input }) => string`.                                                                                         |
| `prompt`      | User prompt — string or `({ input }) => string`.                                                                                            |
| `messages`    | Alternative to `system`+`prompt` for multi-turn / few-shot.                                                                                 |
| `settings`    | Default generation settings (`temperature`, `maxTokens`, etc.).                                                                             |
| `adapt`       | Provider-specific overrides (see [Adaptations](#provider-specific-adaptations)).                                                            |
| `hooks`       | Per-prompt lifecycle hooks (see [Hooks](#lifecycle-hooks)).                                                                                 |
| `tools`       | Tools for text-mode prompts.                                                                                                                |
| `toolChoice`  | Tool selection strategy (adapter-specific).                                                                                                 |
| `stopWhen`    | Stop condition for multi-step tool use (adapter-specific).                                                                                  |
| `tests`       | Inline examples that can be reused by project-specific Quality suites.                                                                      |

### Conditional Contexts

Contexts can be conditionally included or excluded using four mechanisms:

#### 1. Context-level `when` — condition on the context definition

```ts
const responseLang = context({
  input: z.object({ lang: z.string().optional() }),
  when: ({ input }) => !!input.lang && input.lang !== 'English',
  system: ({ input }) => `Respond in ${input.lang}.`,
})
```

When `when` returns `false`, the context is **excluded entirely** — no `systemFn` call, no tool contribution, no token counting.

#### 2. `when()` wrapper — condition in the `use` array

```ts
import { when } from '@crux/core'

prompt({
  use: [
    when((i) => !!i.brandVoice, brandCtx), // typed from brandCtx's input
    when<{ mode: string }>((i) => i.mode === 'edit', editCtx), // explicit generic
  ],
})
```

The wrapped context's input keys become `Partial<>` in the merged prompt input type.

#### 3. `match()` — multi-way switching

```ts
import { match } from '@crux/core'

prompt({
  use: [
    match({
      on: (input) => input.mode,
      cases: {
        research: researchCtx,
        create: createCtx,
        optimize: [optimizeCtx, seoCtx], // multiple contexts per case
      },
      default: createCtx, // fallback when no case matches
    }),
  ],
  input: z.object({ mode: z.string() }),
})
```

#### 4. Falsy-tolerant `use` array

```ts
prompt({
  use: [
    baseCtx,
    featureFlags.experimental && experimentalCtx, // false is filtered out
    userHasQuote ? quoteCtx : null, // null is filtered out
  ],
})
```

**Exclusion semantics:** Excluded contexts contribute nothing — no system text, no tools, no tokens. This is a stronger exclusion than token-budget dropping (which still collects tools). The `.inspect()` method reports excluded contexts in `excludedContexts[]`.

### Adapters

Adapters are thin layers that take a prompt and execute it against a specific SDK. They call `.resolve()` internally, then map the result to SDK-specific API calls.

The library ships with four adapters:

| Import                | SDK                                                            |
| --------------------- | -------------------------------------------------------------- |
| `@crux/ai`            | Vercel AI SDK (also `@crux/ai/stream` for plan/task streaming) |
| `@crux/openai`        | OpenAI SDK                                                     |
| `@crux/google`        | Google GenAI SDK                                               |
| `@crux/anthropic`     | Anthropic SDK                                                  |
| `@crux/core/ai-agent` | AI SDK agent frameworks (Convex Agent, Mastra)                 |

Custom adapters are built from `@crux/core/adapter`, which has two dialects sharing one policy layer. Implement `AdapterSpec` with `adapter()` when your SDK exposes single-turn provider calls and leaves tool execution to you (the `@crux/anthropic`/`@crux/openai`/`@crux/google` shape). Implement `ExecutorSpec` with `executorAdapter()` when your SDK runs its own multi-step tool loop (the `@crux/ai` shape) — the SDK drives, and core steers each step through a `StepObserver` that can stop the loop, amend the system prompt or active tools, and refund bookkeeping steps. Either way, core owns routing (`fallback()`/`router()`/`cascade()`), validation retry, constraints, guardrails, the tool-approval protocol, instrumentation, and timeouts; the spec implements mechanics only. Test loop-owning specs with `fakeExecutor()` and verify them against the contract with `executorSpecConformance()`.

## Organizing Prompts

As a project grows, keeping prompts and contexts organized becomes important. `createPrompts()` and `createContexts()` create typed namespace trees, and `config()` sets up cross-cutting concerns in one place.

### `createPrompts(tree)`

Groups prompts into a deeply frozen tree with IDE autocomplete at every level.

```ts
import { createPrompts } from '@crux/core'

export const prompts = createPrompts({
  editor: {
    edit: draftEdit,
    seo: seoEdit,
    transform: blockTransform,
  },
  agent: {
    system: karylaAgent,
    writerPlanner,
    researchPlanner,
  },
  brand: {
    profile: brandProfile,
    scorer: brandScorer,
  },
  chat: {
    title: conversationTitle,
  },
})

prompts.editor.edit // Prompt<...> — full type info
prompts.agent.system // Prompt<...>
prompts._all // Prompt[] — flat list of all prompts in the tree
```

Every leaf must be a `Prompt` instance. Throws if any value is not a prompt or nested object.

### `createContexts(tree)`

Same pattern for contexts.

```ts
import { createContexts } from '@crux/core'

export const contexts = createContexts({
  editor: {
    proseMirror: proseMirrorSchema,
    instructions: editInstructions,
  },
  brand: {
    voice: brand,
    profile: brandProfileContext,
  },
  agent: {
    mode: agentMode,
    project: agentProjectContext,
  },
})

contexts.brand.voice // Context<...>
contexts._all // Context[] — flat list
```

### `config(options)`

Tool input schemas in the Project Index may be authored with `input`, `inputSchema`, or `parameters`; all three project to `definition.metadata.inputSchema`.

Registers prompts, contexts, tools, and devtools/runtime options. During `crux dev`, the Go devtools backend builds the Project Index from source files, `.crux/quality` JSON, and any runtime index snapshots emitted by this config. The canonical index surface is `definitions`/`relations`; legacy `prompts`, `contexts`, and `tools` arrays are compatibility-only and may be empty for source-discovered projects. Prompt/context/tool definitions expose JSON schemas on `definition.metadata.inputSchema` and, for structured prompts, `definition.metadata.outputSchema` when Crux can resolve or statically project them. Authored prompt/context/tool trees are exposed as `definition.path`, while source-code file grouping uses `definition.source.file`. Supporting source locations such as schema declarations, nested schema declarations, callback functions, prompt/context system constants, direct constants and conservative object-property constants injected into static system templates, conditional injection predicates/branches, Convex Agent config bindings, Convex Agent tool-map contributors, handler-factory arguments, and helper functions are exposed as `definition.sourceRefs`, so clients can link a tool's `parameters: writerSchema`, a prompt's `system: PLANNER_SYSTEM`, a context's `system: ...${formatting.SUPPORTED_ELEMENTS}`, a prompt's `when(hasBrand, brandContext)`, or a Convex Agent's `{ tools, contextHandler, usageHandler }` back to the actual variable/function source without parsing snippets. Source file entries can also expose dependency/dependent file edges derived from imports and source refs, and definitions include `metadata.runtimeJoin` when Crux can derive stable span/resource join attributes. Runtime joins separate authored identity from execution correlation: `definitionId` is the index id, `spanAttributes` only contains stable runtime-emitted attributes, and dynamic fields such as flow `flowId` or execution `stepId` are correlation attributes rather than authored join keys. Primitives that expose static execution structure can also include typed facts in `metadata.intelligence`: `contract` for args/input/output/config schemas and nested schema refs, `control` for execution mode/order/children/retries/fallback/suspensions/budgets, `data` for visible memory/blackboard/workspace/store/block reads and writes, `dependencies` for detail-panel summaries, and `runtime` for authored-to-span hints. Agents can carry prompt/tool/handoff dependency intelligence plus visible state access, tools and flow steps can carry read/write intelligence, normal `flow()` definitions carry immediate ordered control metadata, Convex `flow({ args, handler })` definitions carry validator-derived args schemas and suspension points, literal `parallel()`, `pipeline()`, `consensus()`, and `swarm()` calls expose backend-owned child, participant, judge/scorer, and shared-state definitions/relations, retrieval pipelines can expose stage definitions plus retriever/scorer edges, and workspaces/safety/evals can expose tool, mount, applies-to, and coverage relations so clients do not infer structure from source strings. The index also includes backend-owned `lintFindings` for actionable authored-graph observations such as missing eval coverage, quality targets with experiment history but no promoted baseline, prompt/context/tool/flow contract gaps, unobservable agent handoff targets, suspending flows without coverage, writable workspaces without guardrails, long-lived memory without visible retention policies, consensus compositions without visible judges or scorers, and shared blackboards without conflict policies. Each lint finding carries rule category, maturity, confidence, default profile membership, what/why/impact copy, evidence, affected definitions, fixes, docs, and suppression metadata. Use `lint` in `crux.config.ts` to choose the emitted profile (`off`, `recommended`, `strict`, or `experimental`) and to apply rare project-wide rule overrides such as disabling a rule or changing its displayed severity.

`ProjectIndexSnapshot.sourceGraph` records whether source rows carry trusted dependency, dependent, definition ownership, and diagnostic ownership evidence. Incremental planners use it as a provenance marker and must fall back to full reindex for older snapshots that do not include the marker.

```ts
import { config } from '@crux/core'

const crux = config({
  prompts, // from createPrompts() — or a flat Prompt[]
  contexts, // from createContexts() — optional, auto-collected from prompts' use arrays
  devtools: {
    serverUrl: process.env.DEVTOOLS_URL, // enables devtools when truthy
    bridge: true, // optional: lets local devtools send commands to this live runtime
  },
  middleware: async (args, next) => {
    // wraps every generate() call
    const start = Date.now()
    const result = await next(args)
    console.log(`${args.promptId}: ${Date.now() - start}ms`)
    return result
  },
  tokenizer: (text) => encode(text).length, // custom token counter
})
```

**What it returns** — a registry with lookup methods:

```ts
config.get('draft-edit') // Prompt — throws if not found
config.find('draft-edit') // Prompt | undefined
config.list() // all registered prompts
config.byTag('editing') // prompts matching a tag
config.byTags(['a', 'b']) // prompts matching all tags (intersection)
config.tags() // all unique tags
config.prompts // readonly Prompt[]
config.contexts // readonly Context[]
config.dispose() // tears down middleware and devtools
```

**Runtime Bridge** — `devtools.bridge` enables the local-dev command plane. It is separate from observability delivery: spans still flow runtime -> Go through `POST /api/observability/records`, while bridge commands flow Go -> runtime through a live peer or Go-owned local executor. In normal long-lived Node runtimes, `bridge: true` opens a WebSocket peer at `/ws/runtime`, advertises capabilities such as `store.read`, and closes on `config.dispose()`. Memory and blackboard primitives register inspectable resource ids automatically, so devtools can read `memory:*` and `blackboard:*` resources from their attached stores without extra user setup. The Go backend executes `eval.run` through the embedded eval runner so eval discovery, observability, and quality persistence stay on the existing path. Framework integrations such as Convex bind HTTP bridge endpoints from their own setup helpers; those endpoints should advertise the framework URL, return structured bridge errors for bad commands, and keep any request-scoped store wiring inside the framework package. `crux dev` auto-discovers framework HTTP peers from `CRUX_BRIDGE_URL`, `CONVEX_SITE_URL`, `CONVEX_URL`, or `NEXT_PUBLIC_CONVEX_URL` in the shell or project `.env.local` / `.env`, deriving `.convex.site/crux/bridge` from Convex cloud URLs when needed.

Devtools clients do not call runtime bridge endpoints directly. They call Go's resource inspection service, which returns stable `ok`, `partial`, `unavailable`, or `error` responses for `blackboard:*`, `memory:*`, and `crux.store`. Go uses Runtime Bridge internally when live runtime state is available and returns a helpful `bridge_required` / `runtime_unavailable` notice with docs links when it is not.

```ts
config({
  prompts,
  store,
  devtools: {
    serverUrl: 'http://localhost:4400',
    bridge: true,
  },
})
```

**Separating organization from runtime:**

In environments like Convex where `'use node'` is required for Node.js APIs, keep tree definitions separate from the `config()` call. This way, importing prompts for type checking or schema access doesn't require a Node.js runtime:

```ts
// prompts/index.ts — pure JS, no 'use node' needed
import { createPrompts, createContexts } from '@crux/core'
export const prompts = createPrompts({ ... })
export const contexts = createContexts({ ... })
export { draftEdit } from './draft_edit'

// prompts/config.ts — has 'use node' for process.env access
'use node'
import { config } from '@crux/core'
import { prompts, contexts } from './'
export const crux = config({ prompts, contexts, devtools: { ... } })

// In action files, import config as a side-effect
import '../prompts/config'
import { draftEdit } from '../prompts'
```

## Execution

### Vercel AI SDK

```ts
import { generate, stream, tool } from '@crux/ai'

// Structured output
const result = await generate(editDraft, { model, input: { ... } })
result.object // typed as z.infer<typeof OutputSchema>

// Text output
const result = await generate(greet, { model, input: { name: 'Henri' } })
result.text // string

// Bound a provider call so traces cannot stay open forever on a stalled model
await generate(greet, { model, input: { name: 'Henri' }, timeoutMs: 60_000 })

// Streaming
const result = await stream(editDraft, { model, input: { ... } })
for await (const partial of result.partialObjectStream) { ... }
```

Also re-exports `tool`, `stepCountIs`, `hasToolCall`, and types like `LanguageModel`, `ToolSet`, `ToolChoice`.
`timeoutMs` is specific to `@crux/ai` direct provider calls: Crux passes an `AbortSignal` to the AI SDK and closes the generation span with `AbortError` if the provider does not settle before the deadline.

### OpenAI SDK

```ts
import { createOpenAI } from '@crux/openai'
import OpenAI from 'openai'

const openai = createOpenAI(new OpenAI({ apiKey: '...' }))

// Structured output → chat.completions.parse with zodResponseFormat
const result = await openai.generate(editDraft, { model: 'gpt-4o', input: { ... } })
result.choices[0].message.parsed // typed

// Text output → chat.completions.create
const result = await openai.generate(greet, { model: 'gpt-4o-mini', input: { name: 'Henri' } })

// Streaming
const stream = await openai.stream(greet, { model: 'gpt-4o', input: { name: 'Henri' } })
```

Accepts OpenAI-native options: `tools`, `tool_choice`, `parallel_tool_calls`, and all `OpenAISettings`.

### Google GenAI SDK

```ts
import { createGoogle } from '@crux/google'
import { GoogleGenAI } from '@google/genai'

const google = createGoogle(new GoogleGenAI({ apiKey: '...' }))

// Structured output → generateContent with JSON schema + Zod validation
const result = await google.generate(editDraft, { model: 'gemini-2.5-flash', input: { ... } })
result.object // parsed + validated with Zod

// Text output
const result = await google.generate(greet, { model: 'gemini-2.0-flash', input: { name: 'Henri' } })

// Streaming
const stream = await google.stream(greet, { model: 'gemini-2.5-flash', input: { name: 'Henri' } })

// Optional: custom cache config for Google's CachedContent API
const google = createGoogle(new GoogleGenAI({ apiKey: '...' }), {
  cache: { defaultTtlSeconds: 600, maxEntries: 100 },
})
```

Accepts Google-native options: `tools` (function declarations), `temperature`, `maxOutputTokens`, `topP`, `topK`. Cache management is automatic — when contexts have `providerCache: true`, the adapter creates/reuses server-side `CachedContent` objects. Disable with `{ cache: false }`.

### Anthropic SDK

```ts
import { createAnthropic } from '@crux/anthropic'
import Anthropic from '@anthropic-ai/sdk'

const adapter = createAnthropic(new Anthropic({ apiKey: '...' }))

// Structured output → messages.parse with zodOutputFormat
const result = await adapter.generate(editDraft, { model: 'claude-sonnet-4-5-20250929', input: { ... } })
result.parsed_output // typed

// Text output → messages.create
const result = await adapter.generate(greet, { model: 'claude-haiku-4-5-20251001', input: { name: 'Henri' } })

// Streaming
const stream = await adapter.stream(greet, { model: 'claude-sonnet-4-5-20250929', input: { name: 'Henri' } })
```

Accepts Anthropic-native options: `tools`, `tool_choice`, `thinking`, `metadata`, `service_tier`.

### Agent Frameworks

For agent frameworks that wrap the AI SDK and handle model calls internally (e.g. Convex Agent, Mastra), use the agent adapter. It returns composed instructions and a wrapped model instead of executing directly. In Convex, prefer the Crux-aware wrapper from `@crux/convex/agent` so tool calls, thread turns, nested Convex boundaries, and consecutive multi-step generations remain observable. Convex Agent aggregate and step generation spans carry the configured `languageModel` as `model` / `provider` attributes; nested tool-call or flow generations still report their own model independently.

```ts
import { resolve } from '@crux/core/ai-agent'
import { Agent } from '@crux/convex/agent'

const { instructions, model } = await resolve(karylaAgent, {
  model: languageModel,
  input: { mode },
})

return new Agent(components.agent, {
  languageModel: model, // wrapped — reports traces to devtools
  instructions,
  tools,
})
```

### Same Prompt, Multiple SDKs

The same prompt works across all adapters without modification:

```ts
const sentiment = prompt({
  id: 'sentiment',
  input: z.object({ text: z.string() }),
  output: z.object({ sentiment: z.enum(['positive', 'negative', 'neutral']) }),
  system: 'Classify the sentiment of the given text.',
  prompt: ({ input }) => input.text,
})

// Vercel AI SDK
await generate(sentiment, { model: openai('gpt-4o'), input: { text: '...' } })

// OpenAI SDK
await openaiAdapter.generate(sentiment, {
  model: 'gpt-4o',
  input: { text: '...' },
})

// Google GenAI
await googleAdapter.generate(sentiment, {
  model: 'gemini-2.5-flash',
  input: { text: '...' },
})

// Anthropic SDK
await anthropicAdapter.generate(sentiment, {
  model: 'claude-sonnet-4-5-20250929',
  input: { text: '...' },
})
```

## Tool Support

Contexts and prompts can declare tools that adapters merge and pass to the underlying SDK. Tools are available in **text mode** prompts (no `output` schema).

`tool()` from `@crux/core/tools` is the SDK-agnostic authoring helper. It returns a normal `ToolDef`, preserves input/output inference, and gives runtime profiles such as `@crux/convex/tools` a stable API to mirror. Adapter packages can still expose provider-specific tool helpers where needed.

Tools from three sources are merged with last-write-wins precedence:

1. **Context tools** — from `context({ tools })` via `use`
2. **Prompt tools** — from `prompt({ tools })`
3. **Call-site tools** — from `generate(prompt, { tools })`

```ts
import { prompt, context } from '@crux/core'
import { tool } from '@crux/core/tools'
import { generate, stepCountIs } from '@crux/ai'

const search = context({
  id: 'search',
  system: '## Search\nUse searchWeb to find information.',
  tools: {
    searchWeb: tool({
      description: 'Search the web',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ results: [] }),
    }),
  },
})

const agent = prompt({
  use: [search],
  input: z.object({ task: z.string() }),
  system: 'You are a research assistant.',
  prompt: ({ input }) => input.task,
  tools: {
    saveNote: tool({
      description: 'Save a research note',
      parameters: z.object({ note: z.string() }),
      execute: async ({ note }) => ({ saved: true }),
    }),
  },
  stopWhen: stepCountIs(5),
})

// Both searchWeb and saveNote are available to the model
const result = await generate(agent, { model, input: { task: 'Research AI trends' } })

// Override at call site
const result2 = await generate(agent, {
  model,
  input: { task: 'Research AI trends' },
  tools: { extraTool: tool({ ... }) },
  activeTools: ['searchWeb', 'saveNote'],
})
```

Tools can return a rich raw value while sending a smaller model-facing value back into the next step:

```ts
const searchDocs = tool({
  description: 'Search product documentation',
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => ({
    hits: await searchIndex(query),
    debug: { query },
  }),
  toModelOutput: ({ output }) => ({
    type: 'text',
    value: output.hits
      .slice(0, 5)
      .map((hit) => `[${hit.sourceId}] ${hit.snippet}`)
      .join('\n\n'),
  }),
})
```

`execute()` is for your application, tracing, and evals. `toModelOutput()` is for the model. If it is omitted, Crux follows the standard default: strings become text output and other values become JSON output. Content outputs can include text, images, files, and provider-specific parts: `@crux/ai` passes the shape through to the AI SDK, Google and Anthropic use native tool-result media where supported, and OpenAI Chat Completions receives deterministic text references for non-text parts because that API only accepts text tool results. Devtools, CLI/TUI, and OTel record privacy-safe shaping metadata such as output size, model-output size, and estimated savings.

### Tool Middleware and Approvals

Tool middleware wraps tool execution across a prompt or a single call. Use it for audit logging, timing, policy checks, argument normalization, early returns, or human approval without copying wrappers into every tool.

```ts
import { approvalMiddleware, toolMiddleware } from '@crux/core/tool-middleware'
import { toolApprovalResponse } from '@crux/core/tool-approvals'

const auditTools = toolMiddleware({
  id: 'audit-tools',
  match: [/^admin/, 'sendEmail'],
  beforeExecute: ({ toolName, input }) => audit.write({ phase: 'start', toolName, input }),
  afterExecute: ({ toolName, durationMs }) => audit.write({ phase: 'end', toolName, durationMs }),
})

const approvals = approvalMiddleware({
  id: 'dangerous-tools',
  match: ['sendEmail', 'createRefund'],
  onRequest: ({ toolName, input }) => audit.write({ phase: 'approval-requested', toolName, input }),
  onApproved: ({ approvalId, toolName }) => audit.write({ phase: 'approved', approvalId, toolName }),
  onDenied: ({ approvalId, toolName, reason }) => audit.write({ phase: 'denied', approvalId, toolName, reason }),
})

const assistant = prompt({
  id: 'support-agent',
  tools: { sendEmail, createRefund },
  toolMiddleware: [auditTools, approvals],
})
```

Approvals use a return-and-resume protocol instead of a blocking promise. The first call returns a `tool-approval-request`; your UI asks the user; the next call appends a `tool-approval-response` with the same approval id. That shape works in serverless and Convex runtimes because no process needs to stay alive while the user decides.

Tool execution and approval gates emit canonical observability records automatically. Model-emitted tool intents attach to the active generation as `tool.request` artifacts. Executed tools open `tool.call` spans, attach `tool.args` artifacts, attach separate raw-result and model-facing `tool.result` artifacts, and connect them with `consumed` / `produced` edges. If `execute()` throws, the model-facing error output is preserved and the same span records rich error evidence with `phase: "tool.execute"`, `errorKind: "execute_error"`, `toolName`, and `toolCallId`. Approval requests, approvals, denials, and approval-token mismatches open `tool.approval` spans so devtools can show why a tool did or did not run.

```ts
const first = await generate(assistant, { model, input })
const [request] = findToolApprovalRequests(first.response.messages)

const final = await generate(assistant, {
  model,
  input,
  messages: [
    ...first.response.messages,
    {
      role: 'tool',
      content: [
        toolApprovalResponse({
          approvalId: request.approvalId,
          approved: true,
          approvalToken: request.approvalToken,
        }),
      ],
    },
  ],
})
```

`@crux/ai` maps this to the AI SDK approval protocol. The shared native adapter layer used by `@crux/openai`, `@crux/google`, and `@crux/anthropic` exposes the same Crux approval protocol through `result.messages`; use the browser-safe `findToolApprovalRequests()` and `appendToolApprovalResponse()` helpers from `@crux/core/tool-approvals` to resume. Native approval responses should echo the request's `approvalToken`, and server code should resume from server-issued message history rather than arbitrary client-fabricated messages.

## Token-Aware Rendering

When system messages grow large, contexts are automatically dropped based on their `priority` to stay within a token budget.

```ts
const critical = context({ priority: 100, system: '## Critical Rules' })  // never dropped
const guidelines = context({ priority: 50, system: '## Guidelines\n...' })
const examples = context({ priority: 20, system: '## Examples\n...' })    // dropped first

const myPrompt = prompt({
  use: [critical, examples, guidelines],
  system: 'You are an assistant.',  // prompt's own system text is never dropped
  // ...
})

const result = await generate(myPrompt, {
  model,
  input: { ... },
  tokenBudget: 2000,  // max tokens for the system message
})
```

**How it works:**

1. The prompt's own system text is always included
2. Context contributions are sorted by priority (lowest first for dropping)
3. Lowest-priority contexts are dropped until the total fits within budget
4. Use `.inspect()` to see exactly what was dropped and why

When observability is enabled, prompt resolution also emits structured context composition evidence. `context.contribution` artifacts carry `state`, `included`, `sourceId`, `injectableKind`, `priority`, `tokens`, `cacheStatus`, optional `reason`/`branch`, segmented static/dynamic text when provided, and `injectedTools` for tool-producing contributions. Direct injectables, retrievers, and blackboards also emit tool-only contribution previews so devtools can label request tools by source; memory entries contribute context only (their tools are opt-in via `memory.asTools()`). Token-budget resolution emits a `prompt.budget` artifact containing `usedTokens`, `totalTokens`, and the dropped contribution list.

**Custom tokenizer:**

The default tokenizer estimates tokens as `chars / 4`. For accurate counts, provide a real tokenizer via `config()`:

```ts
config({
  prompts,
  tokenizer: (text) => encode(text).length,
})
```

Or standalone: `setTokenizer((text) => encode(text).length)`

## Context Caching

Contexts with expensive async resolvers (database queries, RAG retrieval, API calls) can be cached to avoid redundant computation. A single `cache` option enables both **application-level resolver caching** (skip the function call) and **provider-level token caching** (Anthropic `cache_control` breakpoints for 90% token discount).

```ts
// Simple: one option enables both layers
const brand = context({
  id: 'brand-voice',
  input: z.object({ orgId: z.string() }),
  system: async ({ input }) => {
    const data = await fetchBrandProfile(input.orgId) // expensive!
    return `## Brand Voice\n${data.guidelines}`
  },
  cache: 300_000, // 5min TTL + provider caching ON
})

// Fine-grained: cache resolver but skip provider caching
const search = context({
  id: 'search-results',
  input: z.object({ query: z.string() }),
  system: async ({ input }) => ragSearch(input.query),
  cache: { ttl: 30_000, providerCache: false },
})

// Provider cache only: cheap to compute but stable across calls
const rules = context({
  id: 'rules',
  system: '## Rules\nAlways respond in JSON.',
  cache: { providerCache: true },
})
```

**Cache option forms:**

| Form                                           | `cacheTtl`               | `providerCache` |
| ---------------------------------------------- | ------------------------ | --------------- |
| `cache: 300_000`                               | `300_000`                | `true`          |
| `cache: true`                                  | `300_000` (5min default) | `true`          |
| `cache: { ttl: 60_000 }`                       | `60_000`                 | `true`          |
| `cache: { ttl: 60_000, providerCache: false }` | `60_000`                 | `false`         |
| `cache: { providerCache: true }`               | `0` (no resolver cache)  | `true`          |
| Not set / `false`                              | `0`                      | `false`         |

**How it works:**

1. **Application-level:** Resolved text is cached by `contextId + inputHash` with TTL. Subsequent calls with the same inputs skip the `systemFn()` entirely.
2. **Provider-level:** The resolution pipeline emits `systemBlocks` on `ResolvedPrompt` with per-block `providerCache` hints. Each adapter translates these to its native caching mechanism:
   - **`@crux/anthropic`**: Converts to `TextBlockParam[]` with `cache_control: { type: 'ephemeral' }` (up to 4 breakpoints).
   - **`@crux/google`**: Creates server-side `CachedContent` objects via Google's caching API, then references them in `generateContent()` calls. Handles lifecycle (creation, reuse, TTL, concurrency dedup) automatically.
   - **OpenAI**: Prefix caching works automatically via stable context ordering.
3. **Cache key:** Computed from `contextId` + sorted JSON of input fields declared in the context's `inputSchema`. Unrelated prompt-level fields don't affect the key.
4. **Static contexts:** `cacheTtl` is silently set to 0 for static string `system` values (nothing to cache). `providerCache` still applies.
5. **Requires `id`:** Contexts with `cacheTtl > 0` must have an `id` for cache key derivation. An error is thrown at definition time if missing.

**Observability:**

Prompt resolution emits canonical observability graph records when `@crux/core/observability` is configured. `prompt.resolve` is the root operation, `context.predicate` spans record `when()` / `match()` inclusion decisions with reasons for excluded contexts, and `context.resolve` spans record resolved context text as inspectable `context.contribution` artifacts. Generation spans link to the included context artifacts and prompt-budget artifacts with `consumed` edges, and their consumed `messages` artifact includes request tool names. The Go RunDetail read model projects those records into `node.request`, an exact per-generation request/context view or an aggregate final-generation representative for run/stream/agent/flow/composition wrappers. Framework-owned Convex Agent stream and step spans emit the Agent's configured model/provider, while nested child generations can still surface different models. Cache hits and misses still emit the existing instrumentation hooks, and the canonical context spans include cache status metadata for backend filtering.

The Go backend owns the presentation read model for devtools and the TUI. It keeps canonical records append-only, then reconciles delivery gaps such as a suspended flow whose child generation missed its own terminal record: completed children with output/usage evidence render as `ok`, the enclosing flow renders as `suspended`, and true missing terminal records still surface as incomplete diagnostics after their operation deadline. Generation timeouts are also enforced in core orchestration, so a provider call that never settles emits a terminal error span instead of leaving the trace visually running forever.

Thrown execution failures emit a compact error summary on the terminal span/run plus rich evidence attached to the failing span. Crux records an OpenTelemetry-style `exception` event, an `error.stack` artifact when a stack exists, and an `error.raw` artifact with a bounded, redacted, JSON-safe representation of the thrown value. Devtools and the TUI promote those records into an `errors` inspection section so failed tool calls, generation calls, retrieval stages, flow steps, eval cases, and other primitive spans can be debugged without opening raw graph JSON. Non-throwing outcomes such as approval denial, guardrail block reports, constraint retries, retrieval zero hits, cascade tier rejection, flow suspension, and stream finish reasons remain status/event/artifact data instead of being mislabeled as exceptions.

Local devtools persistence keeps runtime history in SQLite and portable quality state in JSON/JSONL. Runs, spans, events, artifacts, edges, metrics, lifecycle signals, and deletion are canonical in SQLite; suites, cases, feedback, cassettes, baselines, insight statuses, and insight silences live under `.crux/quality`. File-backed observability stores run with WAL, a busy timeout, and a small read/write connection pool so multiple in-flight flushes, web reads, and TUI reads can coexist; in-memory stores stay single-connection for deterministic tests. The Go services join those stores into run lists, details, and insights, so web devtools and the TUI do not read or interpret either store directly.

## Semantic Response Cache

Semantic response caching skips a model call when a new request is close enough to a previous request for the same prompt, scope, output shape, and version. It is opt-in at the prompt and installed once as a runtime plugin:

```ts
import { config, prompt } from '@crux/core'
import { createSemanticCache } from '@crux/core/cache'
import { embedding } from '@crux/core/embedding'
import { inMemoryCruxStore } from '@crux/core/store'
import { z } from 'zod'

const intent = prompt({
  id: 'intent',
  input: z.object({ userId: z.string(), message: z.string() }),
  output: z.object({ intent: z.string() }),
  cache: {
    semantic: {
      version: 'v1',
      query: ({ input }) => input.message,
    },
  },
  prompt: ({ input }) => input.message,
})

config({
  prompts: [intent],
  plugins: [
    createSemanticCache({
      store: inMemoryCruxStore(),
      embedding: embedding({
        kind: 'dense',
        name: 'cache-embedding',
        dimensions: 1536,
        maxInputTokens: 8191,
        embed: async (texts) => ({ embeddings: await embedTexts(texts) }),
      }),
      ttl: 60_000,
      scope: ({ input }) => `user:${input.userId}`,
    }),
  ],
})
```

The cache is dense-only by design. Sparse and hybrid retrieval are useful for document search, but semantic response caching needs one calibrated similarity score for a completed prompt result. If you want sparse or hybrid matching, build that as a custom policy or retriever-backed cache; Crux will not silently convert it into a response cache.

Important defaults:

- `cache.semantic: true` means read and write with plugin defaults.
- `scope` is required. Use `'global'` only for results that are safe to share across users and tenants.
- `ttl` is required on the plugin. Prompt-level TTLs may only shorten it.
- The default threshold is `0.95`. Prompt-level thresholds may only make matching stricter.
- Prompt `version` is the primary invalidation tool. Change it when prompt text, schema, or policy changes.
- Prompts can opt into `mode: 'readonly' | 'writeonly' | 'readwrite' | 'off'`.

Semantic cache events are emitted through instrumentation, devtools, OTel, the dev server, CLI stats, and the TUI dashboard. Cached stream responses are replayed as synthetic streams so stream call sites keep the same shape.

## Provider-Specific Adaptations

Different models sometimes need different prompting strategies. The `adapt` field lets you apply provider-specific tweaks without cluttering your main prompt logic:

```ts
const myPrompt = prompt({
  system: 'You are a helpful assistant.',
  // ...
  adapt: {
    anthropic: {
      appendSystem: '\nReturn raw JSON, no markdown fences.',
    },
    openai: {
      prependPrompt: 'Think step by step.\n\n',
      settings: { temperature: 0.1 },
    },
    '*': { appendSystem: '\nRespond with valid JSON only.' },
  },
})
```

**Resolution priority:** exact `provider` match > `modelId` prefix (for OpenRouter-style routing) > `'*'` wildcard.

Settings merge with priority: `config.settings` < `adapt.settings` < call-site overrides.

## Multi-turn / Few-shot

Use `messages` instead of `system` + `prompt` for multi-turn or few-shot prompts:

```ts
const classify = prompt({
  input: z.object({ text: z.string() }),
  output: z.object({ category: z.string() }),
  messages: ({ input }) => [
    { role: 'system', content: 'Classify text into categories.' },
    { role: 'user', content: 'Server crashed at 3am' },
    { role: 'assistant', content: '{"category": "incident"}' },
    { role: 'user', content: input.text },
  ],
})
```

Context system text is prepended to the first system message automatically.

## Middleware

Middleware wraps every `generate()` and `stream()` call across all prompts. Use it for logging, timing, error handling, or custom retry logic.

```ts
config({
  prompts,
  middleware: async (args, next) => {
    const start = Date.now()
    try {
      const result = await next(args)
      console.log(`${args.promptId}: ${Date.now() - start}ms`)
      return result
    } catch (error) {
      console.error(`${args.promptId} failed after ${Date.now() - start}ms`)
      throw error
    }
  },
})
```

Middleware receives `{ promptId, preparedArgs }` and a `next` function. It can inspect or modify args, measure timing, transform results, or handle errors.

Standalone setup (when not using `config()`):

```ts
import { updateRuntime } from '@crux/core'
updateRuntime({ middleware: async (args, next) => { ... } })
```

## Guardrails (`@crux/core/safety`)

Composable safety for I/O validation — PII detection, prompt injection defense, content safety, and real-time streaming transforms. No AI SDK offers guardrails natively; this is a Crux-only feature across all adapters.

`@crux/core/safety` is one deep module: you **author** policies with `guardrail()` / `constraint()`, **register** them with `createSafetyPlugin()` (or attach them per-prompt / per-call), and every adapter **executes** them through a per-call `Safety` session — scope merging, phase ordering, retries, suspension policy, audits, and observability are owned by the session, never by adapter code.

### `guardrail()`

Create a frozen guardrail object. Guards filter content but never re-call the model. For retry-with-feedback on output quality, use `constraint()`. The optional `category` (e.g. `'pii'`, `'jailbreak'`, `'toxicity'`) is carried through audits and observability artifacts so reporting can aggregate by risk type.

```ts
import { guardrail } from '@crux/core/safety'

const piiGuard = guardrail({
  name: 'pii-detection',
  phase: 'output',
  stream: { buffer: 'full' },
  validate: async (content, ctx) => {
    const entities = detectPII(content)
    if (entities.length > 0) return { action: 'redact', content: maskPII(content, entities), entities }
    return { action: 'pass' }
  },
})
```

**Actions by phase:**

| Phase             | Actions                                        |
| ----------------- | ---------------------------------------------- |
| Input             | `pass`, `block`, `redact`, `transform`, `warn` |
| Output            | `pass`, `block`, `redact`, `transform`, `warn` |
| Chunk (streaming) | `pass`, `block`, `redact`, `transform`, `warn` |

### `createSafetyPlugin()`

Register global guardrails and constraints. Every `generate()` / `stream()` call on every adapter enforces them automatically.

```ts
import { createSafetyPlugin } from '@crux/core/safety'

config({
  plugins: [createSafetyPlugin({ guardrails: [injectionGuard, piiGuard], constraints: [citeSources] })],
})
// Every generate() runs input guards, constraints, and output guards automatically
```

### Scoping

Guardrails support four scoping levels, merged via union (per-call wins, deduplicated by name):

```ts
// Global — all generate() calls
config({ plugins: [createSafetyPlugin({ guardrails: [injectionGuard] })] })

// Per-prompt
const blogPrompt = prompt({ guardrails: [piiGuard], ... })

// Per-context
const frenchMarket = context({ guardrails: [contentSafetyGuard], ... })

// Per-call (highest precedence)
await adapter.generate(prompt, { guardrails: [strictGuard] })
```

Guardrail audit attaches to `result._meta.guardrails`.

### The `Safety` session (`createSafety()`)

Adapters — and any custom dialect you build — consume safety through one per-call session. It owns the three-scope merge (reading runtime globals itself), guarded-content selection with redaction write-back, the constraint retry state machine, suspension policy (output safety is skipped when a run suspends for tool approval), audit accumulation, and all hook/observability emission. The only dialect-specific concern is the `regenerate` closure: how to re-call the model.

```ts
import { createSafety } from '@crux/core/safety'

const safety = createSafety({
  call: opts,                       // per-call overrides (highest precedence)
  resolved,                         // the resolved prompt — constraints/guardrails/metadata
  promptId: prompt.id,
  model: opts.model,
  systemPrompt: resolved.system,
})

// Input phase: redaction/transform content is written back into the messages.
;({ messages } = await safety.guardInput({ messages }))

// Output phase: constraints (with combined-feedback retries) then output guards.
const final = await safety.finalizeOutput(
  { text: validText, parsed },
  async (corrective) => {
    messages = [...appendRound(messages), ...corrective]
    return revalidate(await callModelAgain(messages))
  },
  { suspended: finishReason === 'tool_approval_required' },
)

const meta = safety.stamp({ usage, finishReason }) // audits attached iff non-empty
```

Corrective-message phrasing is injectable via `formatter` (a `ConstraintFeedbackFormatter`) for localization or structured feedback; the default reproduces the stock English phrasing. The session also records a machine-readable `transcript` of protocol events — the dialect parity suite asserts both adapter dialects produce identical sequences.

### Streaming ("LLM Suspense")

Guards declare their buffer strategy: `'none'` for real-time chunk transforms (v0 LLM Suspense pattern), `'full'` for post-stream validation (v0 Autofixer pattern). Chunk handlers can return `{ action: 'hold' }` to buffer content across chunks — the held content is merged into the next `onChunk` call, enabling cross-token transforms like import rewriting (hold a suspicious import, look up the real path, release the corrected text with no visible intermediate state).

Streaming guardrails run automatically in every adapter's `stream()` — no wiring required:

```ts
const iconFixer = guardrail({
  name: 'icon-fixer',
  phase: 'output',
  stream: { buffer: 'none' },
  onChunk: async (chunk) => {
    if (chunk.endsWith('@/co')) return { action: 'hold' }                       // need more tokens
    if (chunk.includes('@/comps/')) return { action: 'transform', content: fix(chunk) }
    return { action: 'pass' }
  },
  validate: async () => ({ action: 'pass' }),
})

const handle = await adapter.stream(prompt, { model, input, guardrails: [iconFixer] })
// Consumers see only the corrected stream; the original lands in the audit.
```

Constraints run report-only at end-of-stream (a live stream cannot regenerate); a constraint `onChunk` returning `{ abort: true }` stops a stream that is going wrong early. Custom dialects drive the same protocol through `safety.openStream()` — `feed()` each text delta, forward `emit` content, swallow `hold`, and `finish()` at end-of-stream (or use `transform()` as a ready-made `TransformStream<string, string>`).

### `evaluateGuardrail()`

Test guardrails against a matrix of cases.

```ts
import { evaluateGuardrail } from '@crux/core/safety'

const report = await evaluateGuardrail(piiGuard, [
  { input: 'SSN is 123-45-6789', expect: 'redact' },
  { input: 'Hello world', expect: 'pass' },
])
// report.summary: { total: 2, passed: 2, failed: 0 }
```

### `GuardrailBlockedError`

Thrown when a guard blocks content.

```ts
import { GuardrailBlockedError } from '@crux/core/safety'

try {
  await adapter.generate(prompt, { model, input, guardrails: [injectionGuard] })
} catch (e) {
  if (e instanceof GuardrailBlockedError) {
    // e.guardrailId, e.phase, e.reason
  }
}
```

## Constraints (`@crux/core/safety`)

Semantic output validation with retry-with-feedback. While guardrails _filter_ content (block, redact, transform), constraints _ensure quality_ by validating output semantics and retrying until requirements are met. Inspired by DSPy's `dspy.Assert`/`dspy.Suggest`.

> **Guardrails** filter what comes out — block, redact, transform, or warn. They never re-call the model.
> **Constraints** ensure output quality — they validate and retry with feedback until requirements are met.

### `constraint()`

Create a frozen constraint object. Generic over a Zod schema for typed `output.parsed`.

```ts
import { constraint } from '@crux/core/safety'

const citeSources = constraint<typeof BlogPost>({
  name: 'cite-sources',
  severity: 'assert', // mandatory — throws on exhaust (default)
  maxRetries: 2, // per-constraint retry limit (default: 2)
  check: async (output, ctx) => {
    if (output.parsed && output.parsed.citations.length < 3)
      return { pass: false, feedback: 'Need at least 3 citations with [n] notation' }
    return { pass: true }
  },
})

const formalTone = constraint({
  name: 'formal-tone',
  severity: 'suggest', // best-effort — returns last attempt if retries exhausted
  check: async (output) => {
    if (output.text.includes('gonna')) return { pass: false, feedback: 'Use formal academic tone' }
    return { pass: true }
  },
})
```

**Severities:**

| Severity  | On exhaust                              | Use case             |
| --------- | --------------------------------------- | -------------------- |
| `assert`  | Throws `ConstraintViolationError`       | Hard requirements    |
| `suggest` | Returns last attempt (tracked in audit) | Nice-to-have quality |

### Execution Model

All constraints run in parallel (`Promise.all`). Failed constraints produce combined feedback in a single retry message — the model sees all issues at once. Assert failures drive retries; suggest failures are tracked but don't trigger retries alone.

```ts
const result = await adapter.generate(prompt, {
  model: 'gpt-4o',
  constraints: [citeSources, formalTone],
  constraintMaxRetries: 3, // shared cap across all constraints
})

// Audit trail on result._meta.constraints
result._meta.constraints
// { allPassed: true, suggestFallback: false, entries: [...] }
```

### Scoping

Constraints support three scoping levels, merged via union (per-call wins over per-prompt wins over global, deduplicated by name):

```ts
// Global — applies to all generate() calls
config({ plugins: [createSafetyPlugin({ constraints: [targetLanguage] })] })

// Per-prompt — attached to prompt definition
const blogPrompt = prompt({ constraints: [citeSources, wordCount], ... })

// Per-call — highest precedence
await adapter.generate(prompt, { constraints: [formalTone] })
```

### Streaming Early Abort

Constraints can optionally detect violations early during streaming via `onChunk`, aborting the stream to retry sooner:

```ts
const targetLanguage = constraint({
  name: 'target-language',
  severity: 'assert',
  check: async (output) => {
    /* full output check */
  },
  onChunk: async (_chunk, accumulated) => {
    if (accumulated.length > 50) {
      const lang = detectLanguage(accumulated)
      if (lang !== 'fr') return { abort: true, feedback: 'Wrong language detected' }
    }
    return { abort: false }
  },
})
```

### `evaluateConstraint()`

Test constraints against a matrix of cases.

```ts
import { evaluateConstraint } from '@crux/core/safety'

const report = await evaluateConstraint(citeSources, [
  { input: { text: 'See [1] for details' }, expect: true },
  { input: { text: 'No citations here' }, expect: false },
])
// report.summary: { total: 2, passed: 2, failed: 0 }
```

Constraints also bridge into the other predicate surfaces without new concepts: `judgeConstraint()` (`@crux/core/scoring`) turns an LLM judge into a normal constraint for online enforcement of scored quality, and `constraintScorer()` (`@crux/core/quality`) runs any constraint as a binary scorer over an eval dataset — see [`judgeConstraint()`](#judgeconstraint) and [Using Scores In Quality](#using-scores-in-quality).

### `ConstraintViolationError`

Thrown when any `assert`-severity constraint fails after all retries. Carries all failing constraints (parallel execution means multiple can fail simultaneously).

```ts
import { ConstraintViolationError } from '@crux/core/safety'

try {
  await adapter.generate(prompt, { constraints: [citeSources] })
} catch (e) {
  if (e instanceof ConstraintViolationError) {
    // e.failedConstraints — [{ name, feedback }]
    // e.audit — full ConstraintAudit
    // e.lastOutput — the model's final output
    // e.totalAttempts — how many retries were attempted
  }
}
```

## Validation Retry

When structured output fails Zod schema validation, the adapter can automatically retry with the error injected as a corrective message. This implements the Instructor pattern — retry with feedback.

```ts
const result = await adapter.generate(prompt, {
  model: 'claude-sonnet-4-20250514',
  input: { instruction: 'Extract user info' },
  maxSteps: 10,
  validationRetry: {
    maxRetries: 3,
    onRetry: (attempt, zodError) => console.log(`Retry ${attempt}:`, zodError.message),
    onExhausted: (attempts, lastError) => console.error(`All ${attempts} retries failed`),
  },
})
```

### How It Works

1. **Text repair first** — `repairJsonText()` fixes common issues (markdown fences, trailing commas, preamble text) without an LLM call
2. **Schema validation** — Zod `safeParse()` against the prompt's output schema
3. **LLM retry** — if text repair didn't help, injects the failed output + Zod errors as a corrective user message and retries
4. **Shared budget** — each validation retry counts as a step against `maxSteps`

### Error Handling

When all retries are exhausted, throws `ValidationExhaustedError` with rich context:

```ts
import { ValidationExhaustedError } from '@crux/core'

try {
  await adapter.generate(prompt, { validationRetry: { maxRetries: 3 } })
} catch (err) {
  if (err instanceof ValidationExhaustedError) {
    console.log(err.lastRawOutput) // model's last output
    console.log(err.zodErrors) // Zod validation errors
    console.log(err.attempts) // number of retries attempted
    console.log(err.promptId) // which prompt failed
  }
}
```

### Fallback Composition

`ValidationExhaustedError` is automatically classified as `'validation_exhausted'` by `classifyError()`, making it trigger model fallback:

```ts
const model = fallback(weakModel, strongModel)
// Retries exhaust on weakModel → automatically tries strongModel with fresh retries
```

### Composition Integration

`validationRetry` is available on all composition patterns via `ExecuteOptions`:

```ts
// Pipeline — composition-level default for all steps
await pipeline({ context, steps, validationRetry: { maxRetries: 3 } })

// Parallel — all agents get validation retry
await parallel({ context, agents, validationRetry: { maxRetries: 2 } })

// Swarm — applied to each agent turn
await swarm({ agents, startAgent, input, validationRetry: { maxRetries: 3 } })

// Flows — pass validationRetry directly to generate() inside flow.step()
await flow.step('extract', () => adapter.generate(prompt, { model, input, validationRetry: { maxRetries: 3 } }))
```

### Text Repair Utility

`repairJsonText()` is exported for standalone use:

````ts
import { repairJsonText } from '@crux/core'

const fixed = repairJsonText('```json\n{"name": "Alice"}\n```')
// → '{"name": "Alice"}'
````

## Model Routing

Cost-aware model routing primitives. Import from `@crux/core/routing`.

### `router(config)`

Classifier-based model selection. A user-provided `classify` function categorizes the input, and routes map categories to models.

```ts
import { router } from '@crux/core/routing'

const smartRouter = router({
  id: 'smart-router',
  classify: async (input, hints?: { preferCheap?: boolean }) => {
    if (hints?.preferCheap) return 'simple'
    const tokens = estimateTokens(input)
    if (tokens < 200) return 'simple'
    if (tokens < 2000) return 'moderate'
    return 'complex'
  },
  routes: {
    simple: haiku,
    moderate: sonnet,
    complex: opus,
    default: sonnet, // required
  },
})

// Use directly
generate(prompt, { model: smartRouter, input })

// Force a route — .select() skips classify entirely
generate(prompt, { model: smartRouter.select('simple'), input })

// Pass typed hints to classify
generate(prompt, { model: smartRouter.with({ preferCheap: true }), input })
```

- **`.select(key)`** — force a specific route key (typed, skips classify)
- **`.with(hints)`** — pass typed hints to classify's 2nd parameter (only available when classify accepts hints)
- **Route keys** are inferred from the `routes` object — TypeScript enforces valid keys
- **`default` route** is required — catches unknown classify results at runtime

Metadata: `result._meta.router` contains `{ classifiedAs, selectedModel, availableRoutes, hints, overridden }`.

Router resolution emits a canonical `routing.router` span with route count, hints/override status, selected route/model, and a `router.selected` event. Nested routers or cascades stay inside that span so devtools can explain the full decision path.

Add `id` to routers that are part of your application architecture. It is optional for execution, but gives the index and devtools a stable join key (`routingId`) so authored routes, runtime spans, quality history, and source references survive variable/file renames. The project index indexes routers as `routing.router` definitions with `routing.router.route` children and relations to index-visible route targets, including imported cascades, fallbacks, agents, and prompts when TypeScript can prove the target.

### `cascade(config)`

Sequential quality escalation — tries cheap models first, escalates when evaluation fails.

```ts
import { cascade } from '@crux/core/routing'

const smartCascade = cascade({
  id: 'quality-cascade',
  tiers: [
    {
      model: haiku,
      evaluate: (result) => ({
        accepted: result.object.quality > 0.8,
        confidence: result.object.quality,
        budget: 0.8,
      }),
    },
    { model: sonnet, evaluate: (result) => result.object.quality > 0.6, budget: 0.6 },
    { model: opus }, // no evaluate = always accept
  ],
  budget: { maxCost: 0.05, maxLatencyMs: 5000 },
})

generate(prompt, { model: smartCascade, input })
```

- **Per-tier evaluate**: `(result, { model, cost, tierIndex, totalCost }) => boolean | { accepted, confidence?, budget?, note? } | Promise<...>`
- **Budget enforcement**: best-effort cost + wall-clock latency. When exceeded, returns last result with `_meta.cascade.budgetExceeded = true`
- **Provider errors propagate** — cascade does NOT catch them. Compose with `fallback()` per tier for error resilience
- **Streaming not supported** — cascade only works with `generate()`, not `stream()`
- Throws `CascadeExhaustedError` when all tiers fail evaluation (including optional last-tier evaluate)

Metadata: `result._meta.cascade` contains `{ tiersAttempted, totalTiers, acceptedAtTier, budgetExceeded, tiers: [...] }`.

Cascade resolution emits a parent `routing.cascade` span plus a child span for every attempted tier. Tier spans record model id, tier index, evaluation outcome, optional evaluator `note`/`confidence`/`budget`, cost, duration, and errors. Metadata and `routing.report.tiers[]` include every configured tier in order: attempted tiers carry accepted/rejected verdicts, while unattempted tiers are recorded as skipped with their model id and a not-reached/budget note.

Add `id` to cascades that should appear as stable authored architecture in the index. Cascade spans include `routingId` when provided, and the project index indexes ordered `routing.cascade.tier` children so devtools can show every configured tier, evaluator, imported fallback/router target, and relation even before a run reaches it.

Model fallback emits one `fallback.attempt` span per attempted model. Failed attempts close as errored spans with bounded error category metadata, successful attempts close with cost/duration metadata, and fallback transitions connect attempts with `fallback.attempt` edges.

Fallback is also re-exported from `@crux/core/routing`. Pass `fallback(modelA, modelB, { id: 'resilient-model' })` when the fallback policy is part of your authored architecture; the index indexes it as `routing.fallback` with ordered `routing.fallback.option` children and the runtime emits `routingId` on `fallback.attempt` spans.

### Composition

Router, cascade, and fallback nest freely:

```ts
// Router that uses cascade for complex tasks
const composed = router({
  classify: (input) => input.complexity,
  routes: {
    simple: haiku,
    complex: cascade({
      tiers: [{ model: sonnet, evaluate: qualityCheck }, { model: opus }],
    }),
    default: sonnet,
  },
})

// Cascade with fallback per tier (error resilience + quality escalation)
const resilient = cascade({
  tiers: [{ model: fallback(haiku, geminiFlash), evaluate: qualityCheck }, { model: fallback(opus, gpt4Turbo) }],
})
```

## Lifecycle Hooks

Per-prompt hooks give you fine-grained observability on individual prompts:

```ts
prompt({
  // ...
  hooks: {
    onPrepare: (args) => {
      // Fires after system message assembly, before generation
      console.log('System tokens:', args.systemTokens)
      if (args.droppedContexts.length > 0) {
        console.warn(
          'Dropped:',
          args.droppedContexts.map((c) => c.source),
        )
      }
    },
    onGenerate: (args, result) => {
      // Fires after successful generation
      console.log(`${args.promptId}: ${args.durationMs}ms`)
    },
    onError: (args) => {
      // Fires when generation fails
      reportError(args.promptId, args.error)
    },
  },
})
```

## Testing & Evaluation

Crux quality checks use one public model: define a `suite()`, run it against a `target()`, and store the resulting experiment with `quality()`. The same loop covers prompts, retrievers, RAG paths, flows, tool-like functions, and app-level orchestration.

Prompts, retrievers, and flows have convenience targets. Every other Crux primitive is evaluated with the universal `target({ id, run })` boundary.

| Primitive                                                                                                                                                | Quality path                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Prompt                                                                                                                                                   | `target.prompt({ prompt, generate })`  |
| Retriever / retrieval pipeline                                                                                                                           | `target.retriever(retriever, options)` |
| Flow                                                                                                                                                     | `target.flow(flow, options)`           |
| Pipeline, swarm, handoff, delegate, context, tool, grounding, indexer, loader, chunker, embedding, memory, blackboard, workspace, agent, storage adapter | `target({ id, run })`                  |

```ts
import { expect, quality, suite, target } from '@crux/core/quality'

const q = quality({ id: 'support', dir: '.crux/quality' })

const support = suite<{ question: string }, { answer: string }>('support-regressions', (test) => {
  test('refund answer is grounded', {
    input: { question: 'How do refunds work?' },
    expect: (ctx) => {
      expect(ctx.output.answer).toContain('refund')
      expect.retrieval(ctx).toContainHit({ sourceId: 'refunds.md' })
      expect.toolCalls(ctx).toHaveCalled('searchDocs')
    },
  })
})

await q.evaluate({
  id: 'support-v1',
  suite: support,
  target: target.prompt({
    prompt: supportPrompt,
    generate: (prompt, input) => generate(prompt, { model, input }),
  }),
})
```

`quality().evaluate()` emits a canonical `eval.run` span and one `eval.case` child span per case/variant pair. Case spans record suite, experiment, target, variant, assertion, scorer, trace, duration, and status metadata, plus bounded score/result artifacts for devtools and the TUI.

### Suites

A suite is a Git-friendly set of quality cases. Cases contain an input plus expectations. JSON suites are for shared regression fixtures; code suites are for typed assertions and app-specific checks.

`crux dev` auto-discovers authored suites by convention from files named `*.suite.ts`, `*.suite.tsx`, `*.suite.js`, `*.suite.mjs`, and `*.suite.json` under the project root, using the normal generated/dependency directory ignores. Discovered code suites appear in the Quality workbench and Project Index before any experiment has been run. Local suites created or edited in devtools still live under `.crux/quality/suites` and take precedence over discovered metadata for the same suite id.

```ts
const retrieval = suite<{ question: string }>('retrieval-regressions', (test) => {
  test('finds refund policy', {
    input: { question: 'Can I get a refund?' },
    expect: (ctx) => expect.retrieval(ctx).toContainHit({ sourceId: 'refunds.md' }),
  })
})

const shared = await suite.json('./evals/support.suite.json')
await suite.writeJSON(retrieval, './evals/retrieval.suite.json')
```

### Targets

Targets wrap the executable thing you want to measure. Use the narrow helper when Crux knows the shape, and `target()`/`target.custom()` for app-specific code.

```ts
const promptTarget = target.prompt({
  prompt: supportPrompt,
  generate: (prompt, input) => generate(prompt, { model, input }),
})

const docsTarget = target.retriever(docs, {
  query: ({ question }: { question: string }) => question,
  options: { limit: 5 },
})

const writerTarget = target.flow(writerFlow, {
  input: ({ brief }: { brief: string }) => ({ topic: brief }),
})

const appTarget = target({
  id: 'support-rag',
  run: async ({ question }: { question: string }) => {
    const hits = await docs.retrieve(question)
    const answer = await generateGroundedAnswer({ question, hits })
    return { text: answer.text, hits, citations: answer.citations, toolCalls: answer.toolCalls }
  },
})
```

### Expectations

`expect` is the Vitest-like assertion API for Quality suites. The case callback receives a normalized execution context, not just raw output: `ctx.input`, typed `ctx.output`, `ctx.retrieval.hits`, `ctx.toolCalls`, `ctx.steps`, `ctx.citations`, `ctx.handoffs`, `ctx.artifacts`, `ctx.safety`, `ctx.memory`, `ctx.workspace`, `ctx.routing`, `ctx.scoring`, `ctx.cache`, `ctx.compaction`, `ctx.embeddings`, `ctx.errors`, `ctx.retries`, `ctx.latency`, `ctx.events`, `ctx.spans`, `ctx.contexts`, `ctx.traceId`, optional `ctx.trace`, and execution ids such as `ctx.caseId`, `ctx.variantId`, and `ctx.targetId`.

```ts
expect: async (ctx) => {
  expect(ctx.caseId).toBe('refund-policy')
  expect(ctx.variantId).toBe('default')
  expect(ctx.targetId).toBe('support-agent')
  expect(ctx.output.answer).toContain('refund')
  expect(ctx.output.answer).toContain('30 days')
  expect(ctx.output.answer.length).toBeGreaterThanOrEqual(20)
  expect(ctx.output.citations).toHaveLength(1)
  expect(ctx.output.citations).toContainEqual({ sourceId: 'refunds.md', chunkId: 'refunds-1' })
  expect(ctx.output).toMatchObject({ citations: [{ sourceId: 'refunds.md' }] })
  expect(ctx.output).toHaveProperty('citations.0.sourceId', 'refunds.md')
  expect(ctx.output.citations[0]).toStrictEqual({ sourceId: 'refunds.md', chunkId: 'refunds-1' })
  expect(() => JSON.stringify(ctx.output)).not.toThrow()
  await expect(Promise.resolve(ctx.output.answer)).resolves.toContain('refund')
  await expect(Promise.reject(new Error('retry timeout'))).rejects.toThrow(/timeout/)
  expect(ctx.output.answer).not.toMatch(/maybe|probably/i)
  expect.retrieval(ctx).toContainHit({ sourceId: 'refunds.md', chunkId: 'refunds-1' })
  expect.retrieval(ctx).toHaveHitCount(1)
  expect.toolCalls(ctx).toHaveCalled('searchDocs')
  expect.toolCalls(ctx).toHaveCalledTimes('searchDocs', 1)
  expect.steps(ctx).toHaveSucceeded('draft')
  expect.citations(ctx).toContainCitation({ sourceId: 'refunds.md' })
  expect.artifacts(ctx).toHaveArtifactPath('/outputs/refund.md')
  expect.safety(ctx).toHaveNoBlockedGuardrails()
  expect.memory(ctx).toHaveWritten({ blockId: 'caseNotes' })
  expect.workspace(ctx).toHaveWritten('/outputs/refund.md')
  expect.routing(ctx).toHaveSelectedRoute('support')
  expect.scoring(ctx).toHaveJudgePassed('grounding')
  expect.cache(ctx).toHaveCacheHit('prompt')
  expect.compaction(ctx).toHaveStrategy('sliding-window')
  expect.embeddings(ctx).toHaveEmbeddingKind('dense')
  expect.errors(ctx).toHaveErrorCode('review_required')
  expect.retries(ctx).toHaveRetryCountBelow(3, 'generation')
  expect.latency(ctx).toHaveOperationDurationBelow('generation', 300)
  expect.events(ctx).toHaveFinalEvent('generation.end')
  expect.spans(ctx).toHaveSpanStatus('generation', 'ok')
  expect.contexts(ctx).toHaveIncludedContext('support-policy')
}
```

Value matchers include `toBe`, `toEqual`, `toStrictEqual`, `toContain`, `toContainEqual`, `toMatch`, `toMatchObject`, `toBeDefined`, `toBeUndefined`, `toBeNull`, `toBeTruthy`, `toBeFalsy`, `toBeNaN`, `toHaveLength`, `toHaveProperty`, `toBeTypeOf`, `toBeInstanceOf`, synchronous `toThrow`, `toSatisfy`, numeric comparisons (`toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`), `resolves`/`rejects` promise chains, and `.not` chaining.

Quality intentionally does not implement the full Vitest runner surface. Snapshots are omitted because Quality does not own persistent snapshot files; `expect.extend` is omitted because persisted results need a stable built-in matcher vocabulary; asymmetric matchers such as `expect.any()` are omitted because Quality assertions should serialize without runner-specific matcher objects.

Use Crux domain matchers when you want to assert execution behavior without manually spelunking the output shape:

```ts
expect.output(ctx).toMatchSchema(z.object({ answer: z.string() }))
expect.output(ctx).toHaveValidJson()
expect.output(ctx).toHaveField('citations.0.sourceId', 'refunds.md')
expect.output(ctx).toHaveFieldMatching('confidence', (value) => typeof value === 'number' && value >= 0.8)
expect.output(ctx).toSatisfyField('confidence', (value) => typeof value === 'number' && value >= 0.8)
expect.output(ctx).toHaveNoField('debug.rawPrompt')
expect.structuredOutput(ctx).toMatchSchema(z.object({ answer: z.string() }))

expect.toolCalls(ctx).toHaveCalledWith('searchDocs', { query: 'refunds' })
expect.toolCalls(ctx).toHaveReturnedWith('searchDocs', { ok: true })
expect.toolCalls(ctx).toHaveFailed('fallbackSearch')
expect.toolCalls(ctx).toHaveCallSequence(['searchDocs', 'draftAnswer'])
expect.toolCalls(ctx).toHaveNoUnexpectedCalls(['searchDocs', 'draftAnswer'])
expect.toolResults(ctx).toHaveToolResult('searchDocs')
expect.toolResults(ctx).toHaveToolResultStatus('searchDocs', 'success')
expect.toolResults(ctx).toHaveToolResultMatching('searchDocs', { ok: true })
expect.toolResults(ctx).toSatisfyToolResult('searchDocs', (result) => Boolean(result))
expect.toolResults(ctx).toHaveNoFailedToolResults()

expect.retrieval(ctx).toHaveMinHitCount(1)
expect.retrieval(ctx).toHaveMaxHitCount(5)
expect.retrieval(ctx).toHaveTopHit({ sourceId: 'refunds.md', chunkId: 'refunds-1' })

expect.steps(ctx).toHaveRun('draft')
expect.steps(ctx).toHaveStatus('draft', 'completed')
expect.steps(ctx).toHaveFailed('review')
expect.steps(ctx).toHaveStepOrder(['draft', 'review'])
expect.steps(ctx).toHaveOutput('draft', { status: 'ready' })
expect.steps(ctx).toHaveToolCall('draft', 'searchDocs')

expect.citations(ctx).toHaveCitationCount(1)
expect.citations(ctx).toHaveCitationForSource('refunds.md')
expect.citations(ctx).toHaveAllCitationsResolved()
expect.citations(ctx).toHaveNoDanglingCitations()
expect.citations(ctx).toHaveMinimumQuoteLength(20)
expect.citations(ctx).toQuoteOutput()
expect.grounding(ctx).toHaveCitationForSource('refunds.md')
expect.grounding(ctx).toHaveAllCitationsResolved()
expect.grounding(ctx).toQuoteOutput()

expect.usage(ctx).toHaveTokenUsageBelow(2_000)
expect.usage(ctx).toHaveCostBelow(0.05)
expect.usage(ctx).toHaveModel('gpt-4o-mini')
expect.usage(ctx).toHaveNoFallback()
expect.usage(fallbackResult).toHaveUsedFallback()
expect.budgets(ctx).toHaveTokenUsageBelow(2_000)
expect.budgets(ctx).toHaveCostBelow(0.05)
expect.budgets(ctx).toHaveLatencyBelow(1_000)
expect.budgets(ctx).toHaveNoFallback()

expect.artifacts(ctx).toHaveArtifact({ path: '/outputs/refund.md', kind: 'workspace.file' })
expect.artifacts(ctx).toHaveArtifactKind('workspace.file')
expect.artifacts(ctx).toHaveArtifactPath('/outputs/refund.md')
expect.artifacts(ctx).toHaveArtifactContent('/outputs/refund.md', /30 days/)
expect.artifacts(ctx).toHaveArtifactCount(2)

expect.safety(ctx).toHaveGuardrailAction('pii', 'pass')
expect.safety(ctx).toHaveBlockedGuardrail('jailbreak')
expect.safety(ctx).toHaveNoBlockedGuardrails()
expect.safety(ctx).toHaveConstraintPassed('citeSources')
expect.safety(ctx).toHaveConstraintFailed('tone')
expect.safety(ctx).toHaveAllConstraintsPassed()
expect.safety(ctx).toHaveConstraintRetry('tone')

expect.memory(ctx).toHaveRead({ blockId: 'customerProfile' })
expect.memory(ctx).toHaveWritten({ blockId: 'caseNotes' })
expect.memory(ctx).toHaveMemoryOperation({ operation: 'write', memoryId: 'support-memory' })
expect.memory(ctx).toHaveMemoryValue('caseNotes', { summary: 'Refund answer drafted' })

expect.workspace(ctx).toHaveWorkspaceOperation({ operation: 'write', path: '/outputs/refund.md' })
expect.workspace(ctx).toHaveRead('/workspace/policy.md')
expect.workspace(ctx).toHaveWritten('/outputs/refund.md')
expect.workspace(ctx).toHaveDeleted('/workspace/temp.md')
expect.workspace(ctx).toHaveListed('/workspace')
expect.workspace(ctx).toHaveNoWritesOutside(['/outputs/refund.md'])

expect.routing(ctx).toHaveRoutingKind('router')
expect.routing(ctx).toHaveSelectedRoute('support')
expect.routing(ctx).toHaveClassifiedAs('refund')
expect.routing(ctx).toHaveSelectedModel('gpt-4o-mini')
expect.routing(ctx).toHaveFallbackReason(/budget/i)
expect.routing(ctx).toHaveTierVerdict('gpt-4o-mini', 'accepted')

expect.scoring(ctx).toHaveScoreAtLeast(0.9)
expect.scoring(ctx).toHaveScoreBelow(1)
expect.scoring(ctx).toHaveVerdict('pass')
expect.scoring(ctx).toHaveJudge('grounding', { status: 'passed', minScore: 0.9 })
expect.scoring(ctx).toHaveJudgePassed('grounding')
expect.scoring(ctx).toHaveJudgeFailed('tone')
expect.scoring(ctx).toHaveNoFailedJudges()

expect.cache(ctx).toHaveCacheStatus('hit', 'prompt')
expect.cache(ctx).toHaveCacheHit('prompt')
expect.cache(ctx).toHaveCacheMiss('retrieval')
expect.cache(ctx).toHaveCacheWrite('embedding')
expect.cache(ctx).toHaveCacheKey('support:refunds')
expect.cache(ctx).toHaveSavedTokensAtLeast(100)

expect.compaction(ctx).toHaveCompacted()
expect.compaction(ctx).toHaveStrategy('sliding-window')
expect.compaction(ctx).toHaveTokenReductionAtLeast(500)
expect.compaction(ctx).toHaveCompressionRatioBelow(0.6)

expect.embeddings(ctx).toHaveEmbeddingKind('dense')
expect.embeddings(ctx).toHaveEmbeddingName('support-embedding')
expect.embeddings(ctx).toHaveInputCount(3)
expect.embeddings(ctx).toHaveCacheHitRatioAtLeast(0.5)
expect.embeddings(ctx).toHaveNoTruncation()
expect.embeddings(ctx).toHaveRetryCountBelow(2)

expect.errors(ctx).toHaveNoErrors()
expect.errors(ctx).toHaveErrorMessage(/timeout|rate limit/i)
expect.errors(ctx).toHaveErrorCode('provider_timeout')
expect.errors(ctx).toHaveErrorPhase('generation')

expect.retries(ctx).toHaveNoRetries()
expect.retries(ctx).toHaveRetried('generation')
expect.retries(ctx).toHaveRetryCount(1, 'generation')
expect.retries(ctx).toHaveRetryCountBelow(3, 'generation')

expect.latency(ctx).toHaveDurationBelow(500)
expect.latency(ctx).toHaveMaxDurationBelow(1_000)
expect.latency(ctx).toHaveOperationDurationBelow('generation', 300)

expect.events(ctx).toHaveEvent('generation.delta')
expect.events(ctx).toHaveEventSequence(['generation.start', 'tool.call', 'generation.end'])
expect.events(ctx).toHaveNoErrorEvents()
expect.events(ctx).toHaveFinalEvent('generation.end')
expect.events(ctx).toHaveChunkCountAtLeast(2)

expect.spans(ctx).toHaveSpan('generation')
expect.spans(ctx).toHaveSpanStatus('generation', 'ok')
expect.spans(ctx).toHaveNoErrorSpans()
expect.spans(ctx).toHaveSpanChild('support-agent', 'generation')
expect.spans(ctx).toHaveSpanOrder(['support-agent', 'generation', 'searchDocs'])
expect.spans(ctx).toHaveSpanDurationBelow('generation', 300)

expect.contexts(ctx).toHaveIncludedContext('support-policy')
expect.contexts(ctx).toHaveExcludedContext('account-history')
expect.contexts(ctx).toHaveDroppedContext('legacy-faq')
expect.contexts(ctx).toHaveNoDroppedContexts()
expect.contexts(ctx).toHaveContextState('support-policy', 'included')
expect.contexts(ctx).toHaveContextTokenCountBelow('support-policy', 500)

expect.handoffs(ctx).toHaveHandoff({ fromAgent: 'triage', toAgent: 'billing' })
expect.handoffs(ctx).toHaveHandoffPath(['triage', 'billing'])
expect.handoffs(ctx).toHaveHandoffCount(1)
```

The matcher namespaces are intentionally paired. Use the concrete namespace when you want the lower-level execution fact, and the semantic alias when you want the domain intent to read clearly in a suite.

| Intent             | Primary matcher namespace | Semantic alias                 |
| ------------------ | ------------------------- | ------------------------------ |
| Output contracts   | `expect.output(ctx)`      | `expect.structuredOutput(ctx)` |
| Tool intent/calls  | `expect.toolCalls(ctx)`   | -                              |
| Tool results       | `expect.toolResults(ctx)` | -                              |
| Citations          | `expect.citations(ctx)`   | `expect.grounding(ctx)`        |
| Usage and fallback | `expect.usage(ctx)`       | `expect.budgets(ctx)`          |
| Latency            | `expect.latency(ctx)`     | `expect.budgets(ctx)`          |

Assertion failure messages are deliberately short and stable because they are serialized into Quality experiment case results. Predicate helpers such as `toSatisfyField()` and `toSatisfyToolResult()` convert thrown predicate errors into a normal assertion failure instead of leaking stack traces into persisted results.

Failed case assertions keep a stable devtools-facing shape:

```ts
type QualityAssertionResult =
  | { passed: true }
  | {
      passed: false
      error: string
      failures: { source: 'expected' | 'expect'; message: string }[]
    }
```

`error` is the human summary. `failures` preserves whether the failure came from portable `expected` checks or an `expect` callback; future matcher metadata is additive on those failure entries. Target execution errors remain case-level `error` strings with `status: 'error'`, separate from assertion failures with `status: 'failed'`.

Custom `target({ run })` outputs can expose normalized execution data using these common shapes:

| Matcher namespace             | Accepted output shapes                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `output` / `structuredOutput` | The case output itself; `toHaveField()` and predicate helpers use dot paths such as `citations.0.sourceId`.                                                                                    |
| `toolCalls` / `toolResults`   | `toolCalls: [{ name, args, result, status, error }]`, `tools: [...]`, or nested tool-call-shaped records with `name`, `toolName`, or `tool`.                                                   |
| `retrieval`                   | Top-level hit arrays, `hits`, `retrieval.hits`, or `grounding.hits`; optional query from `query`, `retrieval.query`, or `grounding.query`.                                                     |
| `steps`                       | `steps`, `stepResults`, flow/pipeline/agent step arrays, or step-shaped records with `id`/`name`, status, output/result, error, and nested tool calls.                                         |
| `citations` / `grounding`     | `citations`, `resolvedCitations`, or `citationArtifact.resolvedCitations` entries with `sourceId`, optional `chunkId`, `quote`, `url`, and `path`.                                             |
| `handoffs`                    | `handoffs`, agent handoff arrays, or handoff-shaped records with `fromAgent`, `toAgent`, reason/context, hop number, data, or summary.                                                         |
| `artifacts`                   | `artifacts`, `files`, generated output arrays, or artifact-shaped records with `id`, kind, name, path, content type, content/preview, and metadata.                                            |
| `safety`                      | `_meta.guardrails`, `_meta.constraints`, `guardrails`, `constraints`, or report entries with guard/constraint names, actions, pass/fail state, reasons, feedback, and attempts.                |
| `memory`                      | `memory.operations`, memory operation arrays, or operation-shaped records with operation/read/write, memory id, block id, key, value, and summary.                                             |
| `workspace`                   | `workspace.operations`, workspace operation arrays, or operation-shaped records with operation/read/write/delete/list, path, status, and result kind.                                          |
| `routing`                     | `routing`, `_meta.routing`, routing report arrays, or report-shaped records with kind, chosen route/model, classification, fallback reason, and tier verdicts.                                 |
| `scoring`                     | `scoring`, `_meta.scoring`, score reports, judge reports, verdicts, primary failure type, score/raw score, reasoning, and judge arrays.                                                        |
| `usage` / `budgets`           | `usage` or `_meta.usage` with `totalTokens`, `tokens`, `tokenCount`, or `inputTokens` plus `outputTokens`; `cost` or `_meta.cost`; model ids and fallback metadata under top-level or `_meta`. |
| `cache`                       | `cache`, `_meta.cache`, cache report arrays, or records with cache kind, status, key, hit/miss counts, and saved token/cost/latency metrics.                                                   |
| `compaction`                  | `compaction`, `_meta.compaction`, compaction report arrays, or records with strategy, before/after tokens, compression ratio, and summary.                                                     |
| `embeddings`                  | `embeddings`, `_meta.embeddings`, embedding report arrays, or records with kind/name, dimensions, input/chunk counts, cache stats, truncation, and retry count.                                |
| `errors`                      | `errors`, `_meta.errors`, thrown-error summaries, or error-shaped records with message, name, code, phase, and retryable state.                                                                |
| `retries`                     | `retries`, `_meta.retries`, retry report arrays, or records with attempt, operation, max attempts, status, error, and delay.                                                                   |
| `latency` / `budgets`         | `latency` arrays, latency report records, or `_meta.durationMs` / `durationMs`.                                                                                                                |
| `events`                      | `events`, `_meta.events`, event arrays, or event-shaped records with type/name, status, timestamp, and data.                                                                                   |
| `spans`                       | `spans`, `traceSpans`, `trace.spans`, `_meta.trace.spans`, or span-shaped records with `name`, optional ids, status, and duration.                                                             |
| `contexts`                    | `contexts`, `contextContributions`, `contextReports`, `_meta.contexts`, or context contribution records with `contextId`/`id`, state, inclusion, drop reason, priority, and token counts.      |

`qualityMatcherRegistry` exports the matcher namespace and method list used by core tests to keep the implementation, docs, and public API shape aligned.

```ts
import { qualityMatcherRegistry } from '@crux/core/quality'

console.log(qualityMatcherRegistry.toolResults)
```

A custom agent target can return one realistic object with the output plus execution facts that Quality can normalize:

```ts
const supportAgent = target({
  id: 'support-agent',
  run: async ({ question }: { question: string }) => ({
    answer: 'Refunds are available within 30 days.',
    confidence: 0.92,
    citations: [{ sourceId: 'refunds.md', chunkId: 'refunds-1', quote: 'Refunds are available within 30 days' }],
    toolCalls: [
      {
        name: 'searchDocs',
        args: { query: question },
        status: 'success',
        result: { ok: true, sourceIds: ['refunds.md'] },
      },
    ],
    contexts: {
      contributions: [
        { id: 'support-policy', state: 'included', included: true, tokens: 220 },
        { id: 'legacy-faq', state: 'budget-dropped', included: false, dropped: true, reason: 'budget', tokens: 620 },
      ],
    },
    _meta: {
      usage: { inputTokens: 120, outputTokens: 80 },
      cost: 0.002,
      durationMs: 320,
      actualModelId: 'gpt-quality',
      trace: {
        spans: [
          { id: 'root', name: 'support-agent', status: 'ok', durationMs: 320 },
          { id: 'tool', parentId: 'root', name: 'searchDocs', status: 'ok', durationMs: 40 },
        ],
      },
    },
  }),
})
```

Crux domain matchers normalize common execution shapes before asserting. `expect.toolCalls(ctx)` looks through `toolCalls`, `tools`, and tool-call-shaped records; `expect.toolResults(ctx)` uses the same normalized calls for result payload, status, partial-result, and failed-result checks. `expect.retrieval(ctx)` looks through top-level arrays, `hits`, `retrieval.hits`, and `grounding.hits`. `expect.steps(ctx)` looks through flow, pipeline, agent, and step arrays. `expect.citations(ctx)` accepts common citation and source reference shapes; `expect.grounding(ctx)` aliases the citation checks that assert resolved, quote-backed answers. `expect.usage(ctx)` reads `usage`, `_meta.usage`, `cost`, `_meta.cost`, model ids, and fallback metadata; `expect.budgets(ctx)` groups token, cost, latency, and fallback budget assertions. `expect.artifacts(ctx)` reads generated file/artifact arrays and observability-style artifact previews. `expect.safety(ctx)` reads `_meta.guardrails`, `_meta.constraints`, and guardrail/constraint report shapes. `expect.memory(ctx)`, `expect.workspace(ctx)`, `expect.routing(ctx)`, `expect.scoring(ctx)`, `expect.cache(ctx)`, `expect.compaction(ctx)`, `expect.embeddings(ctx)`, `expect.errors(ctx)`, `expect.retries(ctx)`, `expect.latency(ctx)`, `expect.events(ctx)`, `expect.spans(ctx)`, and `expect.contexts(ctx)` read direct operation/report arrays plus Crux memory, workspace, routing, score, cache, compaction, embedding, error, retry, latency, event, trace span, and context contribution shapes. `expect.output(ctx)` and `expect.structuredOutput(ctx)` always target the case output when you pass the full Quality context.

For full output typing, pass the expected output type to `suite<Input, Output>()`.

```ts
type SupportOutput = {
  answer: string
  citations: Array<{ sourceId: string; chunkId: string }>
}

const support = suite<{ question: string }, SupportOutput>('support-regressions', (test) => {
  test('refund policy', {
    input: { question: 'How do refunds work?' },
    expect: (ctx) => {
      expect(ctx.output.answer).toContain('refund')
      expect.citations(ctx).toHaveCitationCount(1)
    },
  })
})
```

Use `expect.all<Input, Output>()` when you prefer splitting checks into separate callbacks while keeping each callback typed.

```ts
test('structured result', {
  input: { question: 'How do refunds work?' },
  expect: (ctx) => {
    if (!ctx.output.answer.includes('refund')) throw new Error('Expected refund answer')
  },
})
```

### Variants And Comparisons

Run the same suite against multiple targets or model/settings choices, then compare the resulting variants.

```ts
const experiment = await q.evaluate({
  id: 'support-models',
  suite: support,
  baseline: 'fast',
  variants: {
    fast: { target: fastSupportTarget, model: 'gpt-5-mini' },
    accurate: { target: accurateSupportTarget, model: 'gpt-5.1' },
  },
})

await q.compare({
  baseline: { experiment, variantId: 'fast' },
  candidate: { experiment, variantId: 'accurate' },
  gates: { passRate: { minDelta: 0 } },
})
```

Experiments are persisted under `.crux/quality` as portable quality state, while trace/run history remains in the local observability SQLite store. Devtools and the CLI join both through Go services to inspect previous runs, compare variants, export failed cases, and replay cassettes locally. Committed cassette fixtures named `*.cassette.json` are also discovered recursively from the project root and shown alongside local `.crux/quality/cassettes` records.

## Flows

Real applications chain multiple `generate()` calls into pipelines — research then synthesize, plan then execute, draft then validate. `flow` makes these pipelines a first-class primitive with named steps, automatic retries, suspend/resume for human-in-the-loop, and full observability.

Import from `@crux/core` or `@crux/core/flow`:

```ts
import { flow, cancelFlow, listFlows, createFlowId } from '@crux/core'
// signalFlow is also exported but is a low-level primitive — prefer handle.signal()
```

### `flow<T, TInput>(name, handler)`

Define a named flow and return a frozen `FlowHandle`. Separates definition from execution: the handler is captured once, then `.run()` can be called repeatedly with different inputs and options.

```ts
import { flow } from '@crux/core'
import { generate } from '@crux/ai'

const researchFlow = flow('research', async (flow) => {
  const plan = await flow.step('plan', () => generate(planner, { model, input: { query: flow.input.query } }))
  return flow.step('search', () => generate(searcher, { model, input: { plan: plan.object } }))
})

const result = await researchFlow.run({ input: { query: 'cloud migration' } })
// result.status === 'completed'
// result.output === search result
```

| Parameter | Type                                           | Description                                                                   |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `name`    | `string`                                       | Human-readable flow name for devtools display                                 |
| `handler` | `(flow: FlowScope<TInput>) => Promise<T> \| T` | Flow function with access to `flow.step()`, `flow.suspend()`, `flow.cancel()` |

**Returns:** `FlowHandle<T, TInput>` — frozen handle with `.run()`, `.signal()`, and `.name`

### `FlowHandle<T, TInput>`

The handle returned by `flow()`. Immutable (frozen).

| Property / Method                      | Type                     | Description                                              |
| -------------------------------------- | ------------------------ | -------------------------------------------------------- |
| `name`                                 | `string`                 | The flow's registered name                               |
| `run(options?)`                        | `Promise<FlowResult<T>>` | Execute the flow with optional input and runtime options |
| `signal(flowId, signalName, payload?)` | `Promise<void>`          | Send a signal to a suspended instance of this flow       |

### `FlowRunOptions<TInput>`

Options passed to `handle.run()`.

| Field          | Type      | Description                                                  |
| -------------- | --------- | ------------------------------------------------------------ |
| `input`        | `TInput?` | Typed input data, accessible as `flow.input` inside the flow |
| `flowId`       | `string?` | Use a specific ID instead of generating one                  |
| `parentFlowId` | `string?` | Explicit parent flow ID for cross-action nesting             |
| `goal`         | `string?` | Goal description for devtools display                        |
| `resume`       | `string?` | Resume a previously suspended flow by its flowId             |

### Suspend / resume example

```ts
import { flow } from '@crux/core'

const reviewFlow = flow('content-review', async (flow) => {
  const draft = await flow.step('draft', () => generate(writer, { model, input: { topic } }))

  const approval = await flow.suspend<{ approved: boolean }>('editor-review', {
    schema: z.object({ approved: z.boolean() }),
    timeout: '24h',
  })

  if (!approval.approved) return flow.cancel('Rejected by editor')

  return flow.step('publish', () => generate(publisher, { model, input: { draft: draft.object } }))
})

// First call — suspends at the gate
const result = await reviewFlow.run()
// result.status === 'suspended'

// Signal via the handle (recommended)
await reviewFlow.signal(result.flowId, 'editor-review', { approved: true })

// Resume — completed steps replay from cache
const final = await reviewFlow.run({ resume: result.flowId })
// final.status === 'completed'
```

> **`handle.signal()` vs `signalFlow()`:** Always prefer `handle.signal()`. The standalone `signalFlow()` is a low-level primitive that only writes to the store — it does NOT trigger resume. In Convex, use the `flow()` handle from `@crux/convex/server` or an app-local signal helper that both writes the signal and schedules the resume action.

> **Migration from `withFlow`:** `flow` replaces the previous `withFlow(name, fn, options)` API. Convert `await withFlow('name', fn, opts)` to `await flow('name', fn).run(opts)`. For flows called repeatedly, define the flow once at module level and call `.run()` at each call site.

For the full flow API reference (FlowResult, FlowScope, SuspendOptions, StepOptions, signalFlow, cancelFlow, listFlows), see the [API Reference](/docs/reference/crux-core/flow).

For detailed guides on retry/fallback, nested flows, cross-action patterns, and recipes, see the [Flows Guide](/docs/guides/flows).

### Convex Server Boundaries and Flows

Use `@crux/convex/server` for Crux-aware Convex function boundaries. These wrappers use Convex's native function builders, add a hidden `__crux` propagation envelope, pass `ctx.crux` to handlers, restore incoming observability context, and flush before serverless actions return. Queries and mutations propagate active context but do not create standalone Runs by default.

```ts
import { action, flow } from '@crux/convex/server'
import { v } from 'convex/values'

const researchFlow = flow({
  name: 'research',
  args: { question: v.string() },
  handler: async (flow, args, ctx) => {
    const plan = await flow.step('plan', () => planResearch(args.question))
    return flow.step('synthesize', () => synthesize(plan))
  },
})

export const research = researchFlow.action

export const publicResearch = action({
  args: researchFlow.args,
  handler: async (ctx, args) => {
    await requireUser(ctx)
    return researchFlow.handler(ctx, args)
  },
})
```

| Property / Method                                      | Type                     | Description                                                    |
| ------------------------------------------------------ | ------------------------ | -------------------------------------------------------------- |
| `name`                                                 | `string`                 | The flow's registered name                                     |
| `action`                                               | Convex action definition | Internal Convex action definition for start/resume             |
| `handler(ctx, args)`                                   | `Promise<FlowResult<T>>` | Convenience handler for wrapping in an app-owned public action |
| `args`                                                 | Convex validators        | User args for composing custom wrappers                        |
| `signal(ctx, actionRef, flowId, signalName, payload?)` | `Promise<void>`          | Write signal to store AND schedule resume                      |

Immediate compositions such as `parallel()`, `consensus()`, and `swarm()` stay in their adapter packages. Call them inside a Crux-aware Convex `action()` / `internalAction()` when you need trace continuity.

For the full Convex integration guide including setup, memory persistence, and cross-action patterns, see the [Convex Guide](/docs/guides/convex).

## Flow Quality

Use `target.flow()` in the Quality API to run a flow as the thing under test. Flow quality cases use the same suite syntax as prompt, retrieval, and RAG checks.

```ts
import { expect, quality, suite, target } from '@crux/core/quality'

const q = quality({ id: 'content' })

const writerSuite = suite<{ brief: string }, string>('writer-flow', (test) => {
  test('researches before drafting', {
    input: { brief: 'Explain SSO setup' },
    expect: (ctx) => {
      expect(ctx.output).toContain('SSO')
      expect.steps(ctx).toHaveSucceeded('research')
      expect.toolCalls(ctx).toHaveCalled('searchDocs')
    },
  })
})

await q.evaluate({
  id: 'writer-flow-v1',
  suite: writerSuite,
  target: target.flow(writerFlow, {
    input: ({ brief }) => ({ topic: brief }),
  }),
})
```

For app-specific orchestration, wrap the production path in `target()` and return the output, tool calls, trace summaries, or flow-step records you want Quality expectations to inspect.

## Memory

Agents need more than one kind of memory. They need a small working state for the current task, a transcript of what happened, a place to store learned facts, and sometimes durable procedures that shape future behavior. Crux models those as memory blocks and composes them with `memory()`.

```ts
import { memory, recentMessages, workingState, facts, procedures } from '@crux/core/memory'
import { z } from 'zod'

const assistantMemory = memory({
  id: 'assistant',
  store,
  namespace: ({ input }) => `user:${input.userId}`,
  blocks: [
    recentMessages({ id: 'recent', maxMessages: 12 }),
    workingState({
      id: 'state',
      schema: z.object({
        goal: z.string().optional(),
        openQuestions: z.array(z.string()).default([]),
      }),
    }),
    facts({
      id: 'facts',
      embed: dense,
      extract: async (turn) => extractUserFacts(turn),
      write: { mode: 'propose' },
    }),
    procedures({
      id: 'procedures',
      embed: dense,
      write: { mode: 'auto' },
    }),
  ],
})

const reply = prompt({
  id: 'reply',
  use: [assistantMemory],
  input: z.object({ userId: z.string(), message: z.string() }),
  system: 'Answer using relevant memory. Do not invent preferences.',
  prompt: ({ input }) => input.message,
})
```

When a prompt uses a `memory()` object, the resolver renders all blocks into prompt context. The adapter then captures the completed turn after `generate()` or `stream().completion()`, runs each block's capture policy, and flushes pending writes. Application code can also call blocks directly when memory changes outside an LLM turn.

Memory reads and writes are first-class observability records. Built-in blocks and `blackboard()` emit canonical `memory.read` and `memory.write` spans, attach `memory.snapshot` artifacts for rendered/read/written state, `memory.recall` artifacts for recalled block previews, and `memory.diff` artifacts for before/after write summaries. Those artifacts are connected with `memory.read` / `memory.write` edges. Working-state and blackboard spans include authored schema metadata when available; all memory spans include source definition ids so the Go backend can join runtime operations back to Project Index definitions. Standalone memory and blackboard calls create implicit runs, while memory used during prompt resolution nests under the active context/prompt spans. Devtools memory views read the backend resource projection, which includes the source span plus linked artifacts and edges instead of a separate memory-only protocol. The Go persistence layer merges `span:start` and `span:end` attributes by span id so terminal metrics such as `resultCount` cannot erase identity metadata such as `memoryId` or `blockId`.

### Memory Blocks

`recentMessages()` stores a bounded rolling conversation window. Use it when the next response needs immediate chat continuity, not long-term recall.

`workingState()` is a typed scratchpad. Use it for the current task state: plan, step, open questions, accumulated findings, or agent-local state that should be overwritten rather than appended.

`episodes()` stores append-only events and can recall them with a dense embedding. Use it for “what happened?” questions such as previous conversations, tool results, or observations. Pass `retention` (e.g. `'90d'`) to describe the eviction window — it rides on every read/write event so devtools surfaces the real policy rather than inferring one. Sweep stale entries with `evict(key, { evictedCount, gcAt })` instead of `delete()` so each eviction emits an attributable `evict` write carrying GC telemetry (`lastGcAt`, `lastGcEvicted`).

`facts()` stores extracted conclusions. By default it proposes new facts instead of writing them immediately, because user profile and long-term knowledge should usually be reviewable.

`procedures()` stores learned operating instructions, preferences, and habits that should affect future behavior. It renders as Operating Memory.

`memoryBlock()` lets power users define custom blocks with their own render, tools, capture, flush, and proposal behavior.

### Capture and Proposals

The default write path is intentionally conservative. `facts()` and `procedures()` default to `write: { mode: 'propose' }`, which creates pending proposals:

```ts
const proposals = await assistantMemory.proposals.list({ namespace: 'user:123' })
await assistantMemory.proposals.approve(proposals[0].id)
await assistantMemory.proposals.reject(proposals[1].id, { reason: 'too speculative' })
```

Use `write: { mode: 'auto' }` for memory that is safe to write without review. Policies can redact, validate, or reject candidates before either proposal or write:

```ts
const profileFacts = facts({
  id: 'profile',
  extract: extractFacts,
  policy: {
    redact: removeSecrets,
    validate: z.object({ content: z.string(), confidence: z.number().min(0).max(1) }),
    shouldRemember: (fact) => fact.confidence >= 0.7,
  },
})
```

Blocks are reusable. The same `facts()` block can be used in multiple `memory()` compositions with different stores, namespaces, policies, or prompt bindings.

### Embeddings

Use `embedding()` when you want a reusable embedding object instead of wiring a raw callback through each consumer.

```ts
import { embedding } from '@crux/core/embedding'

const dense = embedding({
  kind: 'dense',
  name: 'text-embedding-3-small',
  dimensions: 1536,
  maxInputTokens: 8191,
  batch: { maxSize: 100, concurrency: 3 },
  embed: async (texts) => ({ embeddings: await provider.embedMany(texts) }),
})

const sparse = embedding({
  kind: 'sparse',
  name: 'bm25',
  maxInputTokens: 8191,
  batch: { maxSize: 100, concurrency: 3 },
  embed: async (texts) => ({ embeddings: texts.map(toSparseVector) }),
})
```

Add governance where production systems need it. The provider still only sees the final texts that should be embedded:

```ts
import { embedding, embeddingCache, normalizeText } from '@crux/core/embedding'

const dense = embedding({
  kind: 'dense',
  name: 'docs-embedding',
  dimensions: 1536,
  maxInputTokens: 8191,
  batch: { maxSize: 100, concurrency: 3 },
  preprocess: normalizeText({ trim: true, collapseWhitespace: true }),
  truncate: { strategy: 'fail' },
  retry: { maxAttempts: 3, baseDelayMs: 250 },
  cache: embeddingCache({ store, namespace: 'embed-cache' }),
  rateLimit: { concurrency: 3 },
  embed: async (texts) => ({ embeddings: await provider.embedMany(texts) }),
})
```

Governance is part of the embedding definition because it affects every consumer consistently:

- `preprocess` normalizes text before cache lookup and provider calls
- `truncate` defaults to fail-fast; `{ strategy: 'chars', maxChars }` must be explicit
- `retry` retries provider batch failures while preserving input order
- `cache` stores vectors per normalized text with policy-aware keys
- `rateLimit` caps provider calls across concurrent `embedMany()` calls on the same embedding

Every `embed()` / `embedMany()` call emits a canonical `embedding.call` span. When an embedding cache is configured, the cache read/write work emits nested `cache.lookup` spans with hit, miss, and write counts. Output artifacts intentionally store bounded shape metadata, usage, cost, and governance details, not raw vector values.

If you do not want to hand-wrap provider SDKs, the adapter packages now expose embedding helpers where the provider actually supports them:

- `@crux/ai` → `embedding()` for AI SDK embedding models
- `@crux/openai` → `embedding()` for direct OpenAI SDK usage
- `@crux/google` → `embedding()` for direct Google GenAI SDK usage

`@crux/anthropic` remains generation-only on the direct SDK path. Pair `createAnthropic()` with `embedding()` or another embedding provider when you need retrieval or indexing.

`embedding()` is intentionally limited to vector generation primitives:

- `kind: 'dense'` returns `number[]` / `number[][]`
- `kind: 'sparse'` returns `{ indices, values }`
- hybrid search is composed above this layer by stores or retrievers

Dense memory blocks such as `episodes()` and `facts()` accept either a legacy `EmbedFn` or a dense embedding object. For new code, prefer the dense embedding object so batching, telemetry, and provider metadata live in one reusable place.

### Retrieval & Indexing

Crux splits document retrieval into five layers:

- `@crux/core/embedding` for dense and sparse vector generation
- `@crux/ingest` for text, file, and URL loading
- `@crux/core/indexing` for chunking and write-time embedding
- `corpus()` for repeated sync jobs, change detection, stale-source cleanup, and dry runs
- `@crux/core/retrieval` for text query -> scored hits, context, and tools

That keeps the public DX clear:

- embeddings generate vectors
- ingestion loads source material
- indexing chunks documents and writes retrieval records
- corpus sync keeps indexed sources current
- retrieval answers queries
- hybrid is a retrieval strategy, not an embedding kind
- `indexingPipeline()` is the customization point for transforms, chunkers, caching, and parent/child chunking

Minimal flow:

```ts
import { embedding } from '@crux/core/embedding'
import { chunker, corpus, indexer, indexingPipeline, transform } from '@crux/core/indexing'
import { retriever, reranker } from '@crux/core/retrieval'
import { inMemoryDataStore, inMemoryVectorStore } from '@crux/core/storage'
import { filesSource } from '@crux/ingest'

const dense = embedding({ kind: 'dense', ... })
const sparse = embedding({ kind: 'sparse', ... })
const data = inMemoryDataStore()
const vectors = inMemoryVectorStore()

const docsIndexer = indexer({
  id: 'docs',
  namespace: 'product-docs',
  data,
  vectors,
  dense,
  sparse,
  cache: true,
  pipeline: indexingPipeline({
    documents: [
      transform.document({
        name: 'normalize-frontmatter',
        version: '1',
        run: (doc) => ({ ...doc, metadata: { ...doc.metadata, indexedBy: 'docs' } }),
      }),
    ],
    chunker: chunker.structured({ maxChars: 1200, tableRowsPerChunk: 25 }),
  }),
})

const docsCorpus = corpus({
  id: 'docs',
  namespace: 'product-docs',
  data,
  indexer: docsIndexer,
})

const docsRetriever = retriever({
  id: 'docs',
  namespace: 'product-docs',
  data,
  vectors,
  dense,
  sparse,
  search: { mode: 'hybrid', fusion: 'dbsf' },
  rerank: reranker({
    name: 'top-5',
    rerank: ({ hits }) => hits.slice(0, 5),
  }),
})

const loader = filesSource({ directory: './docs' }, { namespace: 'product-docs' })

await docsCorpus.sync(loader.load(), {
  sourceSet: 'complete',
  stale: 'delete',
})

const hits = await docsRetriever.retrieve('latest roadmap')
```

For advanced query-time RAG, wrap the retriever instead of replacing it:

```ts
import { compress, decay, diversify, multiQuery, parentExpand, retrievalPipeline } from '@crux/core/retrieval'

const advancedDocs = retrievalPipeline(docsRetriever, [
  multiQuery({ generate: generateTextFn, model: queryModel, count: 4 }),
  parentExpand({ store }),
  compress({
    generate: generateObjectFn,
    model: compressionModel,
    maxCharsPerHit: 1200,
  }),
  diversify({ strategy: 'mmr', limit: 8, sourcePenalty: 0.15 }),
  decay({
    field: 'metadata.updatedAt',
    halfLifeMs: 30 * 24 * 60 * 60 * 1000,
  }),
])

const hits = await advancedDocs.retrieve('latest roadmap')
const debug = await advancedDocs.retrieveWithTrace('latest roadmap')
```

`retrievalPipeline()` is still a retriever. Put `advancedDocs` directly in `use`, configure `inject: 'context' | 'tool' | 'both'`, or call `retrieve()` directly. Manual `asContext()` and `asTools()` helpers remain available for advanced wiring, but the normal prompt path is `use: [advancedDocs]`. Query stages such as `multiQuery()` and `queryPlanner()` run before retrieval fanout. Hit stages such as `parentExpand()`, `compress()`, `diversify()`, and `decay()` run after the base retriever returns candidates. `retrieveWithTrace()` adds stage counts, warnings, and bounded previews for devtools/CLI/TUI debugging; OTel receives only privacy-safe stage counts and identifiers.

Retrieval and indexing primitives emit canonical observability records automatically. Direct `retriever().retrieve()` calls open `retrieval.query` spans with `retrieval.hits` artifacts and `retrieval.returned` edges. `retrievalPipeline()` opens a parent `retrieval.pipeline` span and records each fanout/query/hit stage as a child `retrieval.stage` span with bounded output previews. `indexer().chunk()`, `indexer().indexDocuments()`, and `indexer().indexChunks()` open `indexing.pipeline` spans; document transforms, chunkers, and chunk transforms are visible as child stage spans plus `indexing.report` artifacts with totals and stage counts. `corpus().sync()` opens `corpus.sync`, records loader results as `ingest.parse` with `ingest.report`, nests indexing work underneath the corpus trace, and emits `corpus.report` source-ledger summaries.

Use direct retriever/pipeline injection when the model needs retrieval context or search tools:

```ts
const promptDocs = retrievalPipeline(
  docsRetriever,
  [multiQuery({ generate: generateTextFn, model: queryModel, count: 4 }), parentExpand({ store })],
  {
    inject: 'both',
    context: {
      query: ({ question }) => question,
      limit: 8,
    },
    tools: {
      prefix: true,
      include: ['search', 'getSource'],
    },
  },
)

const assistant = prompt({
  use: [promptDocs],
  input: z.object({ question: z.string() }),
  system: 'Answer from the product docs.',
})
```

Use `grounding()` when the output must cite and stay bound to retrieved evidence:

```ts
import { grounding, citationSchema } from '@crux/core/citations'

const groundedDocs = grounding({
  id: 'product-docs',
  retriever: advancedDocs,
  query: ({ input }) => input.question,
  inject: 'context',
  citations: {
    required: true,
    quotes: 'required',
  },
})

const answer = prompt({
  use: [groundedDocs],
  input: z.object({ question: z.string() }),
  output: z.object({
    answer: z.string(),
    citations: z.array(citationSchema),
  }),
  system: 'Answer only from the provided sources.',
})
```

Citation validation emits canonical `citation.check` spans. Reports include allowed hit counts, valid/invalid citation counts, issue codes, optional output-text anchors (`start`, `end`, `outputQuote`) for inline citation rendering, and bounded `citation.report` artifacts without embedding full retrieved content in span attributes.

This is the normal product path: loaders produce documents, `corpus.sync()` keeps the indexed source set current, and retrievers query it. A corpus keeps a source ledger so repeated syncs can skip unchanged sources, detect changed content or metadata, delete stale sources when the caller supplies a complete source set, and preview work with `dryRun`.

Ingestion documents are structured. `@crux/ingest` parses text, Markdown, HTML, PDF, CSV, JSON, DOCX, and XLSX into `parts` such as text blocks, pages, tables, sheets, and JSON paths. `content` is still derived for today’s chunking and retrieval path, so simple users can keep thinking in text while advanced users retain page/table/sheet provenance for custom chunkers, UI citations, and future multimodal or document-intelligence work.

`indexingPipeline()` is where source material becomes retrieval-ready. Document transforms run before chunking, chunkers decide searchable boundaries, and chunk transforms can annotate or filter chunks before writes. Built-in chunkers cover text, structured documents, parent/child indexing, and semantic segmentation. When `cache: true` is enabled, expensive pipeline stages are cached by source hash and stage fingerprint; corpus source records also store the stage ledger so devtools, CLI, TUI, and OTel can explain what happened during a sync.

Use `loader.load()` for product sync jobs because it yields per-source results and lets a corpus record failed sources without stopping the whole run. Use `loader.documents()` when a script or test should fail fast on the first bad source.

Use `indexer.indexDocuments()` for one-off writes, tests, and deliberately manual updates. Use `corpus.sync()` when you are building a product feature that reruns ingestion over time.

Use `use: [retriever]` or `use: [retrievalPipeline]` for normal composition. Use `asContext()` and `asTools()` when you want manual control over exactly what is injected. Tool names are `search` and `getSource`, with `prefix: true` or `prefix: 'docs'` for multi-source prompts.

### Workspaces

`workspace()` gives agents durable scratch space and generated output files without custom file-tool glue.

```ts
import { prompt } from '@crux/core'
import { inMemoryStorage } from '@crux/core/storage'
import { workspace } from '@crux/core/workspace'

const ws = workspace({
  id: 'research',
  namespace: `thread:${threadId}`,
  storage: inMemoryStorage(),
})

const analyst = prompt({
  id: 'analyst',
  use: [ws],
  system: 'Use /workspace for notes and /outputs for final deliverables.',
})
```

Default mounts are `/workspace` and `/outputs`. There is no separate public artifact primitive in V1; generated deliverables are regular files under `/outputs`.

Storage is deterministic: `DataStore` holds metadata and small inline text/JSON, while `BlobStore` holds binary and oversized payloads. Binary writes without a blob store throw clearly. `listWorkspace` supports directory paths and simple globs like `/workspace/**/*.md`; `deleteWorkspaceFile` is opt-in via `tools: { delete: true }`.

Workspace operations emit canonical `workspace.operation` spans. The spans record workspace id, operation, path, namespace hash, result kind, size, and bounded output artifacts for listings/files without putting raw namespace values or full file contents in span attributes. Devtools workspace views read the backend resource projection for workspace activity.

Bundled stores include `inMemoryStorage()` for tests and `convexWorkspaceBlobStore()` from `@crux/convex` for Convex file storage. Implement `BlobStore` for S3, R2, GCS, local disk, or app-owned file services.

### Storage

Crux storage is split by capability. Use `DataStore` for JSON records, `VectorStore` for dense/sparse/hybrid search, and `BlobStore` for binary or oversized workspace payloads. A single adapter can implement more than one capability, but public APIs should name the capability they actually need.

```ts
interface DataStore {
  get(key: string): Promise<JsonObject | null>
  set(key: string, value: JsonObject, options?: SetOptions): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string, options?: ListOptions): Promise<ListResult>
  subscribe?(callback: (event: StoreEvent) => void): () => void
  supportsTtl?(): boolean
}

interface VectorStore {
  upsert(records: readonly VectorRecord[]): Promise<void>
  delete(keys: readonly string[]): Promise<void>
  search(query: VectorSearchQuery): Promise<readonly VectorHit[]>
}

interface BlobStore {
  put(input: BlobPutInput): Promise<BlobRef>
  get(uri: string): Promise<BlobReadResult>
  delete?(uri: string): Promise<void>
}

interface SetOptions {
  /** Time-to-live in ms. Entry auto-expires after this duration. */
  ttl?: number
}
```

`VectorStore.search()` is the generalized query capability for dense, sparse-only, and hybrid-capable stores:

```ts
const results = await vectors.search({
  dense: await dense.embed('roadmap'),
  sparse: await sparse.embed('roadmap'),
  fusion: 'dbsf',
  limit: 8,
})
```

**TTL support:** Pass `{ ttl }` to `DataStore.set()` for auto-expiring entries. Used by [context caching](#context-caching) to expire resolver results. Built-in data stores such as `inMemoryDataStore()`, `cruxConvexStore()`, and `cruxRedisStore()` support TTL. Check with `data.supportsTtl?.()`.

For production, implement `DataStore` with your database and pair it with a `VectorStore` or `BlobStore` only when the feature needs those capabilities. A Convex adapter is included:

```ts
import { cruxConvexStore } from '@crux/convex'
import { components } from './_generated/api'

const data = cruxConvexStore({ component: components.crux, ctx })

const state = workingState({ id: 'agent-state', schema: mySchema })
const agentMemory = memory({
  id: 'agent',
  store: data,
  namespace: 'thread:123',
  blocks: [state],
})
```

## Reactive Hooks (`@crux/react`)

Transport-agnostic React hooks for plans and task lists. Works with Convex, SSE, polling, or any custom transport.

### CruxProvider & CruxTransport

Wrap your app with `<CruxProvider>` to inject a transport. All domain hooks read from this transport.

```tsx
import { CruxProvider } from '@crux/react'
import { createConvexTransport } from '@crux/convex/react'
import { useQuery } from 'convex/react'
;<CruxProvider transport={createConvexTransport({ api: api.crux, useQuery })}>
  <App />
</CruxProvider>
```

The `CruxTransport` interface has two hook methods — `useDocument` and `useDocumentList` — that transports implement using their native reactive primitive. Return semantics: `undefined` = loading/skipped, `null` = not found, data = loaded.

### Domain Hooks

| Hook                   | Signature                                                              | Description                                                 |
| ---------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `usePlan(planId)`      | `(string \| undefined) => Plan \| undefined`                           | Subscribe to a plan by ID                                   |
| `useTaskList(filter)`  | `(string \| { planId: string } \| undefined) => TaskList \| undefined` | Subscribe to a task list by ID or by plan association       |
| `useTasks(taskListId)` | `(string \| undefined) => Task[] \| undefined`                         | Subscribe to tasks for a task list (excludes removed tasks) |

Pass `undefined` to any hook to skip the query (returns `undefined`).

```tsx
function PlanView({ planId }: { planId: string }) {
  const plan = usePlan(planId)
  const taskList = useTaskList({ planId })
  const tasks = useTasks(taskList?.id)

  if (!plan) return <Loading />
  return (
    <div>
      {plan.title} — {tasks?.length ?? 0} tasks
    </div>
  )
}
```

### Testing

Use `createMockTransport()` for testing without a backend:

```tsx
import { createMockTransport, CruxProvider } from '@crux/react'

const transport = createMockTransport()
transport.set('plan:abc', { id: 'abc', title: 'Test Plan', version: 1 })

const { result } = renderHook(() => usePlan('abc'), {
  wrapper: ({ children }) => <CruxProvider transport={transport}>{children}</CruxProvider>,
})
expect(result.current?.title).toBe('Test Plan')
```

The mock transport extends `CruxTransport` with `set()`, `delete()`, and `getData()` for test control.

### AI SDK Stream Transport

When using the Vercel AI SDK, `@crux/ai/stream` provides a transport that pipes plan/task updates through `UIMessageStream` data parts instead of polling.

```tsx
import { createStreamTransport } from '@crux/ai/stream'

const transport = createStreamTransport()
// Feed from useChat's onData callback:
// onData: (part) => transport.ingest(part)

<CruxProvider transport={transport}>
  <App />
</CruxProvider>
```

Server-side, use `createCruxStreamWriter(writer, store)` to subscribe to CruxStore changes and inject `data-crux` parts into the stream. See the `@crux/ai/stream` module docs for full setup.

### SSE Transport

For real-time push updates without Convex or the AI SDK, use `createSSETransport` to connect to an SSE endpoint.

```tsx
import { createSSETransport, CruxProvider } from '@crux/react'

const transport = createSSETransport('/api/crux/events', {
  reconnect: true,       // default
  reconnectDelayMs: 1000, // default
})

<CruxProvider transport={transport}>
  <App />
</CruxProvider>

// Cleanup:
useEffect(() => () => transport.close(), [])
```

The returned `SSETransport` adds `close()` and `readyState` (`'connecting' | 'open' | 'closed'`) to `CruxTransport`.

The server-side SSE endpoint is created with `cruxSSEHandler` from `@crux/react/server`:

```ts
// app/api/crux/events/route.ts
import { cruxSSEHandler } from '@crux/react/server'

export const GET = cruxSSEHandler({ store, prefix: 'plan:' })
```

Works with Next.js App Router or any `(Request) => Response` framework. The store must implement `subscribe()`.

### Polling Transport

Universal fallback that works with any `CruxStore` — no `subscribe()` required.

```tsx
import { createPollingTransport, CruxProvider } from '@crux/react'

const transport = createPollingTransport(store, { intervalMs: 2000 })

<CruxProvider transport={transport}>
  <App />
</CruxProvider>

// Cleanup:
useEffect(() => () => transport.stop(), [])
```

The returned `PollingTransport` adds `poll()` (manual trigger) and `stop()` to `CruxTransport`.

### Plans & Task Lists End-to-End

Combine `@crux/core/plan` and `@crux/core/tasks` with reactive hooks for real-time agent work tracking. See the [Plans & Task Lists guide](https://crux.karyla.com/docs/guides/plans-and-tasks) for detailed patterns.

Plan creation and updates emit `plan.operation` spans with a JSON artifact containing the plan id, title, version, content, preview, and metadata. The local devtools backend uses those artifacts to populate the Plans & Tasks read model even when the underlying `CruxStore` lives behind a runtime boundary such as Convex.

```ts title="server.ts"
import { createPlanTool, planAgent } from '@crux/core/plan'
import { tasklist, taskListAgent, taskWorker } from '@crux/core/tasks'

// Phase 1: LLM creates a plan via tool
const plannerPrompt = prompt({
  system: 'Create a detailed plan for the requested article.',
  tools: {
    createPlan: createPlanTool({
      template: '## Goal\n[objective]\n\n## Sections\n1. [section]',
    }),
  },
})

const { toolCalls } = await generate(plannerPrompt, {
  model: myModel,
  input: {},
})
const planId = toolCalls[0].result.id
const planAgent = planAgent(planId)

// Phase 2: Create task list linked to the plan
const handle = await tasklist({ planId })
await handle.addTask({
  id: 'research',
  label: 'Research sources',
  assignee: { model: 'gpt-4.1' },
})
await handle.addTask({
  id: 'write',
  label: 'Write draft',
  assignee: { model: 'claude-sonnet-4-5-20250514' },
})
await handle.addTask({ id: 'review', label: 'Review and polish' })

// Phase 3: Workers execute — each gets plan context + task assignment
const tasks = await handle.getTasks()
for (const task of tasks) {
  const worker = taskWorker(handle.id, task.id)
  const workerPrompt = prompt({
    use: [planAgent.asContext(), worker.asContext()],
    tools: worker.asTools(),
  })
  await generate(workerPrompt, { model: myModel, input: {} })
}

// Task list auto-completes when all workers succeed
// handle.getStatus() → 'completed'
```

```tsx title="client.tsx"
import { CruxProvider, usePlan, useTaskList, useTasks } from '@crux/react'

function AgentProgress({ planId }: { planId: string }) {
  const plan = usePlan(planId)
  const taskList = useTaskList({ planId })
  const tasks = useTasks(taskList?.id)

  if (!plan) return <div>Loading...</div>
  return (
    <div>
      <h2>
        {plan.title} (v{plan.version})
      </h2>
      <ul>
        {tasks?.map((t) => (
          <li key={t.id}>
            {t.label}: {t.status} {t.progress && `— ${t.progress}`}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

### Plan Metadata for Status Tracking

Plans have no built-in status. Status, approval, and lifecycle are application-level concerns modeled through `plan.metadata`. This keeps the crux `Plan` type simple and generic while giving applications full control.

```ts title="status-via-metadata.ts"
import { plan, updatePlan, getPlan } from '@crux/core/plan'

// Create a plan with application-specific status
const p = await plan({
  title: 'Rewrite Landing Page',
  content: '## Goal\n...',
  metadata: { status: 'draft', createdBy: 'agent' },
})

// Approve — metadata updates don't increment version
await updatePlan(p.id, {
  metadata: { ...p.metadata, status: 'approved', approvedBy: 'henri' },
})

// Check status before execution
const current = await getPlan(p.id)
if (current?.metadata?.status !== 'approved') {
  throw new Error('Plan not approved')
}

// Detect edits after approval — version increments on content changes
if (current.version > approvedVersion) {
  // Plan content was modified — re-extract or re-review
}
```

This pattern works with the Convex-native `flow()` handle from `@crux/convex/server` for human-in-the-loop approval gates:

```ts title="convex-approval-gate.ts"
import { flow } from '@crux/convex/server'
import { v } from 'convex/values'

const writerFlow = flow({
  name: 'writer',
  args: { instruction: v.string() },
  handler: async (flow, args, ctx) => {
    const planResult = await flow.step('plan', async () => {
      // Create plan with metadata.status = 'draft'
      return plan({
        title: 'Article Plan',
        content: '...',
        metadata: { status: 'draft' },
      })
    })
    // Suspend — frontend shows plan for approval
    await flow.suspend('plan-approval')
    // After resume, plan metadata.status is 'approved'
    return flow.step('write', () => executeWriting(ctx, planResult.id))
  },
})

export const writer = writerFlow.action
```

The frontend reads status reactively via `usePlan()` — `plan.metadata.status` updates appear in real-time through the Convex transport.

## Compaction

Long conversations exceed token limits. Compaction tools solve this at different levels:

| Primitive                   | Use When                                                      | Stateful? |
| --------------------------- | ------------------------------------------------------------- | --------- |
| **`summarizeMessages()`**   | You have a batch of messages and need a one-shot summary      | No        |
| **`createSlidingWindow()`** | You're building a chat and want automatic rolling compression | Yes       |
| **`createBudgetManager()`** | You need to track token pressure and decide when to compact   | No        |
| **`extractKeyFacts()`**     | You want to pull structured data out of a conversation        | No        |

Import from `@crux/core/compaction`:

```ts
import { summarizeMessages, createSlidingWindow, createBudgetManager, extractKeyFacts } from '@crux/core/compaction'
```

### `summarizeMessages()`

One-shot summarization of a message array. Use it when you have a batch of messages and need to compress them into a shorter form — for example, before storing in episodic memory or as context for a new agent.

```ts
const result = await summarizeMessages({
  messages: conversationHistory,
  generate: generateText, // any SDK-agnostic generate function
  model: myModel,
  maxTokens: 500,
  focus: ['decisions', 'action items'],
})

result.summary // string — the condensed summary
result.tokensBefore // original token count
result.tokensAfter // summary token count
result.ratio // compression ratio (e.g., 0.15 = 85% reduction)
```

`summarizeMessages()` also emits a canonical `compaction.run` span when observability is enabled. The span records before/after token counts, compression ratio, focus, model label, and a bounded summary preview artifact so devtools can inspect what was compacted without treating compaction as an opaque generation.

### `createSlidingWindow()`

The primary tool for managing conversation context in long-running chats. Keeps the most recent messages verbatim and automatically summarizes older messages when the window overflows. The running summary accumulates context from the entire conversation history.

```ts
const window = createSlidingWindow({
  windowSize: 20, // keep last 20 messages
  generate: generateText,
  model: myModel,
  summaryBudget: 1000, // max tokens for running summary
  store: myStore, // optional persistent store
})

// Add messages as they arrive
await window.push({ role: 'user', content: 'Hello!' })
await window.push({ role: 'assistant', content: 'Hi there!' })

// Get compacted message array (summary + recent messages)
const messages = await window.getMessages()

// Check stats
window.getStats()
// { totalMessages: 25, windowedMessages: 20, summaryTokens: 450, evictions: 1 }
```

### `createBudgetManager()`

Advisory token budget tracker. Reports pressure level but does not perform compaction — use it to decide when to trigger compaction.

```ts
const budget = createBudgetManager({
  limit: 128_000,
  warningThreshold: 0.8, // 80% = warning
  criticalThreshold: 0.95, // 95% = critical
})

budget.report('system', 2000)
budget.report('history', 45000)
budget.report('tools', 3000)

const state = budget.check()
state.used // 50000
state.available // 78000
state.pressure // 0.39
state.level // 'normal' | 'warning' | 'critical'
state.breakdown // { system: 2000, history: 45000, tools: 3000 }
```

### `extractKeyFacts()`

Pull structured data out of a conversation. Unlike summarization (which produces prose), extraction produces typed objects — decisions made, action items, open questions, or any shape you define with a Zod schema. Useful for feeding into downstream workflows or memory blocks such as `facts()`.

```ts
const facts = await extractKeyFacts({
  messages: conversation,
  generate: generateObject,
  model: myModel,
  schema: z.object({
    decisions: z.array(z.string()),
    actionItems: z.array(z.object({ task: z.string(), assignee: z.string() })),
    openQuestions: z.array(z.string()),
  }),
})
// facts is fully typed: { decisions: string[], actionItems: [...], openQuestions: string[] }
```

## Scoring

How do you know if your prompts are good? Automated assertions catch structured failures ("field X is missing"), but quality is subjective. LLM-as-a-judge uses a separate model to score outputs against custom criteria — like a code review, but for LLM responses.

Use scoring for:

- **Eval suites** — Score every test case on relevance, faithfulness, or custom criteria
- **Context impact** — Measure whether adding a context actually helps (`evaluateContext()`)
- **Compaction quality** — Verify summaries preserve essential information (`evaluateCompaction()`)
- **Runtime filtering** — Score outputs before showing them to users

Import from `@crux/core/scoring`:

```ts
import { llmJudge, metrics } from '@crux/core/scoring'
```

### `llmJudge()`

Creates a reusable judge instance. Define your criteria, scale, and optional rubric once — then call `.score()` on any input/output pair. The judge uses chain-of-thought reasoning by default (reasoning first, then score) for more calibrated results.

```ts
const judge = llmJudge({
  id: 'helpfulness',
  criteria: 'How helpful and actionable is the response?',
  scale: { min: 1, max: 5 },
  rubric: {
    1: 'Completely unhelpful or irrelevant',
    3: 'Adequate but missing key details',
    5: 'Comprehensive, actionable, and well-structured',
  },
  chainOfThought: true, // reasoning before scoring (default)
  fewShot: [
    // optional calibration examples
    { input: '...', output: '...', reasoning: '...', score: 4 },
  ],
  generate: generateObject, // default (overridable per call)
  model: judgeModel,
})

const result = await judge.score({
  input: 'How do I deploy to production?',
  output: responseText,
  reference: 'The ideal answer would cover...', // optional
})

result.score // number (clamped to scale)
result.reasoning // chain-of-thought explanation
result.metricId // 'helpfulness'
```

Every `judge.score()` call emits a canonical `scoring.judge` span. The span records the metric id, scale, model label, eval correlation id, clamping behavior, and a bounded `score.report` artifact with score and reasoning preview.

### Pre-Built Metrics

Six pre-configured judges for common quality dimensions:

```ts
const defaults = { generate: generateObject, model: judgeModel }

const relevanceJudge = metrics.relevance(defaults)
const faithfulnessJudge = metrics.faithfulness(defaults)
const coherenceJudge = metrics.coherence(defaults)
const completenessJudge = metrics.completeness(defaults)
const toxicityJudge = metrics.toxicity(defaults)
const concisenessJudge = metrics.conciseness(defaults)

// All return JudgeInstance with .score()
const result = await relevanceJudge.score({
  input: query,
  output: response,
})
```

Plan and task mutations emit canonical `plan.operation` and `task.operation` spans. Plan create/update spans include version and changed fields; task list/task spans include create, add, update, remove, and discard operations with task ids, status transitions, progress, duration, and bounded result/error previews. Those spans attach bounded output artifacts that power the backend `plan` and `task` resource projections.

### `judgeConstraint()`

Bridge a judge into a normal `Constraint` for online enforcement of scored quality. The same brand-voice or groundedness definition that scores eval datasets in CI can gate production output — one source of truth, no drift between the CI copy and the production copy.

```ts
import { llmJudge, judgeConstraint } from '@crux/core/scoring'

const brandVoice = llmJudge({
  id: 'brand-voice',
  criteria: 'Does the copy match the warm, direct brand voice?',
  scale: { min: 1, max: 10 },
})

const brandVoiceGate = judgeConstraint(brandVoice, {
  min: 7, // minimum acceptable score on the judge's own scale (inclusive)
  severity: 'assert', // standard constraint knobs pass straight through
  maxRetries: 2,
  generate: generateObject, // judge bindings for the production call
  model: judgeModel,
})

// → an ordinary Constraint: attach it per-call, per-prompt, or globally.
// The safety session, audits, retries, and observability work unchanged.
await adapter.generate(marketingPrompt, { constraints: [brandVoiceGate] })
```

On each check the judge scores the output text; `score >= min` passes. On failure the judge's chain-of-thought `reasoning` becomes the corrective feedback for the regeneration round (override with `feedback: (result) => string`). The audit entry carries the verdict in `metadata.judge` (`metricId`, `score`, `min`, `reasoning`).

The reverse bridge — running a production `Constraint` as an eval scorer — is `constraintScorer()` in `@crux/core/quality` (see below).

### Using Scores In Quality

Attach judges as Quality scorers so each experiment stores scores next to assertions, latency, usage, and cost.

```ts
import { quality, suite, target, type QualityScorer } from '@crux/core/quality'

const relevanceScorer: QualityScorer<{ question: string }, { text: string }> = {
  id: 'relevance',
  async score({ input, output }) {
    const result = await relevanceJudge.score({
      input: input.question,
      output: output.text,
    })

    return {
      kind: 'numeric',
      name: 'relevance',
      value: result.score,
      passed: result.score >= 4,
      threshold: 4,
      reasoning: result.reasoning,
    }
  },
}

await quality({ id: 'support' }).evaluate({
  suite: suite<{ question: string }>('support', (test) => {
    test('refund policy', { input: { question: 'How do refunds work?' } })
  }),
  target: target.prompt({
    prompt: supportPrompt,
    generate: (prompt, input) => generate(prompt, { model, input }),
  }),
  scorers: [relevanceScorer],
})
```

#### `constraintScorer()`

Run any production `Constraint` as a binary Quality scorer — pass yields `passed: true`, fail yields `passed: false` with the constraint's feedback as the score's `reasoning`. Every constraint you enforce online is automatically regression-testable offline, so a policy change shows up as an eval diff before it ships.

```ts
import { quality, suite, target, constraintScorer } from '@crux/core/quality'
import { brandVoiceGate } from './safety-policies' // any Constraint — hand-written or judgeConstraint()

await quality({ id: 'marketing' }).evaluate({
  suite: marketingCopy,
  target: copywriter,
  scorers: [constraintScorer(brandVoiceGate)],
})
// → each case gets a boolean score named after the constraint;
//   a failing case fails the experiment
```

String case outputs reach `check()` as `text`; non-string outputs are passed as `parsed` with a stable JSON rendering as `text`. The `ConstraintContext` carries `{ caseId, variantId, caseInput }` in `metadata`. Together with `judgeConstraint()` this closes the loop: one predicate definition drives both CI evals and production enforcement.

## Agent Coordination

Crux provides two levels of multi-agent support: **composition utilities** for common patterns, and **building-block primitives** for custom coordination.

### Composition Utilities

High-level patterns that replace 10–20 lines of boilerplate with a single function call. Each adapter (`@crux/ai`, `@crux/openai`, `@crux/anthropic`, `@crux/google`) re-exports pre-bound versions.

#### `agent()`

Bundle a prompt with optional model, tools, and handoff targets into a reusable agent instance:

```ts
import { agent } from '@crux/core/agent'

const reviewer = agent({
  id: 'content-reviewer',
  prompt: reviewPrompt,
  model: gpt4mini, // optional: overrides composition-level model
  tools: [searchTool], // optional: agent-specific tools
  handoffs: ['editor'], // optional: agents this agent can route to in a swarm
  swarmTools: ['search'], // optional: tool whitelist for swarm context
})
```

Agents are frozen data objects — no execution logic. Execution happens via the adapter's `AgentExecutor`. The `handoffs` field declares peer routing targets for `swarm()` (validated at runtime, not at definition time). Composition utilities also accept plain async functions as an escape hatch.

#### `parallel()`

Run multiple agents concurrently and collect named results:

```ts
import { parallel } from '@crux/ai'

const { results, durationMs } = await parallel({
  context: { content: articleDraft },
  agents: {
    factCheck: factCheckerAgent,
    style: styleReviewerAgent,
    seo: seoAnalyzerAgent,
  },
  model: claude35,
})

results.factCheck.output // typed as factCheckerAgent's output
results.style.output // typed as styleReviewerAgent's output
results.seo.output // typed as seoAnalyzerAgent's output
```

Results are returned as a named record typed via `InferAgentOutput` — no `merge` callback needed. Compose downstream however you like.

**Error handling:** Fail-fast by default (`Promise.all`). Use `onError: 'continue'` for best-effort — returns `result.settled` with per-agent status (`{ status: 'success', value } | { status: 'error', error }`).

#### `pipeline()`

Chain agents (and plain functions) sequentially with accumulated, typed context:

```ts
import { pipeline } from '@crux/ai'

const result = await pipeline({
  context: { userId, projectId },
  model: claude35,
  steps: [
    { name: 'research', agent: researcher },
    {
      name: 'write',
      agent: writer,
      input: (ctx) => ({ findings: ctx.research.synthesis }),
    },
    { name: 'format', fn: async (ctx) => ({ html: render(ctx.write.draft) }) },
  ],
})

result.context.research // typed as researcher's output
result.context.write // typed as writer's output
result.context.format // typed as { html: string }
result.finalOutput // last step's output
result.durationMs // total duration
```

Each step's output is auto-stored under its `name` in the accumulated context object. The `input` callback receives the full context (all previous steps plus the seed), not just the previous step. Steps can be agent steps (`{ name, agent, input? }`) or plain function steps (`{ name, fn }`). TypeScript infers the context shape at each step position.

Steps support per-step retry with backoff:

```ts
{
  name: 'write',
  agent: writer,
  input: (ctx) => ({ findings: ctx.research.synthesis }),
  retry: { attempts: 3, backoff: 'exponential' },
}
```

Execution retry is for transient failures. Crux policy-terminal errors (`GuardrailBlockedError`, `ConstraintViolationError`, and `ValidationExhaustedError`) are not retried by default and do not run execution fallback, so safety, validation, and constraint decisions cannot be bypassed by a generic fallback. Advanced callers can override retry eligibility with `shouldRetry`.

#### `consensus()`

Multiple agents vote on a decision:

```ts
import { consensus } from '@crux/ai'

const decision = await consensus({
  agents: [classifier, classifier, classifier],
  input: { ticket: supportTicket },
  extract: (result) => result.output.category,
  quorum: 'majority', // 'majority' | 'unanimous' | number
})
decision.result // 'billing'
decision.votes // { billing: 2, shipping: 1 }
decision.agreement // 0.67
```

Built on `parallel()` internally. Throws `ConsensusError` (with `.votes` and `.quorum`) when quorum is not met.

#### `swarm()`

Peer-to-peer agent routing where the LLM decides which agent handles the next turn:

```ts
import { swarm, agent } from '@crux/ai'

const triage = agent({
  id: 'triage',
  description: 'Routes support tickets',
  prompt: triagePrompt,
  handoffs: ['billing', 'shipping'],
})

const billing = agent({
  id: 'billing',
  description: 'Handles billing issues',
  prompt: billingPrompt,
  handoffs: ['triage', 'refunds'],
})

const refunds = agent({
  id: 'refunds',
  description: 'Processes refunds',
  prompt: refundsPrompt,
  handoffs: ['billing', 'triage'],
})

const result = await swarm({
  agents: { triage, billing, refunds },
  startAgent: 'triage',
  input: { message: 'I was charged twice' },
  model: claude35,
  maxHandoffs: 10, // safety limit (default: 10)
  maxSteps: 5, // tool steps per agent turn (default: 5)
  history: 'transfer-only', // or 'accumulate' or custom function
  onHandoff: ({ fromAgent, toAgent, reason }) => {
    console.log(`${fromAgent} → ${toAgent}: ${reason}`)
  },
})
result.output // final agent's response
result.finalAgentId // 'billing'
result.handoffPath // ['triage', 'billing']
result.handoffCount // 1
```

**How it works:** For each agent's declared `handoffs`, Crux injects `transfer_to_<id>` tools. The LLM decides when to hand off by calling these tools. The loop continues until an agent completes without handing off or `maxHandoffs` is reached (throws `SwarmError` with the full handoff path).

**Conditional handoffs** — guide the LLM's routing with `when` conditions:

```ts
const triage = agent({
  id: 'triage',
  prompt: triagePrompt,
  handoffs: [
    'general',
    { id: 'billing', when: 'Customer has a billing or payment issue' },
    { id: 'refunds', when: 'Customer explicitly requests a refund' },
  ],
})
```

The `when` string is appended to the transfer tool's description — prompt-level guidance, not a hard gate.

**Tool filtering** — prevent cross-domain tool pollution:

```ts
const billing = agent({
  id: 'billing',
  prompt: billingPrompt,
  tools: { lookupInvoice, processPayment, trackShipment },
  swarmTools: ['lookupInvoice', 'processPayment'], // only these in swarm
})

// Or override at the swarm level:
await swarm({
  activeTools: { billing: ['lookupInvoice'] },
  // ...
})
```

Transfer tools (`transfer_to_*`) are always included regardless of filtering.

**Cost tracking and abort:**

```ts
await swarm({
  onCost: ({ totalTokens, abort }) => {
    if (totalTokens > 10000) abort()
  },
  // dryRun: true — returns { agentCount, maxPossibleHops } without calling LLMs
})
```

**History modes:**

- `'transfer-only'` (default) — next agent gets the original input plus handoff context (reason + context string)
- `'accumulate'` — next agent gets the original input plus previous agent's output and handoff path
- Custom function — receives full `SwarmHandoffContext`, returns the input for the next agent

**Context summarization** — prevent token bloat in `'accumulate'` mode:

```ts
await swarm({
  history: 'accumulate',
  summarize: {
    generate: generateTextFn,
    model: gpt4mini,
    after: 3, // start summarizing after 3 handoffs
  },
})
```

**Session tracking** — group related swarm runs:

```ts
await swarm({ sessionId: 'customer-session-123' /* ... */ })
```

All compositions (`parallel`, `pipeline`, `consensus`, `swarm`) support `sessionId` and open canonical observability spans for each agent execution. Nested compositions inherit observability context automatically. Compositions become `composition.*` spans, executable pipeline steps become `flow.step`, agent executions become `agent.run`, and swarm/delegate handoffs create `handoff.prepare` spans plus input/output artifacts and `handoff.payload` relation artifacts.

**When to use which:**

| Pattern       | Use When                                   | Example                                     |
| ------------- | ------------------------------------------ | ------------------------------------------- |
| `parallel()`  | Independent tasks, collect named results   | Multiple reviewers score content            |
| `pipeline()`  | Sequential stages with accumulated context | Research → Write → Format                   |
| `consensus()` | Need reliable classification/decision      | 3 classifiers vote on ticket category       |
| `swarm()`     | Dynamic routing, LLM decides next agent    | Customer support triage → billing → refunds |

### Building-Block Primitives

Low-level primitives for custom agent coordination:

| Primitive      | Pattern          | Use When                                                                |
| -------------- | ---------------- | ----------------------------------------------------------------------- |
| **Blackboard** | Shared state     | Multiple agents read/write the same data (research board, task tracker) |
| **Handoff**    | One-way transfer | One agent's output becomes another's input (researcher → writer)        |
| **Delegate**   | Tool + handoff   | Expose a subagent as a tool with automatic validation and transform     |

Import from `@crux/core/agent`:

```ts
import { blackboard, handoff, delegate } from '@crux/core/agent'
```

### `blackboard()`

Shared typed scratchpad for multi-agent coordination. When a research agent finds something, it writes to the board; the writer agent reads it. Per-field Zod validation ensures each write is valid without requiring the full board state.

```ts
const board = blackboard({
  id: 'research-board',
  schema: z.object({
    query: z.string(),
    findings: z.array(z.string()),
    status: z.enum(['planning', 'researching', 'done']),
  }),
  store: sharedStore, // agents share the same store
})

// Write individual fields (validated per-field)
await board.set('status', 'researching')
await board.patch({ findings: ['Finding 1'], status: 'researching' })

// Read
const status = await board.get('status') // 'researching'
const all = await board.getAll() // full board state

// Subscribe to changes (in-process)
const unsubscribe = board.subscribe((fields) => {
  console.log('Changed:', fields) // ['findings', 'status']
})
```

**Prompt injection** works directly through `use`. When a prompt uses the board
it gets the current board state as context and the focused tools automatically:

```ts
const agentPrompt = prompt({
  use: [board], // context + readBlackboard/writeBlackboard/patchBlackboard/clearBlackboard
})
```

If you only want context, pass `board.asContext()`. If you only want tools, pass
`board.asTools()` manually:

```ts
prompt({ use: [board.asContext()] }) // context only

const { readBlackboard, writeBlackboard, patchBlackboard, clearBlackboard } = board.asTools()
// Each is a standalone tool — no action dispatching needed
```

**Multiple boards** need distinct tool names. Add a prefix when more than one
board is auto-injected into the same prompt:

```ts
const research = blackboard({ id: 'research', schema, tools: { prefix: 'research' } })
const writing = blackboard({ id: 'writing', schema, tools: { prefix: 'writing' } })

prompt({ use: [research, writing] })
// readResearchBlackboard, writeResearchBlackboard, readWritingBlackboard, ...
```

**Custom tool guidance** — like memory primitives, blackboard supports `tool.description` in the config. The guidance is appended to focused `.asTools()` descriptions:

```ts
const board = blackboard({
  id: 'coordination',
  schema: boardSchema,
  tool: {
    description: `Read or update shared state. Use "patch" to record constraints
the user mentions. Other agents write research findings and plans here.`,
  },
})
```

### `handoff()`

Structured context transfer between agents. When agent A finishes its work and agent B needs to continue, the handoff validates what A produced, transforms it into what B expects, and optionally compresses it with an LLM to fit B's token budget.

**Stateless mode** — for in-process handoffs:

```ts
const researchHandoff = handoff({
  id: 'research-to-writer',
  inputSchema: z.object({
    query: z.string(),
    findings: z.array(z.string()),
    sources: z.array(z.object({ url: z.string(), title: z.string() })),
  }),
  outputSchema: z.object({
    topic: z.string(),
    keyPoints: z.array(z.string()),
  }),
  transform: (input) => ({
    topic: input.query,
    keyPoints: input.findings,
  }),
  summarize: {
    // optional LLM summarization
    generate: generateText,
    model: summaryModel,
    system: 'Summarize the research findings concisely.',
  },
})

// Prepare the handoff payload
const payload = await handoff.prepare(researchOutput)
payload.data // typed: { topic: string, keyPoints: string[] }
payload.summary // string (if summarize was configured)

// Inject into the receiving agent's prompt
const writerPrompt = prompt({
  use: [handoff.asContext(payload)], // priority 80
})
```

**Stored mode** — for distributed agents that run in separate processes or actions (e.g., Convex actions, serverless functions):

```ts
import { cruxConvexStore } from '@crux/convex'

const researchHandoff = handoff({
  id: `research:${threadId}`,
  inputSchema: ResearchResultSchema,
  outputSchema: WriterContextSchema,
  transform: (input) => ({ topic: input.query, keyPoints: input.findings }),
  store: cruxConvexStore({ component: components.crux, ctx }),
  fromAgent: 'research',
  toAgent: 'writer',
})

// Producer (in research action):
await handoff.send(rawResults) // validate + transform + persist

// Consumer (in writer action, separate process):
const payload = await handoff.receive() // read from store, returns null if not sent yet
if (payload) {
  payload.data // typed: WriterContextSchema
}
```

`send()` calls `prepare()` internally then persists to the store. `receive()` reads and deserializes. Both throw if `store` is not configured. The stateless `prepare()` and `asContext()` continue to work without a store.

### `delegate()`

Orchestration wrapper combining handoff + subagent execution. When the main agent calls a delegate tool, it runs the subagent, validates the result through the handoff contract, and returns the transformed data. Three-layer validation: `argsSchema` (tool input) → `handoff.inputSchema` (subagent output) → `handoff.outputSchema` (transformed data).

The `TCtx` type parameter provides type-safe context threading for framework-specific data (action context, user IDs, project IDs, etc.):

```ts
import { delegate } from '@crux/core/agent'

// Define context type for your framework
type DelegateCtx = {
  actionCtx: ActionCtx
  projectId: string
  userId?: string
}

const researchDelegation = delegate({
  id: 'delegate-research',
  argsSchema: z.object({ query: z.string() }),
  handoff: researchToWriter,
  execute: async (args, ctx: DelegateCtx) => {
    // ctx is fully typed — access framework-specific context
    return await ctx.actionCtx.runAction(runResearch, {
      projectId: ctx.projectId,
      query: args.query,
    })
  },
})

// Execute programmatically (ctx is required and typed)
const result = await researchDelegation.run({ query: 'AI safety trends' }, { actionCtx: ctx, projectId, userId })
result.data // typed: handoff output schema
result.summary // string (if handoff has summarize configured)
result.durationMs
```

**Using with framework-specific tool factories** — when `.asTools()` doesn't match your framework's tool format, use `.run()` directly:

```ts
// For @convex-dev/agent or any framework with custom tool shapes:
const research = createTool({
  description: 'Delegate research to a specialist',
  inputSchema: researchDelegation.argsSchema,
  execute: async (toolCtx, args, options) => {
    const result = await researchDelegation.run(args, {
      actionCtx: ctx,
      projectId,
      userId,
    })
    return result.data
  },
})
```

For simple cases without framework context, `.asTools()` works as a convenience:

```ts
const { delegate: research } = researchDelegation.asTools({
  description: 'Delegate research to a specialized agent',
})
```

## Skills

Skills are Markdown-based instruction sets that an LLM can load on-demand. They are compatible with the [skills.sh](https://skills.sh) community format (SKILL.md with YAML frontmatter).

Skills sit in a prompt's `use` array alongside regular contexts. When skills are present, the resolution pipeline automatically:

1. Generates a **skill index** in the system prompt (name + description for each skill)
2. Injects **LoadSkill** and **LoadReference** tools
3. The LLM decides which skills to load based on the task
4. Loaded skills are injected at the **system prompt level** via executor re-resolution

Skill loading emits canonical `skill.load` spans. File and registry skills record loader, source id or registry identifier, parsed skill id, cache source, instruction size, references, tags, version, and bounded output artifacts.

```ts
import { skill } from '@crux/core/skill'
import { prompt, agent } from '@crux/core'

const seo = skill.fromFile('./skills/seo-analysis/SKILL.md')
const tone = skill.inline({
  id: 'tone',
  description: 'Writing tone guidelines',
  instructions: 'Always write in a warm professional tone.',
})

const reviewerAgent = agent({
  prompt: prompt({
    use: [seo, tone, otherContext],
  }),
})
```

### `skill.inline(config)`

Create a skill from inline text. Requires `id`, `description`, and `instructions`.

```ts
const tone = skill.inline({
  id: 'tone',
  description: 'Writing voice and tone guidelines',
  instructions: 'Always write in a warm professional tone. Avoid jargon.',
  references: {
    // optional
    examples: 'Good: ... Bad: ...',
  },
})
```

### `skill.fromFile(path)`

Load a SKILL.md file. Reads synchronously at import time. Parses YAML frontmatter for metadata. Automatically discovers reference files in a sibling `references/` directory.

```ts
const seo = skill.fromFile('./skills/seo-analysis/SKILL.md')

seo.id // 'seo-analysis' (from frontmatter name)
seo.description // 'Analyze and optimize content...' (from frontmatter)
seo.meta.version // '1.0.0'
seo.references // [{ name: 'keywords', content: '...' }, ...]
```

**SKILL.md format** (skills.sh standard):

```yaml
---
name: seo-analysis
description: Analyze and optimize content for search engines
version: 1.0.0
license: Apache-2.0
tags: seo, content, optimization
---
# SEO Analysis

Instructions here...
```

### `skill.fromRegistry(identifier)`

Load a skill from a registry. Content is fetched lazily on first `prompt.resolve()`, then cached in-memory with TTL.

```ts
// From skills.sh (built-in registry)
const research = skill.fromRegistry('skills.sh:mattpocock/skills/seo-analysis')

// From a custom registry
const brand = skill.fromRegistry('acme:brand-guidelines')
```

### `.dump()`

Extract the raw instruction text from any skill. Exits the skill system — no LoadSkill/LoadReference tools, no index. Use this when you want the text outside the skill system.

```ts
const rawText = seo.dump() // Returns instruction body (no frontmatter)
```

### Custom Registries

Define custom registries using the `.well-known/agent-skills/` protocol:

```ts
import { skill, registry } from '@crux/core/skill'
import { config } from '@crux/core'

const acme = registry({
  name: 'acme',
  baseUrl: 'https://skills.acme.corp',
  auth: () => process.env.SKILLS_TOKEN,
})

config({
  prompts,
  registries: { acme },
})

// Now use with prefix
const brand = skill.fromRegistry('acme:brand-guidelines')
```

### Agent Framework Integration

When using Crux adapters directly (`@crux/anthropic`, `@crux/openai`, `@crux/google`, `@crux/ai`), skills work automatically — just add them to `use`. For external agent frameworks that manage their own tool loop (Convex Agent, Mastra, etc.), use `createAgentSkillKit()`:

```ts
import { createAgentSkillKit } from '@crux/core/skill'
import { cruxConvexStore } from '@crux/convex' // or any key-value store

// Helper: persist skill IDs per thread using CruxStore (or any DB/Redis/etc.)
function skillStore(threadId: string, store: CruxStore) {
  const key = `skills:${threadId}`
  return {
    async get() {
      const data = await store.get(key)
      return Array.isArray(data?.ids) ? (data.ids as string[]) : []
    },
    async add(id: string) {
      const ids = await this.get()
      if (!ids.includes(id)) await store.set(key, { ids: [...ids, id] })
    },
  }
}

// In your agent factory (called per conversation):
async function createMyAgent(ctx, threadId, model) {
  const store = cruxConvexStore({ component: components.crux, ctx })
  const skills = skillStore(threadId, store)

  // Create the kit — provide persist/retrieve callbacks.
  const skillKit = await createAgentSkillKit(myPrompt, {
    onActivate: (id) => skills.add(id), // LLM loaded a skill — persist it
    loadActiveIds: () => skills.get(), // start of each turn — retrieve
  })

  // Merge skill tools with your agent's tools
  const tools = { ...myBusinessTools, ...skillKit.tools }

  // In your context handler, enhance the resolve input
  const contextHandler = async (handlerCtx, args) => {
    const data = await fetchContextData(handlerCtx, args)
    const resolved = await myPrompt.resolve({
      input: await skillKit.resolveInput(data),
    })
    return [{ role: 'system', content: resolved.system }, ...args.allMessages]
  }

  return new Agent({ model, tools, contextHandler })
}
```

See the [Skills Guide](https://crux.karyla.com/docs/guides/skills#agent-framework-integration) for a complete, self-contained Convex Agent example.

## Plugins

Crux has a generic plugin system for extending the runtime with custom instrumentation, telemetry, or any cross-cutting concern. Plugins are installed via `config({ plugins: [...] })` and compose automatically — multiple plugins can coexist without interfering with each other.

```ts
import { config } from '@crux/core'
import { withDevtools } from '@crux/core/observability'
import { withTelemetry } from '@crux/otel'

config({
  prompts,
  plugins: [withDevtools({ serverUrl: process.env.DEVTOOLS_URL }), withTelemetry({ serviceName: 'my-app' })],
})
```

Plugins are processed in order. Each plugin's `install()` receives the cumulative runtime from all prior plugins. Hooks are composed using fan-out semantics (all handlers called for every event), and middleware is layered (new wraps old).

### `withCostTracking()`

`withCostTracking()` attributes model spend to prompts, models, sessions, flows, and steps. Provider-reported cost wins when an adapter exposes it in `_meta.cost` (for example OpenRouter). If the provider only returns token usage, Crux estimates cost from `modelPricing()`.

```ts
import { config } from '@crux/core'
import { modelPricing, withCostTracking } from '@crux/core/cost'

const costs = withCostTracking({
  pricing: modelPricing({
    'gpt-4o': { input: 2.5, output: 10 },
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
  }),
  budget: {
    warn: 1,
    limit: 5,
  },
})

config({
  prompts,
  plugins: [costs.asPlugin()],
})

console.log(costs.getReport().byModel)
```

Budgets are hard limits: `warn` emits `cost:warn`; `limit` emits `cost:limit` and throws `CostLimitError` after recording the call. Devtools, `crux cost`, `crux dev --tui`, the web dashboard, and `@crux/otel` consume the same cost events.

Cost tracking also emits canonical `cost.record` spans. Each span records the call attribution, tokens, cost, running totals, and `cost.warn` / `cost.limit` events when thresholds are crossed. `createBudgetManager().check()` emits `prompt.budget` spans with source breakdown and pressure level, so token-pressure decisions are inspectable even when no compaction happens yet. Conversation summarizers emit `compaction.report` artifacts with before/after tokens, compression ratio, and bounded summary previews.

### `withDevtools()`

The built-in devtools plugin. When `devtools.serverUrl` is set in `config()`, this is auto-prepended to the plugins array. You can also install it explicitly via the `plugins` field.
Plugin installation is synchronous. It installs the canonical observability transport for `/api/observability/records` and sends runtime prompt/context/tool metadata through `/api/index/snapshot` as Project Index enrichment. The Go backend remains the owner of the index read model exposed through `/api/project/index` and `/api/index`.

`withDevtools()` does not run bridge command execution itself. The Runtime Bridge is configured through `config({ devtools: { bridge } })` and uses `@crux/core/runtime-bridge` for the shared message contract.

```ts
import { withDevtools } from '@crux/core/observability'

config({
  prompts,
  plugins: [withDevtools({ prompts: [...], serverUrl: '...' })],
})
```

### `withTelemetry()` (`@crux/otel`)

OpenTelemetry integration for production observability. See [`@crux/otel` README](../crux-otel/README.md) for full documentation.

Supports two export paths:

```ts
// Standard OTel — spans flow through the globally registered TracerProvider
withTelemetry({ serviceName: 'my-app' })

// Lightweight — for ephemeral runtimes (Lambda, Convex, Cloudflare)
withTelemetry({
  serviceName: 'my-app',
  exporter: { url: 'https://collector.example.com/v1/traces' },
})

// Callback — for custom handling
withTelemetry({
  serviceName: 'my-app',
  exporter: (spans) => myLogger.send(spans),
})
```

Spans created for every instrumented event:

| Event                     | Span Name                       | Key Attributes                                                         |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `generate()` / `stream()` | `crux.generate`                 | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `crux.cost` |
| Tool execution            | `crux.tool.{name}`              | `crux.tool.name`, `crux.tool.call_id`                                  |
| `flow().run()`            | `crux.flow`                     | `crux.flow.id`, `crux.flow.name`                                       |
| `flow.step()`             | `crux.flow.step`                | `crux.step.id`, `crux.step.label`                                      |
| `flow.suspend()`          | Event on `crux.flow` + span end | `crux.flow.suspend_point`                                              |
| Resume                    | `crux.flow.resume`              | `crux.flow.id`, `crux.flow.name`                                       |
| Compositions              | `crux.composition.{kind}`       | `crux.composition.kind`, `crux.composition.agent_count`                |
| Memory ops                | `crux.memory.{read\|write}`     | `crux.memory.type`, `crux.memory.operation`                            |
| Compaction                | `crux.compact`                  | `crux.compaction.ratio`                                                |
| Judge scores              | `crux.judge`                    | `crux.judge.metric`, `crux.judge.score`                                |
| Delegation                | `crux.delegate`                 | `crux.delegate.id`                                                     |

### Writing Custom Plugins

Implement the `CruxPlugin` interface to create your own plugins:

```ts
import type { CruxPlugin } from '@crux/core'

const myPlugin: CruxPlugin = {
  name: 'my-tracer',
  install(runtime) {
    // runtime contains the cumulative state from prior plugins
    return {
      instrumentationHooks: {
        onToolStart: (e) => console.log(`tool: ${e.toolName}`),
      },
      dispose: () => console.log('cleanup'),
    }
  },
}

config({
  prompts,
  plugins: [myPlugin],
})
```

The `install()` method receives a frozen snapshot of the current runtime and returns a partial `CruxPluginResult`. The framework automatically composes your hooks with existing ones using fan-out (all handlers called). You don't need to manually call previous hooks — `mergeRuntime()` handles composition.

## Devtools

The devtools integration traces every generation call and displays prompts, contexts, traces, evals, quality experiments, memory events, retrieval events, tool calls, artifacts, and semantic relations in a visual UI.

`crux dev` also builds the Project Index at server startup. The index is the design-plane read model for what exists in the project: prompts, contexts, tools, agents, flows, flow steps, compositions, RAG resources, memory, memory blocks, blackboards, workspaces, safety definitions, scorers, suites, evals, source locations, supporting source references, snippets, diagnostics, and relations. Source files and `.crux/quality` JSON are authoritative; runtime snapshots only enrich discovered definitions. The Quality workbench merges that authored index plane with local `.crux/quality` state, so code suites and committed `*.cassette.json` fixtures can appear in suite/cassette/overview screens before the first run. The shared TypeScript contract lives in `@crux/core/project-index`, and serializers for runtime snapshots live in `@crux/core/project-index/serializers`.

Index indexing is designed as fast source truth plus background enrichment. The fast AST pass publishes a useful index first; bounded TypeScript semantic analysis then enriches proven aliases, barrels, imported symbols, schema refs, callbacks, primitive graph relations, and data-access edges without blocking the first snapshot. Static discovery now enters through the Crux Indexer's fact-backed Project Index compiler seam before projecting to the index read model, so first-party extractors and incremental AST partial indexing share the same extension boundary. The Go devtools backend owns the final read-model state, realtime publication, and explicit `indexing` status so web devtools and the TUI do not infer index readiness from missing fields. Semantic fact snapshots are cached under `.crux/cache/index/semantic-facts-*` using source, import-dependency, tsconfig, compiler-option, and TypeScript-version fingerprints. Static parse facts and Go-owned index snapshots are also versioned under `.crux/cache/index`. When indexer or local-runtime code changes index output for unchanged user source, bump the matching static, semantic, or Go snapshot cache version so rebuild/restart/reindex produces the new read model without manual cache deletion. The cache currently refreshes complete semantic fact sets; true partial semantic reuse remains gated until dependency ownership is materialized.

The index indexer runs user modules in safe index mode with `CRUX_INDEX=1`. In this mode `config()` disables devtools transports and runtime observability side effects, and eval `setup()` is not called. `crux dev` bounds the embedded Node indexer and turns actionable import failures or true fallback-only static discovery into index diagnostics instead of blocking the server. Static source discovery first classifies candidate files with content signals: ordinary authored source with Crux primitives is indexed, generated bundles/base64 artifacts are skipped before AST parsing, and oversized authored-looking files emit `index.source_too_large` diagnostics instead of silently disappearing. Static discovery scans ordinary source files under the ignored-directory guard and can surface best-effort definitions and relations for common primitives such as `agent()`, `new Agent(...)` from `@crux/convex/agent`, `convexAgent({...})`/`crux.convexAgent({...})`, `flow()`/`flow.step()`, Convex `flow({ name, args, handler })`, compositions, `retriever()`, `retrievalPipeline()`, `memory()`, `blackboard()`, `workspace()`, `constraint()`, `guardrail()`, and `llmJudge()`. It inspects exported declarations and factory-local primitive call sites, so Convex/serverless factories that construct agents, flows, memory, blackboards, or workspaces can still appear in the index without emitting a warning merely because the module is not import-safe. When rich import fails but static source discovery recovered definitions for that file, the index keeps the definitions and suppresses the import warning. For memory and blackboard definitions, static source discovery also projects literal store bindings and Zod schemas where they are authored directly or through local identifiers, including first-class `memory.store` definitions for backing stores and first-class `memory.block` definitions for visible `workingState()`, `episodes()`, `facts()`, `procedures()`, and `reflections()` blocks nested in `memory({ blocks })`. Tools can resolve `parameters` schemas through same-file variables or direct project imports, attach `schema` source refs, and attach nested schema refs for referenced schema identifiers. Prompt `use` arrays can resolve imported contexts and local context-array constants, so static-only fallback still emits `prompt.uses_context` edges for shared context lists. Prompt/context `system` constants, direct identifiers injected into static system template strings, and simple object-property paths such as `${formatting.SUPPORTED_ELEMENTS}` attach `system` source refs with fragment metadata. Convex Agent `prompt`, `tools`, `contextHandler`, `usageHandler`, and `prepare` bindings attach `config`/`callback` source refs; visible tool-map spreads/properties and handler/prepare-factory identifier arguments attach additional supporting refs. Agent, prompt, context, safety, scorer, tool, and flow-step callbacks passed by identifier attach role-specific source refs. Agent, prompt, context, tool, Convex Agent callback bindings, and flow-step callbacks are scanned through one statically visible helper level for memory/blackboard/workspace access and supporting source locations, so helper-owned writes can still contribute `metadata.intelligence.data` and normalized graph relations such as `tool.writes_blackboard`, `prompt.reads_memory`, `context.reads_blackboard`, and `flow.step.reads_workspace`. The static resolver supports relative imports plus conservative `tsconfig` `baseUrl`/`paths` aliases; source refs contribute source dependency/dependent file edges. The bounded semantic pass handles proven compiler-resolved aliases, barrels, imported schemas, callbacks, source refs, and access facts; full language-service-grade partial incremental reuse remains future work.

Index definitions may include `metadata.indexPresentation` for first-class supporting records that should be folded under authored parents in index navigation, such as `flow.step`, routing routes/tiers/options, composition branches/stages, RAG stages, memory blocks, and memory stores. These child records remain searchable, inspectable, lintable, and relation targets; the hint only prevents clients from treating them as standalone top-level authored things. Index definitions may also include a derived `quality` summary from the Go service. That field links definitions to eval/suite/experiment/baseline/comparison/feedback/run IDs, cassette paths, trace IDs, run counts, case counts, last status/time, pass rate, and changed-since-baseline fingerprint signals and affected eval/suite suggestions when prompt, RAG, flow eval, experiment, baseline, comparison, cassette, or feedback records are known. It is a read-model join for web devtools and the TUI, not source/indexer-owned index data. Index snapshots also expose `lintFindings`, which are not indexer diagnostics: diagnostics explain index health/fidelity, while lint findings are graph-level design suggestions derived from the index read model. Lint findings include rule category, maturity, confidence, default profile membership, concrete messages, per-rule rationale for "why it matters", optional impact, structured evidence, fix options, rule docs URLs, exact suppression-comment affordances, direct related definitions, affected definitions, and backend-computed propagation metadata for definitions affected through approved dependency relations. Current high-trust rules cover eval coverage, quality targets with experiment history but no promoted baseline, prompt/context/tool/flow contract schemas, strict-mode prompt output schemas, strict-mode tool model-output adapters, agent handoffs to non-visible targets, suspending flows without coverage, writable workspaces without guardrails, state resources written without visible read paths, long-lived memory without visible retention policies, consensus compositions without visible judges or scorers, and shared blackboards without conflict policies. Source suppressions are rule-specific comments such as `// crux-lint-disable-next-line tool.missing_input_schema -- generated adapter`; unknown or unused suppressions become index diagnostics.

`metadata.runtimeJoin` is an authored-to-runtime hint for backend read models. It is typed as `ProjectRuntimeJoin` from `@crux/core/project-index` and must not confuse stable authored ids with runtime execution ids: flow definitions join generated `flow.run` spans by primitive and span name, while `flowId` is only an execution correlation id; flow-step definitions join `flow.step` spans by primitive plus `stepLabel`/span name, while `stepId` is only execution correlation. Memory blocks join memory spans through `sourceDefinitionId`, `blockDefinitionId`, runtime `memoryId`, and `blockId`. Blackboards are represented by memory-shaped spans with `memoryType: "blackboard"` rather than a separate `blackboardId` span attribute.

The TypeScript indexer is the only place that imports user `crux.config.ts`. It serializes the project lint policy onto the index as `lint`, and Go read-model enrichers consume that serialized policy when they append runtime/quality-backed findings. This keeps source intelligence in the Node worker, read-model joins in Go services, and still gives TS-produced and Go-produced findings the same profile, rule override, and source-suppression behavior before clients see them.

`config({ indexer })` stores inert Project Indexer tooling configuration alongside the rest of the
Crux config. Today that includes extension references, extension trust policy, and rule option data
for `@crux/indexer` to validate. Core does not import, load, or execute indexer extensions; the
indexer/compiler owns trust enforcement, compatibility checks, loading, and execution.

Use `crux lint` to print the same backend-owned lint findings outside the interactive devtools. It is non-blocking by default, supports `--profile=recommended|strict|experimental|off`, `--include-suppressed`, and `--json`, and only exits nonzero when an explicit gate is requested with `--fail-on=error|warning|info`. The command reads the Go Project Index service instead of reimplementing rule logic in the CLI.

The canonical runtime API lives at `@crux/core/observability`. It emits lifecycle graph records (`run:start`, `span:start`, `span:event`, `artifact`, `edge`, `span:end`, `run:end`) through a transport. Delivery is non-blocking by default and starts immediately for live devtools updates. Later records coalesce per microtask and are delivered FIFO, so terminal records cannot overtake their own starts across HTTP delivery attempts. HTTP delivery normalizes unknown preview values into JSON-safe shapes and isolates rejected records inside a failed batch, so one malformed or oversized detail artifact cannot strand terminal `span:end` / `run:end` records. The Go backend still reconciles out-of-order lifecycle records defensively by id and timestamp. Streaming generation spans close on raw-stream completion or raw-stream error, even when usage metadata is read later. Prompt resolution emits a redacted `prompt.input` preview under the canonical `input` artifact kind with top-level provided/schema/required/missing/unexpected keys and validation status, never field values. Generation and stream spans consume a `messages` artifact with the prepared SDK input preview (`messages`, `system`, `systemBlocks`, and prompt text) so run-detail views can inspect the actual request payload. Transport failures are captured as diagnostics rather than throwing into user code. Serverless and Convex request handlers should await a bounded `observe.flush()` or `observe.shutdown()` before returning so queued records are not killed with the request; bounded flushes cancel their timeout timer when delivery wins first, so the flush itself does not leave an avoidable timer behind. Devtools keeps terminal run-detail pages warm for a short grace window so late Convex/serverless flushes appear without waiting for another run or a manual refresh. Convex Agent container streams fold into details in the Go read model; step-level streamed generation turns, tools, handoffs, and delegated flows render as chronological agent children. When a tool call is visually promoted out of the generation that requested it, the read model still orders it after that generation by canonical parent relation instead of trusting noisy cross-action timestamps alone.

The local Go backend keeps list and detail reads separate. Run-list endpoints page the newest history by default and only perform cheap count/identity enrichment for that page, so the web UI and TUI do not scan every stored span's metric JSON on each live refresh. Dashboard read models and lifecycle reconciliation use the same cheap run-summary path rather than the exact historical rollup path. Single-run detail reads build the `RunDetail` projection from graph tables without first running summary count subqueries or loading raw record payloads; raw graph/record access remains available through the debug graph endpoint.

Crux orchestration helpers emit canonical spans automatically. Standalone `parallel`, `pipeline`, `consensus`, `swarm`, `flow`, `delegate`, and `handoff` calls create an implicit run when needed, then record inspectable composition, flow, agent, delegate, handoff, artifact, and relation records for the backend to index.

Retrieval, indexing, and corpus helpers also emit the canonical graph automatically. Retrieval calls and retrieval-pipeline stages record query/stage spans, bounded hit or stage-output artifacts, and relation edges. Indexing and corpus sync record chunking, transforms, cache hits, dry runs, source ledger decisions, ingest load results, and nested indexing work as backend-readable spans and artifacts.

Tool helpers emit the same graph automatically. Adapter-managed tool loops record `tool.call` spans with args, raw application output, model-facing output, size/savings metadata, errors, and relation edges. Model-emitted tool intents are recorded as `tool.request` artifacts on the generation span; the actual user-code execution remains a separate `tool.call` operation linked by tool call id, so agent timelines can show generation, request, execution, and follow-up generation without hiding any raw detail. Approval request/resume/deny/token-mismatch paths record `tool.approval` spans even when the underlying tool never executes.

Enable devtools through `config()`:

```ts
config({
  prompts,
  contexts,
  devtools: { serverUrl: process.env.DEVTOOLS_URL },
  observability: { serverUrl: process.env.DEVTOOLS_URL },
})
```

```ts
import { observe } from '@crux/core/observability'

await observe.run({ name: 'support reply', rootPrimitive: 'agent.run' }, async () => {
  await observe.span({ name: 'retrieve docs', family: 'retrieval', primitive: 'retrieval.query' }, async () => {
    observe.event({ name: 'query.built', attributes: { terms: ['refund', 'policy'] } })
  })
})

await observe.flush({ timeoutMs: 5000 })
```

For serverless resumes or scheduled workflows that span multiple workers, use
`observe.openRun()` to emit the logical `run:start`, persist
`run.captureContext()`, restore it with `observe.withContext()`, and call
`observe.endRun()` only when the logical run actually completes.
`flow.suspend()` is a first-class lifecycle state: Crux emits canonical
`span:end` records with `status: "suspended"` and persists the parent
observability context in the flow snapshot. A later resume should restore that
context and append to the same run id; Convex `@crux/convex/server` flows do
this automatically when `.signal()` schedules the resume action.

When prompts and contexts are organized into trees (via `createPrompts` / `createContexts`), the devtools UI groups them by namespace path for easier navigation.

**What gets instrumented automatically:**

- Every `generate()` / `stream()` call — timing, tokens, results, errors
- Every `.resolve()` call — system message assembly details
- Agent model calls via `@crux/core/ai-agent`
- Quality runs — per-case results, variants, scores, comparisons, trace links, and local history
- Flow-shaped quality runs — step detail, cost breakdowns, model/tokens/cost, input/output/tool-call inspection, multiturn conversation view, and model map tables
- Memory operations — every read/write across block memory and blackboards
- Retrieval/indexing/corpus operations — retriever calls, retrieval stages, chunking/transforms, corpus sync, ingest load results, and source-ledger outcomes
- Compaction events — sliding window evictions (start/end with compression stats)
- Budget checks — pressure level transitions
- Blackboard updates — field-level change tracking
- Handoff preparations — input/output size tracking
- Delegation execution — every `delegate.run()` call (`delegate:start`/`delegate:complete`) with sizing and handoff correlation
- Tool execution — every `tool.call` span with args artifacts, raw/model result artifacts, duration, size/savings metadata, relation edges, and errors
- Tool approvals — every `tool.approval` request, approval, denial, and token mismatch

**Trace tree (parent-span propagation):** Every boundary primitive (`delegate`, `flow`, `handoff`, …) emits canonical `span:start` / `span:end` records and pushes the span id onto an AsyncLocalStorage span stack. Nested runs and spans capture the deepest-open span as `parentSpanId`, so the Go backend can nest delegated subagents directly under the specific delegate / flow / handoff that triggered them — no time-window or name-match heuristics. For runtimes where async context doesn't survive call boundaries (Convex `runAction`, edge workers, HTTP), transport helpers must pack and restore the captured context. In Convex, use `@crux/convex/server` wrappers and `ctx.crux.runAction()` for awaited child work so the hidden `__crux` envelope crosses the boundary automatically. `ctx.crux.scheduler.runAfter()` records the enqueue span but detaches by default because scheduled work can execute after the parent action has ended; pass `{ observability }` explicitly only for durable continuations such as flow resumes. Convex action helpers flush boundary starts before child workers run and await bounded observability flushes before returning so serverless workers do not drop queued records. Action hops are two-sided: child actions acknowledge the received boundary and completion/failure with `runtime.convex.boundary.*` span events, and the Go read model can reconcile a missing parent-side boundary end from those acknowledgements.

Use `flow()` only for actual user/workflow flows. Framework agent turns such as a Convex Agent chat response should open an `agent.run` via `observe.run()` / `observe.span()` and flush before the serverless action returns. Convex Agent integrations should import `Agent`, `createTool`, or `wrapConvexTool()` from `@crux/convex/agent`; this makes prompt/use[] resolution, memory, retrieval, thread model calls, and tools children of the agent turn, augments tool handlers with `ctx.crux`, normalizes token and cost metadata from Convex Agent result/step shapes, and preserves the readable tool name in devtools instead of displaying provider call ids or long model-facing descriptions.

- Judge scores — every `llmJudge` result with reasoning and eval correlation

All instrumentation is zero-overhead when devtools are disabled — primitives check for hooks at runtime and skip if none are installed. The Go backend owns graph validation, persistence, read-model building, filtering, search, and subscriptions; web devtools and the TUI should consume backend read models instead of rebuilding graph semantics locally.

The backend exposes a lossless canonical graph internally and a `RunDetail` read model for normal inspection. The canonical graph keeps every span/event/artifact/edge/raw record. `RunDetail` is the human trace view: spans are classified into visible nodes or attached details, with prompt/context/routing/memory/cache/cost records attached to the operation they explain. Semantic ownership wins over chronology via `explains` edges and `attributes.presentation.ownerSpanId`; chronology is only the fallback. Completion-only records are folded as details rather than rendered as anonymous top-level operations. Routing decisions fold onto the selected concrete generation even when the canonical graph wraps that generation under a routing span. Quiet constraint, guardrail, citation, scoring, and security warning spans fold as safety/detail evidence; governance that blocks, retries, transforms, redacts, or otherwise changes execution remains visible. Contextual retrieval, memory, and embedding spans that explain a generation request are folded as attached details instead of separate context rows. Operational retrieval inside a tool, flow, composition, or agent boundary remains a visible operation even when the broader branch sits beneath an agent generation stream; retrieval queries and embeddings inside a retrieval pipeline can still fold into that retrieval node. Convex Agent streams are presented as `AGENT -> GENERATE stream response -> GENERATE step / TOOL ...` when the stream container carries useful structure; redundant single-step stream wrappers are folded, with `source.canonicalParentSpanId` preserving the lossless graph parent. Flow suspensions render as visible timeline markers (`flow.suspension`) beside flow steps, while the causing step/generation may finish `ok`. Live `token.delta` events are also published as append-only observability notifications keyed by run/span so UIs can visualize streaming tokens without refetching the full run on every token. Custom spans can override the default classifier with `attributes.presentation.display = "primary" | "detail" | "metadata"`.

`RunDetailNode.request` is the backend-owned composed request/context view. `mode: "exact"` means the generation consumed its own request-shaped `messages` artifact. `mode: "inherited"` means a nested generation step did not emit request-shaped input but inherited the nearest enclosing generation request, which is common for framework agent step spans that only produce output message arrays. `mode: "aggregate"` means a run, stream, agent, flow, or composition uses the final descendant generation request as the representative and exposes `turns[]`. Request composition recovers context contributions referenced from `messages.systemBlocks[].artifactId`, pulls ambient context contributions and prompt budgets produced under the nearest enclosing request scope before the generation starts, carries prompt budgets, orders contributions, preserves Convex Agent thread-context fields such as `allMessages`, `recent`, `inputMessages`, `inputPrompt`, `existingResponses`, and `search`, includes prior sibling step outputs under `previousStepMessages` for inherited agent turns, and surfaces request/injected tools so clients render it directly instead of unioning child artifacts. Resolved `systemBlocks` preserve `segments`, `staticTokens`, and `dynamicTokens`, including direct string-template interpolation inferred from unambiguous primitive input values; explicit `{ segments }` returns remain the precise provenance path for transformed values. `request.basePrompt.sourceId` uses the concrete `promptId` when known and otherwise reports the request field (`messages.system` / `messages.prompt`) rather than a generic prompt label. `request.modelSummary` groups concrete generation models, marks mixed-model aggregates, and `request.turns[]` carries per-generation `model`, `provider`, `status`, and `promptId`; output artifact `meta.actualModelId` wins over requested model attributes when present. Flattened `RunDetail.rows[]` also carries `model` and `provider` so row-based clients can render generation and aggregate model badges without rejoining against the tree.

`RunDetail` owns presentation-only lifecycle reconciliation, inspection sections, status rollups, and aggregate metric rollups. Canonical records stay unchanged, but the backend can derive a truthful inspection state from reliable signals: child Convex boundary acknowledgements can close missing parent-side runtime boundary ends, expired Convex boundary leases can mark abandoned boundaries stale, and expired `operation.deadline` events can mark missing generation/stream ends plus still-open ancestors as incomplete observability. Future deadlines protect active long calls from being shown as stale too early. Execution-changing governance can roll ancestors up to `blocked`; intentional pauses roll ancestors up to `suspended`. Deadline reconciliation is a telemetry diagnostic, not an application error.

### Protocol validation

Canonical graph records have Zod schemas in `@crux/core/observability`. The Go backend validates every incoming batch at `POST /api/observability/records` — malformed records return 400 instead of silently corrupting the store.

```ts
import { CruxGraphRecordBatchSchema } from '@crux/core/observability'

const result = CruxGraphRecordBatchSchema.safeParse({ records })
```

The legacy collector HTTP path has been removed from the Go backend, and the collector protocol export/schemas have been removed from `@crux/core`. New tracing code must use the canonical graph contract.

### Canonical observability graph

`@crux/core/observability` defines the new canonical graph contract shared by the TypeScript runtime and Go devtools backend. It exports branded IDs, graph record types, runtime schemas, canonical primitive names, edge types, artifact kinds, presentation read-model types, and shared fixtures.

```ts
import { CruxGraphRecordBatchSchema } from '@crux/core/observability'

const batch = CruxGraphRecordBatchSchema.parse(payload)
```

The graph write protocol is lifecycle based: runtimes emit `run:start`, `span:start`, `span:event`, `artifact`, `edge`, `span:end`, and `run:end` records. Backend read models then build trees, timelines, relation graphs, search indexes, and UI/TUI detail views from those records.

Custom edge types and artifact kinds must use the `custom.*` namespace. Built-in Crux primitives use canonical names so devtools can filter, search, and render them without UI-side heuristics.

### Runtime flow instrumentation

When your application has a real multi-step workflow, use `flow()` to structure it into named steps. Flow and step events are automatically emitted to all installed plugins (including devtools) via `InstrumentationHooks`.

```ts
import { config, flow } from '@crux/core'

config({
  prompts,
  devtools: { serverUrl: process.env.DEVTOOLS_URL },
})

// flow() + .run() automatically emits flow/step events to all installed plugins
const contentPipeline = flow('content-pipeline', async (flow) => {
  const research = await flow.step('Research', async () => {
    return await generate(prompts.research, { model, input })
  })
  const draft = await flow.step('Write', async () => {
    return await generate(prompts.write, {
      model,
      input: { ...input, research },
    })
  })
  return draft
})

const result = await contentPipeline.run()
```

Flows can suspend for external input and resume later — even in a different process:

```ts
import { flow } from '@crux/core'

const reviewPipeline = flow('review-pipeline', async (flow) => {
  const draft = await flow.step('draft', () => generate(writer, { model, input }))
  const approval = await flow.suspend<{ approved: boolean }>('human-review', {
    schema: z.object({ approved: z.boolean() }),
    timeout: '24h',
  })
  if (!approval.approved) return flow.cancel('Rejected by reviewer')
  return flow.step('publish', () => publish(draft))
})

// First call — suspends at the gate
const result = await reviewPipeline.run()
// result.status === 'suspended'

// Signal via the handle — recommended over standalone signalFlow()
await reviewPipeline.signal(result.flowId, 'human-review', { approved: true })

// Resume — completed steps replay from cache, execution continues past the gate
const final = await reviewPipeline.run({ resume: result.flowId })
```

For cases where you need manual control outside of `flow()`, use `observe.run()` and `observe.span()` from `@crux/core/observability` so the Go backend receives the same canonical graph records as built-in flows. Detail-only spans that should enrich an existing run but must not become a visible run boundary can pass `implicitRun: false`; Crux uses this for router/cascade resolution so a direct generation run is not mislabeled as `router.resolve`. Long-running primitives with a known timeout should record `timeoutMs`/`deadlineAt` and emit `operation.deadline`; built-in `@crux/ai` generation and streaming orchestration does this automatically when `timeoutMs` is set.

### Flow step composition

`flow<T, TInput>()` accepts two type parameters. `TInput` defines the typed input accessible as `flow.input` inside the flow. Step functions that accept a `(flow: FlowScope)` parameter receive it automatically (auto-pass), enabling reusable step functions:

```ts
async function planStep(flow: FlowScope<{ query: string }>) {
  return generate(planner, { model, input: { query: flow.input.query } })
}

const researchFlow = flow<PlanResult, { query: string }>('research', async (flow) => {
  await flow.step('plan', planStep) // auto-pass: flow injected automatically
  return flow.step('search', () => search()) // wrapper form for custom args
})

const result = await researchFlow.run({ input: { query: 'cloud migration' } })
```

`flow.results` (`Record<string, unknown>`) is auto-populated after each step completes, keyed by step label. Prefer return-value assignment (`const plan = await flow.step(...)`) for typed access; use `flow.results` as an escape hatch in external step functions.

The local dev server, Go services, TUI, eval runner, index, and lint command are shipped by `@crux/local`. The React web UI bundle is `@crux/devtools` and is hosted by the local runtime:

```bash
crux dev                             # start devtools server on :4400
crux dev --tunnel                    # with public tunnel for cloud runtimes
crux dev --port 8080                 # custom port
crux dev --tui                       # interactive terminal dashboard
```

The `dev` dashboard has modes for live runs, trace inspection, the Project Index, insights, eval/quality work, and stats. The index mode reads the Go-owned Project Index service, not source files directly. Navigate with `j`/`k` or arrow keys to scroll, `/` to filter, and `Enter` to inspect a selected item.

### Project Index injection intelligence

The Project Index can statically surface authored prompt/context injection possibilities without executing user callbacks. Source discovery records `injectable(...)` definitions, their input schemas, conservative returned `contexts`/`tools`/safety/metadata contributions, context `tools` object contributors, and richer `use` entries including `when(...)`, `match(...)`, guarded refs, memory, and blackboards. The semantic pass can also resolve imported `injectable(...)` definitions, imported injectable input schemas and callback refs, import-safe prompt/context/injectable `use` arrays with spreads, resolved `useEntries` for imported/spread arrays and helper-shaped conditional entries, condition-specific source refs for `when(...)`, `match(...)`, and guarded `&&` expressions, imported/spread tool maps, simple injectable `inject` functions that return tool maps, and injectable return contribution facts for constraints, guardrails, and metadata keys. When a semantic use/tool shape is computed, it preserves a dynamic/partial fact instead of disappearing, such as a dynamic `useEntries` row or a `tools` fact with resolved names plus `dynamic: true`. These facts appear as typed `metadata.facts`/`metadata.intelligence.dependencies`, condition-tagged `definition.sourceRefs`, plus graph relations such as `prompt.uses_injectable`, `context.uses_context`, `context.uses_memory`, and `injectable.uses_tool`; runtime observability remains the source of truth for the exact contributions activated by a concrete input. The local devtools observed-injection read model can combine these authored facts with runtime `context.contribution`, `prompt.budget`, and redacted `prompt.input` artifacts to show observed branches, injected tools, budget drops, static/runtime comparison evidence, and runtime input-key validation summaries without mutating the authored Project Index.

## Security

The library includes input sanitization to defend against prompt injection via XML structure breakout.

When `securityWarnings` is enabled, suspicious input patterns emit canonical `security.warning` spans and `security.report` artifacts with prompt id, field, pattern, severity, action, location, and a bounded input preview. These signals are dev-facing and do not block prompt resolution.

### Auto-Escape (default)

All string input values are XML-escaped before reaching system/prompt functions. No code changes needed for most prompts:

```ts
prompt({
  input: z.object({ instruction: z.string() }),
  system: ({ input }) => `Do: ${input.instruction}`,
  // instruction is auto-escaped — </role> becomes &lt;/role&gt;
})
```

Declare `rawFields` for trusted content that shouldn't be escaped:

```ts
prompt({
  rawFields: ['indexedHtml'],
  input: z.object({ instruction: z.string(), indexedHtml: z.string() }),
  // instruction: escaped, indexedHtml: passed through
})
```

### `safe` Tag (explicit control)

For per-value control with composable helpers:

```ts
import { safe, raw, limit, wrap } from '@crux/core'

safe`
  Doc: ${raw(trustedHtml)}
  Query: ${limit(userQuery, 500)}
  Instruction: ${wrap(instruction)}
`
```

| Helper        | Effect                                     |
| ------------- | ------------------------------------------ |
| `raw(v)`      | Skip escaping (trusted content)            |
| `limit(v, n)` | Truncate + escape                          |
| `wrap(v)`     | Escape + wrap in `<user-input>` delimiters |

All helpers work in both `safe` tagged templates and regular template literals — they implement `toString()` so `\`${wrap(v)}\``produces the wrapped string, not`[object Object]`.

Objects passed to `safe` throw immediately: `safe\`${myObject}\`` → error with fix suggestion.

### Dev Warnings

Enable injection pattern detection in development:

```ts
config({ prompts, securityWarnings: true })
```

See [SECURITY.md](./SECURITY.md) for the full threat model, best practices, and migration guide.

## Resolution & Inspection

Every prompt has `.resolve()` and `.inspect()` methods that work without executing any model call.

**`.resolve()`** — returns the composed, SDK-agnostic prompt data:

```ts
const resolved = editDraft.resolve({
  input: { ... },
  provider: 'openai',     // for adaptation matching
  tokenBudget: 4000,      // for context dropping
})
// → { system, prompt, schema, tools, settings }
```

This is what adapters call internally. Use it directly when integrating with an SDK that doesn't have an adapter.

**`.inspect()`** — shows how the system message was assembled with per-part token breakdowns:

```ts
const debug = editDraft.inspect({ input: { ... }, tokenBudget: 2000 })

debug.system.total        // the full assembled system text
debug.system.parts        // InspectPart[] — source, text, tokens, skipped
debug.system.totalTokens  // total system tokens
debug.prompt              // { text, tokens } | undefined
debug.totalTokens         // system + prompt tokens
debug.droppedContexts     // DroppedContext[] — what was dropped and why
debug.tools               // string[] — tool names from contexts + config
```

**Introspection properties on prompt instances:**

```ts
editDraft.id // 'draft-edit'
editDraft.description // string | undefined
editDraft.tags // readonly string[]
editDraft.contexts // the contexts tuple
editDraft.inputSchema // merged Zod schema
editDraft.outputSchema // Zod output schema | undefined
editDraft.hasOutput // boolean
editDraft.config // raw config object
```

### Custom Contributors

`contributor()` creates a first-class `use:` entry for your own composable primitives. Where `injectable()` covers "compute contexts and tools at resolve time", `contributor()` adds the rest of the entry contract: a `when` gate with exclusion reporting (visible in `.inspect()` and devtools), nested `use` entries resolved before its own contribution, and pipeline re-entry with any entry kind — skills, memory, blackboards, other contributors.

```ts
import { contributor, context, prompt } from '@crux/core'
import { z } from 'zod'

const supportTools = contributor({
  id: 'support-tools',
  input: z.object({ plan: z.string() }),
  when: (input) => input.plan !== 'free',          // excluded with a recorded reason
  use: [docsRetriever.asContext({ topK: 4 })],     // resolved before contribute()
  contribute: async ({ input }) => ({
    tools: await loadSupportTools(input.plan),     // collision-checked merge
    metadata: { supportTier: input.plan },
  }),
})

const reply = prompt({
  id: 'support-reply',
  use: [brandVoice, supportTools],
  system: 'You are a support agent.',
})
```

Declared `input` schemas merge into the prompt's input schema (conflicting keys across entries throw at `prompt()` time), and the declared fields flow into `contribute()` fully typed. Entries created by `contributor()` are structurally backward-compatible with `InjectableEntry`.

For adapter authors, the lowered contract every entry resolves through is exported as advanced API: `lowerEntry()`, `resolveUse()`, `collectSchemaContributions()`, and the `LoweredContributor`/`Contribution`/`GateResult` types.

### Testable Resolution

`createPromptResolver(ports?)` binds the resolution pipeline to explicit ports instead of process globals — observability, the skill registry, the context cache, the clock, sanitization policy, diagnostics, and instrumentation hooks. Anything you omit falls back to the production adapter, so `createPromptResolver()` with no arguments is exactly the default pipeline.

Pair it with the in-memory fakes from `@crux/core/testing` to test prompt resolution with zero global setup and a clock you control:

```ts
import { createPromptResolver } from '@crux/core'
import {
  recordingObservability,
  inMemorySkillSource,
  inMemoryContextCache,
  fixedClock,
  collectingDiagnostics,
} from '@crux/core/testing'

const observability = recordingObservability()
const clock = fixedClock(1_000)
const resolver = createPromptResolver({
  observability,
  clock,
  cache: inMemoryContextCache(clock),
  skills: inMemorySkillSource({ 'acme/seo': { instructions: '…', references: [], meta: { name: 'seo', description: 'SEO' } } }),
  diagnostics: collectingDiagnostics(),
})

const resolved = await resolver.resolvePrompt(config, { input: { mode: 'seo' } }, schema)
const exclusions = observability.contributionPreviews('checked-not-included')
```

`resolver.inspectArgs()` mirrors `.inspect()`. Exclusion strings, artifact shapes, and composition order are identical to the global path — the ports only change where the pipeline's ambient effects land.

## Type System

Crux treats TypeScript inference as part of the public API. `@crux/core` has a package-local `typecheck` script that runs strict `tsc` against shipped source plus dedicated type tests, and an AST-based explicit-`any` guard. Existing legacy `any` usage is tracked in `scripts/explicit-any-baseline.json`; new production `any` usage fails typecheck and removed entries must update the baseline.

**Input merging** — when a prompt uses contexts with input schemas, all fields are merged into a single type:

```ts
const brand = context({
  input: z.object({ brandContext: z.string().optional() }),
  system: ({ input }) => '...',
})

const myPrompt = prompt({
  use: [brand],
  input: z.object({ instruction: z.string() }),
  // ...
})

// TypeScript infers the merged input type:
// { instruction: string, brandContext?: string }
```

If two contexts declare the same input key, `prompt` throws at definition time. The prompt's own fields take precedence over context fields.

**Conditional return types** — adapters return different types based on whether `output` is defined:

```ts
// With output → result.object is typed
const result = await generate(structured, { model, input: { ... } })
result.object // z.infer<typeof OutputSchema>

// Without output → result.text is a string
const result = await generate(textOnly, { model, input: { ... } })
result.text // string
```

**Generation settings** — `GenerationSettings` provides SDK-agnostic fields (`temperature`, `maxTokens`, `topP`, `topK`, `stopSequences`, `frequencyPenalty`, `presencePenalty`) plus an index signature for pass-through. Each adapter maps these to its SDK's naming conventions.

**Adapter author types** — `ResolvedPrompt`, `SystemBlock`, `ModelInfo`, `GenerationSettings`, `AnyPrompt`, and `AnyPromptConfig` are exported for adapter authors who consume `.resolve()` output. Adapter packages constrain context generics with `readonly Context<z.ZodType>[]` (rather than `Context<any>[]`) so that `MergedInput<...>` flows through `generate()`/`stream()` and downstream IDE autocomplete picks up merged context inputs without explicit type arguments.

**Compile-time API tests** — `__type_tests__/` covers public inference behavior that runtime tests cannot catch, including context input merging, grounding composition, and retriever tool-name inference for prefixed tools.

**Adapter bridge `any`** — A small number of `any` usages survive in adapter packages where SDK-internal types are intentionally inaccessible (Convex `FunctionReference` generics that trigger `TS2589`, AI SDK call-body discriminated unions whose alt-form constructors reject `Record<string, unknown>` spreads). These are marked with `eslint-disable-next-line @typescript-eslint/no-explicit-any` and an explanatory comment, and are not counted by the AST guard.

## Recipes

### Chat with Sliding Window

The most common pattern — a chatbot that remembers conversation history without blowing up the context window:

```ts
import { prompt, context } from '@crux/core'
import { generate } from '@crux/ai'
import { createSlidingWindow } from '@crux/core/compaction'
import { memory, workingState } from '@crux/core/memory'

// Rolling conversation history
const window = createSlidingWindow({
  windowSize: 30,
  generate: generateText,
  model: summaryModel,
})

// Agent's working state
const state = workingState({
  id: 'chat-state',
  schema: z.object({
    topic: z.string().optional(),
    mood: z.string().optional(),
  }),
})

const chatMemory = memory({
  id: 'chat',
  namespace: 'thread:default',
  blocks: [state],
})

const chatPrompt = prompt({
  id: 'chat',
  use: [chatMemory],
  input: z.object({ userMessage: z.string() }),
  system: 'You are a helpful assistant.',
  messages: async ({ input }) => {
    // Get compacted history + new message
    const history = await window.getMessages()
    return [...history, { role: 'user' as const, content: input.userMessage }]
  },
})

// On each message:
async function handleMessage(userMessage: string) {
  await window.push({ role: 'user', content: userMessage })
  const result = await generate(chatPrompt, { model, input: { userMessage } })
  await window.push({ role: 'assistant', content: result.text })
  return result.text
}
```

### Agent with Memory + Tools

An agent that remembers facts across sessions and can search its own memory:

```ts
import { facts, memory } from '@crux/core/memory'

const knowledge = facts({
  id: 'user-knowledge',
  embed: myEmbedding,
  write: { mode: 'propose' },
})

const agentMemory = memory({
  id: 'assistant',
  store: productionStore,
  namespace: 'user:123',
  blocks: [knowledge],
})

const agent = prompt({
  id: 'assistant',
  use: [agentMemory],
  input: z.object({ message: z.string() }),
  system: `You are a personal assistant. You remember user preferences and facts.
When you learn something new about the user, save it to memory.`,
  prompt: ({ input }) => input.message,
  tools: {
    rememberFact: tool({
      description: 'Save a fact about the user',
      parameters: z.object({ fact: z.string() }),
      execute: async ({ fact }) => {
        await knowledge.add({ content: fact }, { store: productionStore, namespace: 'user:123', memoryId: 'assistant' })
        return { saved: true }
      },
    }),
  },
})
```

### Multi-Agent Pipeline with Handoff

A research agent gathers information, then hands off to a writer agent:

```ts
import { blackboard, handoff } from '@crux/core/agent'

// Shared progress board
const board = blackboard({
  id: 'pipeline',
  schema: z.object({
    query: z.string(),
    status: z.enum(['researching', 'writing', 'done']),
    findings: z.array(z.string()),
  }),
  store: sharedStore,
})

// Typed handoff: researcher output → writer input
const researchHandoff = handoff({
  id: 'research-to-writer',
  inputSchema: z.object({
    query: z.string(),
    findings: z.array(z.string()),
    sources: z.array(z.string()),
  }),
  outputSchema: z.object({
    topic: z.string(),
    keyPoints: z.array(z.string()),
  }),
  transform: (input) => ({
    topic: input.query,
    keyPoints: input.findings.slice(0, 5), // keep top 5
  }),
  summarize: { generate: generateText, model: summaryModel },
})

// Research phase
const researchResult = await runResearchAgent(board)

// Handoff: validate, transform, and compress
const payload = await handoff.prepare({
  query: researchResult.query,
  findings: researchResult.findings,
  sources: researchResult.sources,
})

// Writer agent receives structured, compressed context
const writerPrompt = prompt({
  id: 'writer',
  use: [handoff.asContext(payload), board],
  system: 'Write an article based on the research handoff.',
  input: z.object({ style: z.string() }),
})
```

### Quality Suite With Scoring

Test prompts with automated quality scoring across variants:

```ts
import { expect, quality, suite, target } from '@crux/core/quality'
import { llmJudge, metrics } from '@crux/core/scoring'

// Custom judge for your domain
const domainJudge = llmJudge({
  id: 'brand-voice',
  criteria: 'Does the output match our brand voice? Professional but approachable.',
  scale: { min: 1, max: 5 },
  rubric: {
    1: 'Completely wrong tone',
    3: 'Acceptable but generic',
    5: 'Perfectly on-brand',
  },
  generate: generateObject,
  model: judgeModel,
})

await quality({ id: 'editor' }).evaluate({
  suite: suite<{ instruction: string; draftTitle: string }>('editor', (test) => {
    test('casual edit', {
      input: { instruction: 'Make this more casual', draftTitle: 'Guide' },
      expect: ({ output }) => expect(output).toContain('Guide'),
    })
  }),
  target: target.prompt({
    prompt: editDraft,
    generate: (prompt, input) => generate(prompt, { model: gpt4o, input }),
  }),
})

// Or use pre-built metrics for standard quality checks
const relevance = metrics.relevance({
  generate: generateObject,
  model: judgeModel,
})
const result = await relevance.score({ input: query, output: response })
```

## Package Structure

```
@crux/core
├── index.ts           # prompt, context, createPrompts, createContexts, config
├── types.ts           # SDK-agnostic type definitions
├── context.ts         # context() and createContexts()
├── define.ts          # prompt() — .resolve(), .inspect()
├── prompts-tree.ts    # createPrompts()
├── configure.ts       # internal registry, devtools, middleware, tokenizer
├── config.ts          # config() — public configuration API
├── resolve.ts         # Resolution pipeline — system composition, tools, schema merging
├── tools.ts           # SDK-agnostic tool() helper and ToolDef re-exports
├── tokenizer.ts       # Pluggable tokenizer
├── middleware.ts       # Global middleware + instrumentation hooks
├── testing.ts         # internal runner support for CLI/devtools quality execution
├── quality/
│   └── index.ts       # quality(), suite(), target(), cassette() — local suites, experiments, replay, and comparison
├── messages.ts        # Message type + helpers
├── embedding/
│   └── index.ts       # embedding() — dense/sparse embeddings with batching + telemetry
├── retrieval/
│   └── index.ts       # retriever(), retrievalPipeline() — dense/sparse/hybrid/custom retrieval and query-time RAG composition
├── indexing/
│   └── index.ts       # indexer(), corpus(), indexingPipeline() — transforms, chunkers, stage cache, generation-aware writes
├── memory/
│   ├── index.ts       # Barrel: memory(), memoryBlock(), recentMessages(), workingState(), episodes(), facts(), procedures()
│   ├── block-system.ts # Block memory implementation
│   ├── types.ts       # Memory types
│   └── utils.ts       # Memory helpers
├── store/
│   ├── index.ts       # Barrel: store exports
│   ├── types.ts       # DataStore, VectorStore, BlobStore, CruxStore compatibility, VectorSearchQuery
│   └── memory.ts      # inMemoryDataStore(), inMemoryVectorStore(), inMemoryBlobStore(), inMemoryStorage()
├── compaction/
│   ├── index.ts       # Barrel: all compaction exports
│   ├── summarize.ts   # summarizeMessages() — batch LLM summarization
│   ├── sliding-window.ts  # createSlidingWindow() — rolling context manager
│   ├── budget.ts      # createBudgetManager() — advisory token tracking
│   └── extract.ts     # extractKeyFacts() — structured fact extraction
├── scoring/
│   ├── index.ts       # Barrel: llmJudge, metrics
│   ├── judge.ts       # llmJudge() — LLM-as-a-judge factory
│   ├── metrics.ts     # Pre-built judges (relevance, faithfulness, etc.)
│   └── types.ts       # JudgeConfig, JudgeResult, JudgeInstance
├── agent/
│   ├── index.ts       # Barrel: blackboard, handoff
│   ├── blackboard.ts  # blackboard() — shared typed scratchpad
│   └── handoff.ts     # handoff() — structured inter-agent transfer
├── plan/
│   ├── index.ts       # Barrel: plan, tasklist, agent primitives, types
│   ├── types.ts       # Plan, TaskList, Task, status types
│   ├── plans.ts       # plan(), getPlan(), updatePlan()
│   ├── tasks.ts       # tasklist(), getTaskList(), TaskListHandle
│   ├── agent.ts       # planAgent(), taskListAgent(), taskWorker(), createPlanTool(), createTaskListTool()
│   └── helpers.ts     # deriveTaskListStatus(), key conventions
├── tasks/
│   └── index.ts       # Barrel: canonical @crux/core/tasks import path (re-exports from plan/)
├── react/
│   ├── index.ts       # Barrel: CruxProvider, usePlan, useTaskList, useTasks, transports
│   ├── types.ts       # CruxTransport interface
│   ├── provider.tsx   # CruxProvider + useCruxTransport()
│   ├── hooks.ts       # usePlan(), useTaskList(), useTasks()
│   ├── sse.ts         # createSSETransport() — EventSource-backed transport
│   ├── polling.ts     # createPollingTransport() — periodic poll-backed transport
│   └── testing.ts     # createMockTransport() for tests
├── server/
│   ├── index.ts       # Barrel: cruxSSEHandler
│   └── sse.ts         # cruxSSEHandler() — SSE endpoint for CruxStore changes
├── store/
│   ├── index.ts       # Low-level store utilities and compatibility exports
│   ├── types.ts       # DataStore, VectorStore, BlobStore, CruxStore compatibility, JsonObject, StoreEntry
│   └── memory.ts      # In-memory DataStore/VectorStore/BlobStore implementations
├── flow/
│   ├── index.ts       # Barrel: flow, signalFlow, cancelFlow, listFlows, createFlowId
│   ├── scope.ts       # flow(), FlowHandle, FlowRunOptions, FlowScope, signalFlow, cancelFlow
│   ├── executor.ts    # Flow eval step execution engine
│   └── evaluator.ts   # Flow eval case × config matrix runner
├── ai-agent.ts        # Agent framework adapter
├── observability/     # Canonical graph contract, schemas, IDs, observe runtime, transports, and fixtures
├── devtools.ts        # withDevtools() plugin + enableDevtools() — installs the canonical observability transport
├── devtools/          # Project Index contract, serializers, and source capture helpers
├── ai/                # Vercel AI SDK adapter
├── openai/            # OpenAI SDK adapter
├── google/            # Google GenAI SDK adapter
└── convex/            # Convex CruxStore adapter
```

No build step. TypeScript source files are consumed directly via monorepo workspace references.
