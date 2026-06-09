# @crux/convex

Convex component and adapters for Crux persistence and agent integration.

For the full guide, see the [Convex documentation](https://cruxjs.dev).

## Install

```bash
pnpm add @crux/convex @crux/core convex
```

## Component setup

Install the crux Convex component for automatic persistence (memory records, experimental swarm state, and more in the future):

```ts
// convex/convex.config.ts
import crux from '@crux/convex/convex.config'
const app = defineApp()
app.use(crux)
```

## Convex profile imports

`@crux/convex` is a Convex runtime profile for normal Crux APIs. Prefer the mirrored Convex subpaths when authoring Crux primitives for Convex code:

```ts
import { createCruxConvex, prompt } from '@crux/convex'
import { context } from '@crux/convex/context'
import { memory, recentMessages, workingState } from '@crux/convex/memory'
import { skill } from '@crux/convex/skill'
import { tool } from '@crux/convex/tools'
```

The mirrored subpaths intentionally stay close to `@crux/core`:

| Import | Classification | Notes |
| ------ | -------------- | ----- |
| `@crux/convex/context` | Identical re-export | Re-exports core context helpers. |
| `@crux/convex/skill` | Identical re-export | Re-exports core skill helpers. |
| `@crux/convex/memory` | Convex-bound drop-in | Same block API; `memory()` late-binds the active Convex Crux store and defaults to the current thread namespace. |
| `@crux/convex/tools` | Convex-bound drop-in | Same tool authoring shape; `execute()` receives Convex runtime metadata. |
| `convexAgent()` | Convex-only API | Wraps Convex Agent and resolves a Crux prompt per turn. |
| `createCruxConvex()` | Convex-only API | Creates a reusable Convex runtime profile from `components.crux` and `components.agent`. |

Avoid split imports inside Convex files when a Convex profile exists. For example, import memory blocks from `@crux/convex/memory`, not `memory` from `@crux/convex/memory` plus `recentMessages` from `@crux/core/memory`.

The package root is curated. It exports Convex APIs plus common prompt authoring helpers (`prompt`, `context`, `createPrompts`, `createContexts`, and sanitization helpers), but it does not blanket re-export every `@crux/core` API. If a Convex mirror exists, prefer it; if no mirror exists yet, import the SDK-agnostic primitive from `@crux/core`.

## Exports

### `createCruxConvex(options)`

Create a reusable Convex runtime profile around the Crux Convex component and Convex Agent component:

```ts
import { createCruxConvex } from '@crux/convex'
import { components } from './_generated/api'

export const crux = createCruxConvex({
  components: {
    crux: components.crux,
    agent: components.agent,
  },
})
```

The profile exposes:

- `store(ctx)` for a request-scoped `CruxStore`
- `withRuntime(ctx, target, fn)` for low-level runtime binding
- `convexAgent(config)` for the high-level Convex Agent wrapper without repeating component wiring

Use `withRuntime()` only for lower-level integration code. Normal agent calls through `convexAgent()` install the runtime automatically.

### `cruxConvexStore(config)`

Creates a `CruxStore` backed by the crux Convex component. No manual schema or function definitions needed.

```ts
import { cruxConvexStore } from '@crux/convex'
import { memory, workingState } from '@crux/convex/memory'
import { components } from './_generated/api'

const store = cruxConvexStore({
  component: components.crux,
  ctx,
})

const state = workingState({ id: 'state', schema })
const assistantMemory = memory({
  id: 'assistant',
  store,
  namespace: 'thread:1',
  blocks: [state],
})
```

`cruxConvexStore()` is dense-only for retrieval. It supports:

- `vectorSearch(embedding, options?)`
- `searchVectors({ dense })`

and throws explicit errors for sparse-only or hybrid queries so retrievers fail clearly instead of silently falling back.

For semantic response caching, use a dedicated Convex table/index or component instance and opt into the capability explicitly:

```ts
const cacheStore = cruxConvexStore({
  component: components.crux,
  ctx,
  vectorIndexName: 'by_embedding',
  semanticCache: { isolatedVectorNamespace: true },
})
```

Only set `isolatedVectorNamespace: true` when the backing vector index is not shared with RAG chunks or memory entries. The flag is not enabled by default because a normal `cruxConvexStore()` is often shared by memory and retrieval. Semantic cache lookup needs a dedicated vector space so unrelated vectors cannot crowd out cache entries before filtering.

### `convexWorkspaceBlobStore(config)`

Blob storage for `workspace()` binary and oversized files.

```ts
import { workspace } from '@crux/core/workspace'
import { storage } from '@crux/core/storage'
import { cruxConvexStore, convexWorkspaceBlobStore } from '@crux/convex'

const ws = workspace({
  id: 'thread-workspace',
  namespace: threadId,
  storage: storage({
    data: cruxConvexStore({ component: components.crux, ctx }),
    blobs: convexWorkspaceBlobStore({ ctx }),
  }),
})
```

Workspace metadata stays in the Convex-backed `DataStore`. Binary and large payloads go through Convex file storage. If the current Convex runtime cannot read blobs, `get()` throws clearly. Use a custom `BlobStore` for S3, R2, GCS, local disk, or another app-owned file service.

### Observability helpers

Convex actions run in serverless workers that can be torn down immediately after a handler returns. Use the observability helpers to flush queued canonical graph records before that happens:

```ts
import { withObservabilityFlush } from '@crux/convex/observability'

export const run = internalAction({
  args: {},
  handler: withObservabilityFlush(async (ctx, args) => {
    // Crux work here
  }),
})
```

`flushObservability({ timeoutMs })` is also exported for explicit shutdown paths. It defaults to a 5s bounded wait so large fanout traces finish delivering before Convex freezes a warm worker. `@crux/convex/server` `action()` and `internalAction()` flush automatically by default; pass `observabilityFlushTimeoutMs: false` only when an outer boundary already flushes.

Thrown errors use the same evidence contract as core Crux: terminal spans keep a compact error summary, failing spans emit an `exception` event, and stack/raw details attach as `error.stack` and `error.raw` artifacts. Convex wrappers flush those records in `finally`, so failed tools, child actions, generations, and flows reach devtools before the worker can be frozen.

### `@crux/convex/server`

Use the server subpath for Crux-aware Convex function boundaries:

```ts
import { action, internalAction, query, mutation, flow } from '@crux/convex/server'
```

`action()` and `internalAction()` use Convex's native function builders, add a hidden optional `__crux` propagation envelope, pass `ctx.crux` to handlers, restore incoming observability context, and await a bounded flush before returning. Public actions create a Run when no parent context exists; internal actions nest when called through `ctx.crux.runAction()` and create clearly marked standalone internal Runs when invoked directly.

```ts
export const chat = action({
  observabilityName: 'chat',
  observabilityRootPrimitive: 'agent.run',
  observabilityAttributes: { agentId: 'support-chat' },
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return ctx.crux.span({ name: 'chat', family: 'agent', primitive: 'agent.run' }, () => runChatTurn(ctx, args))
  },
})
```

Use `observabilityName`, `observabilityRootPrimitive`, and `observabilityAttributes` on action entrypoints that should appear as semantic runs in devtools, such as chat turns, scheduled agents, and durable task workers. Leave infrastructure-only child actions unnamed and call them through `ctx.crux.runAction(label, ref, args)` so the backend can fold the Convex boundary into the useful presentation tree while still storing the canonical boundary span.

`query()` and `mutation()` are propagation-aware but do not create standalone Runs by default, so normal app reads and writes do not pollute the runtime trace list. Use `ctx.crux.span()` inside them only when a read/write is part of an active AI execution and deserves explicit inspection.

`ctx.crux.runAction(label, ref, args)` records an inspectable `runtime.convex.action` boundary span, flushes that span start before calling the child worker, propagates `__crux`, flushes the boundary end/error before returning to the parent handler, and lets the backend fold infrastructure-only boundaries into nearby semantic operations in the presentation tree. The envelope also carries a boundary id and lease. The parent emits `runtime.convex.boundary.requested`; the receiving Crux-aware action emits `runtime.convex.boundary.received` and `runtime.convex.boundary.completed` / `runtime.convex.boundary.failed` events on that boundary span, so the Go backend can reconcile a missing parent-side `span:end` if Convex freezes, retries, or otherwise loses the caller-side final delivery after the child action completed. If no terminal acknowledgement arrives before the lease expires, the Go backend marks the boundary stale and publishes an `observability.lifecycle` update so clients refetch instead of staying visually running. `ctx.crux.runQuery()` and `ctx.crux.runMutation()` propagate context quietly.

`ctx.crux.scheduler.runAfter(label, delayMs, ref, args)` records the schedule/enqueue operation but does not propagate the active observability context by default. Scheduled work can execute after the parent action has returned, so detached scheduled agents should open their own semantic run through the target `action({ observabilityName, observabilityRootPrimitive })`. Pass `{ observability }` explicitly only for durable continuations that intentionally stored and resume the same run context, such as Convex flow resume actions.

### Runtime Bridge HTTP endpoint

Convex cannot keep a long-lived runtime WebSocket open inside actions. Bind the local-dev Runtime Bridge through the Convex HTTP router instead:

```ts
// convex/http.ts
import { httpRouter } from 'convex/server'
import { setup } from '@crux/convex'
import { components } from './_generated/api'
import { crux } from './crux'

const http = httpRouter()

setup(http, crux, {
  component: components.crux,
})

export default http
```

`setup(http, crux)` registers `GET /crux/bridge`, `POST /crux/bridge`, and `OPTIONS /crux/bridge`. The endpoint speaks the same `@crux/core/runtime-bridge` command contract as local Node WebSocket peers. Passing `component` gives the bridge a request-scoped default CruxStore, so inspectable resources such as `memory:*` and `blackboard:*` can be read from devtools without users manually registering each store. The manifest advertises the actual HTTP Actions URL from the incoming request unless you pass an explicit `url`, and malformed command bodies return structured `command.error` responses instead of uncaught action errors. Those errors include normalized `details` with phase/kind, summary, optional stack, and safe raw data when available. In v1 it is trusted local-dev infrastructure: keep it behind your normal Convex deployment access expectations and do not expose it as an untrusted public RPC surface.

Durable Convex flows are defined with `flow()`:

```ts
const researchFlow = flow({
  name: 'research',
  args: { question: v.string() },
  handler: async (flow, args, ctx) => {
    const plan = await flow.step('plan', () => planResearch(args.question))
    return flow.step('synthesize', () => synthesize(plan))
  },
})

export const research = researchFlow.action
```

The flow handle exposes `.action`, `.handler`, `.args`, and `.signal()`. Public exposure should be app-owned: wrap `.args` and `.handler` in your own public `action()` when you need auth, tenant checks, or rate limits before starting a flow. Direct `.handler()` calls also flush after each run result, so suspended flows such as `plan-approval` show their completed steps and suspended flow status immediately instead of waiting for the outer action to finish unrelated work.

### `createContextHandler(config)`

Low-level context handler for manually assembled [Convex Agent SDK](https://github.com/get-convex/agent) instances. New Crux-native Convex agents should use `crux.convexAgent({ prompt, prepare })`; that path resolves the prompt, memory, skills, tools, and thread context together.

Use `createContextHandler()` only when you intentionally bypass the high-level wrapper and need to adapt already-expanded Crux `Context` objects into a Convex Agent `contextHandler`.

```ts
import { createContextHandler } from '@crux/convex'

const contextHandler = createContextHandler({
  handler: async (ctx, args) => {
    const { threadId, recent } = args
    const isFirstTurn = !recent.some(m => m.role === 'assistant')

    const sessionMemory = createSessionMemory(threadId!, ctx)
    const blackboard = createThreadBlackboard(threadId!, ctx)

    return {
      contexts: [
        currentDate,
        agentProjectContext,
        ...(isFirstTurn ? [assistantMemory.asContext({ priority: 60 })] : []),
        sessionMemory.asContext({ priority: 90 }),
        blackboard.asContext({ priority: 85 }),
        agentCompactionContext,
      ],
      input: {
        lines: await fetchProjectLines(ctx, projectId),
        compactionSummary,
      },
    }
  },
})

// Use with Convex Agent SDK
new Agent(components.agent, { contextHandler, ... })
```

**How it works:**

1. Returns a function matching the Convex Agent `ContextHandler` signature
2. Calls your `handler(ctx, args)` to get contexts + input
3. Calls each context's `.systemFn(input)` in parallel
4. Filters empty strings, joins with `\n\n`
5. Returns `[{ role: 'system', content }, ...allMessages]`

Memory contexts resolve their own data from their backing store — you only need to pass input for custom contexts.

Retrievers fit the same pattern. A typical Convex Agent setup is:

```ts
const contextHandler = createContextHandler({
  handler: async (ctx, args) => {
    const message = String(args.inputPrompt.at(-1)?.content ?? '')
    return {
      contexts: [
        retriever.asContext({
          priority: 60,
          query: ({ message }) => String(message ?? ''),
        }),
        assistantMemory.asContext({ priority: 80 }),
      ],
      input: { message },
    }
  },
})
```

### Crux-aware Convex Agent

Import Convex Agent integrations from `@crux/convex/agent`:

```ts
import { Agent, convexAgent, createAgent, createTool, convexTools, wrapConvexTool } from '@crux/convex/agent'
```

Use `convexAgent()` for new Crux-native Convex Agent code. It accepts a Crux prompt, resolves that prompt on every turn, registers resolved tools with Convex Agent, captures memory after completed turns, and persists activated skills internally through the active Convex Crux store.

```ts
import { createCruxConvex, prompt } from '@crux/convex'
import { memory, recentMessages, workingState } from '@crux/convex/memory'
import { skill } from '@crux/convex/skill'
import { tool } from '@crux/convex/tools'
import { z } from 'zod'
import { components } from './_generated/api'

const draftState = z.object({
  draftId: z.string(),
  goal: z.string().optional(),
})

const editorMemory = memory({
  id: 'editor-memory',
  blocks: [
    recentMessages({ id: 'recent', maxMessages: 12 }),
    workingState({ id: 'draft-state', schema: draftState }),
  ],
})

const copyEditing = skill.inline({
  id: 'copy-editing',
  description: 'Copy editing guidance.',
  instructions: 'Tighten prose, preserve factual claims, and explain material edits.',
})

const searchProject = tool({
  name: 'searchProject',
  description: 'Search project material.',
  input: z.object({ query: z.string() }),
  execute: async ({ input, ctx, target }) => {
    return searchProjectDocuments(ctx, {
      projectId: String(target.projectId),
      query: input.query,
    })
  },
})

const editorPrompt = prompt({
  id: 'editor.agent',
  input: z.object({
    projectId: z.string(),
    instruction: z.string(),
  }),
  use: [editorMemory, copyEditing],
  tools: { searchProject },
  system: ({ input }) => `Project: ${input.projectId}`,
  prompt: ({ input }) => input.instruction,
})

export const crux = createCruxConvex({
  components: {
    crux: components.crux,
    agent: components.agent,
  },
})

export const editorAgent = crux.convexAgent({
  name: 'Editor',
  prompt: editorPrompt,
  model,
})

await editorAgent.streamText(
  ctx,
  { threadId, userId, projectId },
  {
    input: {
      projectId,
      instruction: 'Tighten the introduction.',
    },
  },
)
```

For threaded Convex Agent code, keep the normal Convex Agent flow and let the Crux wrapper prepare the prompt once:

```ts
const { thread } = await editorAgent.continueThread(
  ctx,
  { threadId, userId, projectId },
  {
    input: {
      projectId,
      instruction: 'Tighten the introduction.',
    },
  },
)

await thread.streamText({ stopWhen })
```

Use `prepare` when input or runtime `use[]` entries depend on the Convex Agent thread context:

```ts
const agent = crux.convexAgent({
  name: 'Editor',
  prompt: editorPrompt,
  model,
  prepare: async ({ ctx, target, input, messages }) => {
    const data = await loadTurnData(ctx, {
      threadId: target.threadId,
      userId: target.userId,
      recent: messages?.recent ?? [],
    })

    return {
      input: { ...input, ...data.input },
      use: data.runtimeUse,
      tools: data.tools,
      captureMessages: messages?.recent,
    }
  },
})
```

If `prepare()` returns a prompt override and runtime `use[]`, the runtime entries are composed onto that prompt for the turn. If `memory()` does not receive an explicit namespace, `convexAgent()` defaults it to `thread:${threadId}`. Pass a normal Crux `namespace` when a memory block should be scoped to a project, organization, user, or another durable boundary.

`Agent` keeps the Convex Agent public mental model while wrapping prompt resolution, model calls, and tools. The high-level `convexAgent()` wrapper opens the `agent.run` span before Crux resolves the prompt/use[] stack, so memory reads, retrieval, dynamic tool registration, and generation appear under the agent turn. `thread.generateText()`, `thread.streamText()`, `generateObject()`, and `streamObject()` create canonical `generation.call` / `generation.stream` spans with usage events when the Convex Agent result exposes usage. In Devtools, a useful streamed turn renders as `AGENT Karyla -> GENERATE stream response -> GENERATE step 1 / TOOL research / GENERATE step 2`; redundant single-step stream wrappers are folded as details. Token and cost metadata are normalized from `usage`, `totalUsage`, `cost`, `costUsd`, or `totalCost` so run summaries can display accumulated model spend when providers report it. Streaming generation spans close when the Convex Agent stream call returns, its finish callback fires, or the AI SDK step lifecycle reports a finished step, including `tool-calls` steps. That lifecycle path matters when Convex Agent is still consuming/saving stream deltas after final text, a tool call, a stop-condition tool, or a suspended child flow has already completed. Crux records tool calls from awaited step callbacks and from returned result metadata only when that metadata is already materialized; it never awaits promise-valued returned stream metadata. This keeps stop-condition tool calls such as `askUserQuestion` visible when Convex Agent reports them through the awaited lifecycle while preventing late metadata promises from keeping the generation span or action flush alive. Tool calls create readable labels, and nested delegates, flows, and handoffs inherit the tool span. Wrapped tools flush after completion so nested generation/flow records are delivered before the tool result returns to the Convex Agent loop. If a wrapped tool throws, its `tool.call` span records `phase: "tool.execute"`, `errorKind: "execute_error"`, stack/raw artifacts, and the original error is rethrown to Convex Agent. Interactive tool-call parts that do not execute a handler, such as UI question requests, still appear with `executed: false`. `createTool()` mirrors Convex Agent's `createTool()` and wraps the result automatically. When tools are passed through `Agent`, the object key is the trace label; direct standalone tools can set `title` for the same readable name. Descriptions are for the model, not devtools labels.

For lower-level compatibility, `createAgent()` resolves a Crux prompt or agent definition, wraps the model, infers Crux tools, and returns a Crux-aware Convex Agent:

```ts
const agent = await createAgent(components.agent, supportAgent, {
  name: 'Support',
  input: { locale: 'en' },
  model: languageModel, // optional when the Crux agent definition already has one
})
```

`input` is the typed input used to resolve the Crux prompt/agent definition. User chat input still goes through Convex Agent thread methods such as `thread.generateText()` and `thread.streamText()`.

`convexTools(tools)` remains available to bridge Crux prompt-resolved tools into Convex Agent `createTool()` objects when you assemble tools manually. Use this when a prompt `use`s primitives that auto-contribute tools, such as `blackboard()`. The returned tools are already Crux-observed; pass them to `Agent` as-is rather than wrapping them again.

```ts
import { convexTools } from '@crux/convex/agent'

const board = createThreadBlackboard(threadId, ctx)
const assistant = createAssistantPrompt([board])
const resolved = await assistant.resolve({ input })

const tools = {
  ...businessTools,
  ...convexTools(resolved.tools),
}
```

For `blackboard()`, this exposes the same focused tool names as core:
`readBlackboard`, `writeBlackboard`, `patchBlackboard`, and `clearBlackboard`.

Direct Convex Agent tools created with `createTool()` should be wrapped with
`wrapConvexTool(tool, { name })` so nested delegates, flows, and handoffs inherit
the active tool span and devtools show the human tool name instead of the
provider's `toolCallId`.

```ts
import { wrapConvexTool } from '@crux/convex/agent'

const research = wrapConvexTool(
  createTool({
    description: 'Run delegated research.',
    inputSchema,
    execute: async (toolCtx, args, options) => runResearch(args, options.toolCallId),
  }),
  { name: 'research' },
)
```

### `compactConversation(args)`

Stateless conversation compaction. Takes evicted messages + existing summary, returns a merged summary. Designed for Convex's action-per-message model.

### `createComponentSwarm({ component, generate })` — experimental, from `@crux/convex/swarm`

Run swarm-style agent routing across Convex action boundaries. This is an experimental durable swarm helper, not the final stable Convex swarm contract. It works like `swarm()` but one turn per scheduled action. You provide your `generate` function — the component handles transfer tools, handoff detection, state persistence, and scheduling.

For launch-critical code, keep compositions immediate inside a Crux-aware `action()` or use `flow()` for durable Convex orchestration.

```ts
import { createComponentSwarm } from '@crux/convex/swarm'
import { generate } from '@crux/ai'
import { openai } from '@ai-sdk/openai'
import { components, internal } from './_generated/api'

const model = openai('gpt-4o')

const swarm = createComponentSwarm({
  component: components.crux,
  generate: (prompt, opts) => generate(prompt, { ...opts, model }),
})

// Start:
await swarm.start(ctx, {
  agents: { triage, billing, refunds },
  startAgent: 'triage',
  input: { message },
  resumeAction: internal.swarm.resume,
})

// Resume (scheduled automatically):
await swarm.resume(ctx, swarmRunId, {
  agents: { triage, billing, refunds },
  resumeAction: internal.swarm.resume,
})
```

**Key API:**

- `start(ctx, options)` — creates state, executes first turn, schedules next on handoff
- `resume(ctx, swarmRunId, options)` — loads state, executes one turn, schedules next
- `getState(ctx, swarmRunId)` — returns current swarm state
- `listRuns(ctx, options?)` — lists runs with optional status filter

### `createConvexTransport(config)` — from `@crux/convex/react`

Convex transport for `@crux/react` hooks. Uses Convex's native `useQuery()` for automatic WebSocket-based reactivity — plans, task lists, and tasks stored via `cruxConvexStore()` are reactive with no polling or SSE needed.

```tsx
import { CruxProvider } from '@crux/react'
import { createConvexTransport } from '@crux/convex/react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

const transport = createConvexTransport({
  api: api.crux,  // or components.crux
  useQuery,
})

<ConvexProvider client={convex}>
  <CruxProvider transport={transport}>
    <App />
  </CruxProvider>
</ConvexProvider>
```

The transport reads from the crux Convex component's `memory.get` and `memory.list` queries, deserializing `CruxStore` documents back to `JsonObject` on read. CruxStore documents are serialized with a `{ _cruxDoc: true }` metadata marker.
