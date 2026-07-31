# @use-crux/convex

Convex component and adapters for Crux persistence and agent integration.

For the full guide, see the [Convex documentation](https://cruxjs.dev).

## Install

```bash
pnpm add @use-crux/convex @use-crux/core convex
```

## Component setup

Install the crux Convex component for automatic persistence (memory records, experimental swarm state, and more in the future):

```ts
// convex/convex.config.ts
import crux from "@use-crux/convex/convex.config";
const app = defineApp();
app.use(crux);
```

## Convex profile imports

`@use-crux/convex` is a Convex runtime profile for normal Crux APIs. Prefer the mirrored Convex subpaths when authoring Crux primitives for Convex code:

```ts
import { createCruxConvex, prompt } from "@use-crux/convex";
import { context } from "@use-crux/convex/context";
import { memory, recentMessages, workingState } from "@use-crux/convex/memory";
import { knowledgeBase, retrievalRecipe } from "@use-crux/convex/retrieval";
import { skill } from "@use-crux/convex/skill";
import { tool } from "@use-crux/convex/tools";
```

The mirrored subpaths intentionally stay close to `@use-crux/core`:

| Import                        | Classification       | Notes                                                                                                            |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@use-crux/convex/context`    | Identical re-export  | Re-exports core context helpers.                                                                                 |
| `@use-crux/convex/skill`      | Identical re-export  | Re-exports edge-safe core skill helpers.                                                                         |
| `@use-crux/convex/skill/node` | Node-only re-export  | Re-exports core Node file skill helpers for local SKILL.md loading.                                              |
| `@use-crux/convex/memory`     | Convex-bound drop-in | Same block API; `memory()` late-binds the active Convex Crux store and defaults to the current thread namespace. |
| `@use-crux/convex/retrieval`  | Convex-bound drop-in | Same Retrieval/RAG beta API; `knowledgeBase()` and store-backed `retriever()` late-bind active Convex storage.   |
| `@use-crux/convex/tools`      | Convex-bound drop-in | Same tool authoring shape; `execute()` receives Convex runtime metadata.                                         |
| `convexAgent()`               | Convex-only API      | Profile-backed helper that resolves a Crux prompt per Convex Agent turn.                                         |
| `createCruxConvex()`          | Convex-only API      | Creates a reusable Convex runtime profile from `components.crux` and `components.agent`.                         |

Avoid split imports inside Convex files when a Convex profile exists. For example, import memory blocks from `@use-crux/convex/memory`, not `memory` from `@use-crux/convex/memory` plus `recentMessages` from `@use-crux/core/memory`.

The package root is curated. It exports Convex APIs plus common prompt authoring helpers (`prompt`, `context`, `createPrompts`, `createContexts`, and sanitization helpers), but it does not blanket re-export every `@use-crux/core` API. If a Convex mirror exists, prefer it; if no mirror exists yet, import the SDK-agnostic primitive from `@use-crux/core`.

## Exports

### `createCruxConvex(options)`

Create a reusable Convex runtime profile around the Crux Convex component and Convex Agent component:

```ts
import { createCruxConvex } from "@use-crux/convex";
import { components } from "./_generated/api";

export const crux = createCruxConvex({
  components: {
    crux: components.crux,
    agent: components.agent,
  },
});
```

The profile exposes:

- `storage(ctx)` for request-scoped Crux storage
- `run(ctx, target, fn)` for lower-level work with request-scoped storage/runtime bound
- `convexAgent(config)` for profile-backed Crux prompt lifecycle wiring without repeating component wiring
- `bridge(http, cruxConfig, options?)` for devtools bridge setup through the same storage path

Use `run()` when app code needs lower-level Crux work inside a Convex action:

```ts
await crux.run(ctx, { threadId }, async ({ records }) => {
  await records.put(`blackboard:${threadId}`, { status: "ready" });
});
```

`run()` is the owning Convex lifecycle boundary: it preserves the application
result or error and awaits one bounded terminal observability flush before the
action settles. Prefer it over manually combining request-scoped storage,
runtime binding, and low-level flush helpers.

Advanced apps can override storage construction once at the profile boundary. The custom factory receives typed defaults and feeds `run()`, profile-created agents, and `crux.bridge()`:

```ts
export const crux = createCruxConvex({
  components: { crux: components.crux, agent: components.agent },
  storage: {
    create(ctx, defaults) {
      return defaults.createComponentStorage(ctx);
    },
  },
});
```

Profile-backed agent calls through `convexAgent()` install the runtime automatically.

### Runtime Engine host

Use `convex()` in `crux.config.ts` to declare Convex as the durable Runtime
Engine host. The declaration is host-bound: runtime work executes inside
generated or hand-written Convex functions, not from ordinary Node processes.

```ts
import { config } from "@use-crux/core";
import { convex } from "@use-crux/convex/runtime";

export default config({
  runtime: convex(),
});
```

Generated Convex runtime files split isolate-safe control handlers from Node target execution:

```ts title="convex/_crux/generated.ts"
import { makeFunctionReference } from "convex/server";
import { createConvexRuntimeHandlers } from "@use-crux/convex/runtime";
import { components } from "../_generated/api";

const targetExecutor = makeFunctionReference<
  "action",
  { envelope: unknown },
  unknown
>("_crux/targets:executeTarget");

export const { handleWake, deliverSignal, resumeFlow, runTask, fireTimer } =
  createConvexRuntimeHandlers({
    component: components.crux,
    targetExecutor,
  });
```

```ts title="convex/_crux/targets.ts"
"use node";

import { createConvexRuntimeTargetExecutor } from "@use-crux/convex/runtime/node";
import { components } from "../_generated/api";
import { reviewFlow } from "../../src/review";

export const { executeTarget } = createConvexRuntimeTargetExecutor({
  component: components.crux,
  targets: [reviewFlow],
});
```

When no app router exists, `crux runtime generate` writes `convex/http.ts`. It
mounts the separately authenticated Eval host at `/manifest`, `/jobs`, and
`/jobs/:id`, which is why `CONVEX_SITE_URL` can be used directly as the inferred
Eval host URL. The routes delegate to
a real default-runtime HTTP action, which forwards a byte-preserving envelope
through `ctx.runAction()` to the generated Node action. The dedicated bearer
remains in the HTTP `Authorization` header.

If the app already calls `crux.bridge(http, cruxConfig)` on its exported router,
no router change is needed: the bridge registers the Eval routes and generation
preserves `convex/http.ts` byte-for-byte. Crux still writes
`convex/_crux/http.ts` for apps that do not use the bridge. In that case, import
`registerCruxEvalRoutes` from the helper and call it once with the existing
router. Do not compose both paths on the same router.

Convex runtime execution is fencing-only. The host bindings disable in-process
lease heartbeat timers and rely on `LEASE_LOST` fencing plus a lease TTL sized
for the longest expected target action.

The same selected Runtime executes host-required Evals from the generated
registry. The Node coordinator uses `CONVEX_SITE_URL` for the HTTP endpoint and
`CONVEX_URL` for the deployment identity; the deployed host receives the same
identity as `CONVEX_CLOUD_URL`. Set the dedicated bearer only in
`CRUX_EVAL_HOST_TOKEN`. Explicit `CRUX_EVAL_HOST_URL` and
`CRUX_EVAL_HOST_DEPLOYMENT_ID` override inference. The authenticated manifest
must match the expected deployment before any paid work begins.

Do not put the bearer in `crux.config.ts`, generated Convex files, CLI
arguments, plans, logs, or fingerprints. Crux uses one selected deployment per
invocation and never silently falls back to another.

### Storage Beta adapters

Use `convexRecordStore()` and `convexStorage()` for component-backed Crux records. `convexStorage()` can also include explicitly configured Convex file assets; it does not provide vector search.

```ts
import { convexRecordStore } from "@use-crux/convex";
import { memory, workingState } from "@use-crux/convex/memory";
import { components } from "./_generated/api";

const records = convexRecordStore({
  component: components.crux,
  ctx,
});

const state = workingState({ id: "state", schema });
const assistantMemory = memory({
  id: "assistant",
  records,
  namespace: "thread:1",
  blocks: [state],
});
```

`convexRecordStore()` exposes `get`, `put`, `create`, `delete`, and `list`. Record values with an `embedding` array mirror it to the top-level Convex document field, but the bundled component does not declare a vector index or perform vector search.

The component boundary is page-shaped. `components.crux.memory.list` accepts
`prefix`, `limit`, and `cursor`, reads the `by_key` index, and returns
`{ docs, cursor }`. The adapters own `_cruxDoc` decoding, TTL
suppression and lazy cleanup, and top-level decoded-value filters. When a
filtered `list()` call has a `limit`, the record store reads
additional component pages until it can return up to that many matching entries.

Advanced tests and alternate runtimes can substitute the component boundary
without running Convex. Use `createInMemoryConvexStoreDocumentComponent()` when
server writes and React reads should share one local backing record set:

```ts
import {
  convexRecordStore,
  createConvexTransport,
  createInMemoryConvexStoreDocumentComponent,
} from "@use-crux/convex";

const component = createInMemoryConvexStoreDocumentComponent();
const records = convexRecordStore({ component, ctx: component.ctx });
const transport = createConvexTransport({
  api: component.refs,
  useQuery: component.useQuery,
});

await records.put("memory:alpha", { content: "Alpha", namespace: "kb" });

transport.useDocument("memory:alpha");
```

Use `ComponentDocumentPort` or `convexComponentDocumentPort()` only when you need
to test or replace the raw document I/O layer directly. App code should usually
use `convexRecordStore({ component: components.crux, ctx })` or `convexStorage({ component: components.crux, ctx })`.

For semantic response caching, pair Convex records with an explicit pre-filter-capable vector backend in a dedicated namespace:

```ts
import { createSemanticCache } from "@use-crux/core/cache";
import { convexRecordStore } from "@use-crux/convex";
import { upstashVectorStore } from "@use-crux/upstash";

const cache = createSemanticCache({
  records: convexRecordStore({ component: components.crux, ctx }),
  vectors: upstashVectorStore({
    index: vectorIndex,
    namespace: "semantic-cache",
  }),
  embedding,
  ttl: 60_000,
});
```

Semantic cache lookup needs a dedicated vector space so unrelated vectors cannot crowd out cache entries before filtering.

### Storage Beta

Use `convexStorage()` when a Crux primitive expects a Storage Beta capability
bundle:

```ts
import { convexStorage } from "@use-crux/convex";

const storage = convexStorage({
  component: components.crux,
  ctx,
});
```

`convexRecordStore()` exposes component-backed JSON records with lazy TTL and
scan-backed exact filters. `convexStorage()` contains `records` and only adds
`assets` when configured explicitly. Memory blocks without an explicit
`VectorStore` fall back to record listing/recency for recall.

`convexVectorStore()` remains temporarily as a compatibility symbol. It throws
`StorageError('unsupported_capability')` at construction with guidance to pass
an explicit `VectorStore`, such as `upstashVectorStore()`.

### `convexAssetStore(config)`

Asset storage for `workspace()` binary and oversized files.

```ts
import { workspace } from "@use-crux/core/workspace";
import { storage } from "@use-crux/core/storage";
import { convexRecordStore, convexAssetStore } from "@use-crux/convex";

const records = convexRecordStore({ component: components.crux, ctx });

const ws = workspace({
  id: "thread-workspace",
  namespace: threadId,
  storage: storage({
    records,
    assets: convexAssetStore({ ctx }),
  }),
});
```

Workspace metadata stays in the Convex-backed `RecordStore`. Binary and large payloads go through Convex file storage. If the current Convex runtime cannot read assets, `get()` throws `StorageError('unsupported_capability')`. Missing assets throw `StorageError('not_found')`. Use a custom `AssetStore` for S3, R2, GCS, local disk, or another app-owned file service.

### Observability helpers

Convex actions run in serverless workers that can be torn down immediately after a handler returns. Use the observability helpers to flush queued canonical graph records before that happens:

```ts
import { withObservabilityFlush } from "@use-crux/convex/observability";

export const run = internalAction({
  args: {},
  handler: withObservabilityFlush(async (ctx, args) => {
    // Crux work here
  }),
});
```

`flushObservability({ timeoutMs })` is also exported for explicit shutdown paths. It defaults to a 3s bounded wait so large fanout traces finish delivering before Convex freezes a warm worker. `createCruxConvex().run()`, `@use-crux/convex/server` `action()`, and `internalAction()` flush automatically by default; pass `observabilityFlushTimeoutMs: false` only when an outer boundary already flushes.

Thrown errors use the same evidence contract as core Crux: terminal spans keep a compact error summary, failing spans emit an `exception` event, and stack/raw details attach as `error.stack` and `error.raw` artifacts. Convex wrappers flush those records in `finally`, so failed tools, child actions, generations, and flows reach devtools before the worker can be frozen.

### `@use-crux/convex/server`

Use the server subpath for Crux-aware Convex function boundaries:

```ts
import {
  action,
  internalAction,
  query,
  mutation,
  flow,
} from "@use-crux/convex/server";
```

`action()` and `internalAction()` use Convex's native function builders, add a hidden optional `__crux` propagation envelope, pass `ctx.crux` to handlers, restore incoming observability context, and await a bounded flush before returning. Public actions create a Run when no parent context exists; internal actions nest when called through `ctx.crux.runAction()` and create clearly marked standalone internal Runs when invoked directly.

```ts
export const chat = action({
  observabilityName: "chat",
  observabilityRootPrimitive: "agent.run",
  observabilityAttributes: { agentId: "support-chat" },
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return ctx.crux.span({ name: "chat", primitive: "agent.run" }, () =>
      runChatTurn(ctx, args),
    );
  },
});
```

Use `observabilityName`, `observabilityRootPrimitive`, and `observabilityAttributes` on action entrypoints that should appear as semantic runs in devtools, such as chat turns, scheduled agents, and durable task workers. Leave infrastructure-only child actions unnamed and call them through `ctx.crux.runAction(label, ref, args)` so the backend can fold the Convex boundary into the useful presentation tree while still storing the canonical boundary span.

`query()` and `mutation()` are propagation-aware but do not create standalone Runs by default, so normal app reads and writes do not pollute the runtime trace list. Use `ctx.crux.span()` inside them only when a read/write is part of an active AI execution and deserves explicit inspection.

`ctx.crux.runAction(label, ref, args)` records an inspectable `runtime.convex.action` boundary span, flushes that span start before calling the child worker, propagates `__crux`, flushes the boundary end/error before returning to the parent handler, and lets the backend fold infrastructure-only boundaries into nearby semantic operations in the presentation tree. The envelope also carries a boundary id and lease. The parent emits `runtime.convex.boundary.requested`; the receiving Crux-aware action emits `runtime.convex.boundary.received` and `runtime.convex.boundary.completed` / `runtime.convex.boundary.failed` events on that boundary span, so the Go backend can reconcile a missing parent-side `span:end` if Convex freezes, retries, or otherwise loses the caller-side final delivery after the child action completed. If no terminal acknowledgement arrives before the lease expires, the Go backend marks the boundary stale and publishes an `observability.lifecycle` update so clients refetch instead of staying visually running. `ctx.crux.runQuery()` and `ctx.crux.runMutation()` propagate context quietly.

`ctx.crux.scheduler.runAfter(label, delayMs, ref, args)` records the schedule/enqueue operation but does not propagate the active observability context by default. Scheduled work can execute after the parent action has returned, so detached scheduled agents should open their own semantic run through the target `action({ observabilityName, observabilityRootPrimitive })`. Pass `{ observability }` explicitly only for durable continuations that intentionally stored and resume the same run context, such as Convex flow resume actions.

### Runtime Bridge HTTP endpoint

Convex cannot keep a long-lived runtime WebSocket open inside actions. Bind the local-dev Runtime Bridge through the Convex HTTP router instead:

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { setup } from "@use-crux/convex";
import { components } from "./_generated/api";
import { crux } from "./crux";

const http = httpRouter();

setup(http, crux, {
  component: components.crux,
});

export default http;
```

`setup(http, crux)` registers `GET /crux/bridge`, `POST /crux/bridge`, and `OPTIONS /crux/bridge`. The endpoint speaks the same `@use-crux/core/runtime-bridge` command contract as local Node WebSocket peers. Passing `component` gives the bridge request-scoped default storage, so inspectable resources such as `memory:*` and `blackboard:*` can be read from devtools without users manually registering each store. If you already use `createCruxConvex()`, prefer `profile.bridge(http, cruxConfig)` so bridge reads use the same profile storage path as agents and `run()`. The manifest advertises the actual HTTP Actions URL from the incoming request unless you pass an explicit `url`, and malformed command bodies return structured `command.error` responses instead of uncaught action errors. Those errors include normalized `details` with phase/kind, summary, optional stack, and safe raw data when available. In v1 it is trusted local-dev infrastructure: keep it behind your normal Convex deployment access expectations and do not expose it as an untrusted public RPC surface.

Durable Convex flows are defined with `flow()`:

```ts
const researchFlow = flow({
  name: "research",
  args: { question: v.string() },
  handler: async (flow, args, ctx) => {
    const plan = await flow.step("plan", () => planResearch(args.question));
    return flow.step("synthesize", () => synthesize(plan));
  },
});

export const research = researchFlow.action;
```

The flow handle exposes `.action`, `.handler`, `.args`, and `.signal()`. Public exposure should be app-owned: wrap `.args` and `.handler` in your own public `action()` when you need auth, tenant checks, or rate limits before starting a flow. Direct `.handler()` calls also flush after each run result, so suspended flows such as `plan-approval` show their completed steps and suspended flow status immediately instead of waiting for the outer action to finish unrelated work.

Convex flows can declare the same local `signals` map as core flows. Declared signal schemas type `scope.suspend()` and `flowHandle.signal()`, and `.signal()` validates payloads before writing the pending signal or scheduling the resume action.

### `createContextHandler(config)`

Low-level context handler for manually assembled [Convex Agent SDK](https://github.com/get-convex/agent) instances. Profile-backed Crux prompt agents should use `crux.convexAgent({ prompt, prepare })`; that path resolves the prompt, memory, skills, tools, and thread context together. Normal Convex Agent-shaped code can use `Agent`, `convexTools()`, or this handler directly.

Use `createContextHandler()` only when you intentionally bypass the high-level wrapper and need to adapt already-expanded Crux `Context` objects into a Convex Agent `contextHandler`.

```ts
import { createContextHandler } from '@use-crux/convex'

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
import { messageText } from "@use-crux/convex";

const contextHandler = createContextHandler({
  handler: async (ctx, args) => {
    const lastMessage = args.inputPrompt.at(-1);
    const message = lastMessage ? messageText(lastMessage) : "";
    return {
      contexts: [
        retriever.asContext({
          priority: 60,
          query: ({ message }) => String(message ?? ""),
        }),
        assistantMemory.asContext({ priority: 80 }),
      ],
      input: { message },
    };
  },
});
```

### Crux-aware Convex Agent

Import Convex Agent integrations from `@use-crux/convex/agent`:

```ts
import {
  Agent,
  convexAgent,
  createAgent,
  createTool,
  convexTools,
  wrapConvexTool,
} from "@use-crux/convex/agent";
```

Use `Agent` when you want the normal `@convex-dev/agent` constructor and method shape with Crux tool/runtime propagation and observability. It subclasses Convex Agent, wraps tools passed through `tools`, and forwards `generateText()`, `streamText()`, `generateObject()`, and `streamObject()` arguments to the upstream Agent.

```ts
import { Agent, convexTools } from "@use-crux/convex/agent";

const resolved = await supportPrompt.resolve({ input });

const support = new Agent(components.agent, {
  name: "Support",
  languageModel: model,
  instructions: resolved.system,
  tools: convexTools(resolved.tools),
});
```

Use `convexAgent()` or `crux.convexAgent()` when you want Crux to own the profile-backed prompt lifecycle. It accepts a Crux prompt, resolves that prompt on every turn, registers resolved tools with Convex Agent, captures memory after completed turns, and persists activated skills internally through active Convex records.

`convexAgent()` keeps calls shaped like Convex Agent (`generateText()`, `streamText()`, `generateObject()`, `streamObject()`, and `continueThread()`), while an internal Crux-owned lifecycle binds request-scoped storage, runs `crux.prepare()`, resolves prompt `use[]`, adapts Crux and direct Convex Agent tools, persists skills, captures memory, and records observability around the turn.

Use `languageModel` to match Convex Agent terminology.
The exported `ConvexAgentConfig` type encodes that requirement through `ConvexAgentModelConfig`, while `ConvexAgentBaseConfig` describes the non-model options for profile wrappers.

```ts
import { openai } from "@ai-sdk/openai";
import { createCruxConvex, prompt } from "@use-crux/convex";
import { memory, recentMessages, workingState } from "@use-crux/convex/memory";
import { skill } from "@use-crux/convex/skill";
import { tool } from "@use-crux/convex/tools";
import { z } from "zod";
import { components } from "./_generated/api";

const model = openai("gpt-4o");

const draftState = z.object({
  draftId: z.string(),
  goal: z.string().optional(),
});

const editorMemory = memory({
  id: "editor-memory",
  blocks: [
    recentMessages({ id: "recent", maxMessages: 12 }),
    workingState({ id: "draft-state", schema: draftState }),
  ],
});

const copyEditing = skill.inline({
  id: "copy-editing",
  description: "Copy editing guidance.",
  instructions:
    "Tighten prose, preserve factual claims, and explain material edits.",
});

const searchProject = tool({
  name: "searchProject",
  description: "Search project material.",
  input: z.object({ query: z.string() }),
  execute: async ({ input, ctx, target }) => {
    return searchProjectDocuments(ctx, {
      projectId: String(target.projectId),
      query: input.query,
    });
  },
});

const editorPrompt = prompt({
  id: "editor.agent",
  input: z.object({
    projectId: z.string(),
    instruction: z.string(),
  }),
  use: [editorMemory, copyEditing],
  tools: { searchProject },
  system: ({ input }) => `Project: ${input.projectId}`,
  prompt: ({ input }) => input.instruction,
});

export const crux = createCruxConvex({
  components: {
    crux: components.crux,
    agent: components.agent,
  },
});

export const editorAgent = crux.convexAgent({
  name: "Editor",
  prompt: editorPrompt,
  languageModel: model,
  crux: {
    prepare: async ({ ctx, target, input, messages }) => {
      const data = await loadTurnData(ctx, {
        threadId: target.threadId,
        userId: target.userId,
        recent: messages?.recent ?? [],
      });

      return {
        input: { ...input, ...data.input },
        use: data.runtimeUse,
        tools: data.tools,
        captureMessages: messages?.recent,
      };
    },
  },
});

await editorAgent.streamText(
  ctx,
  { threadId, userId, projectId },
  {
    input: {
      projectId,
      instruction: "Tighten the introduction.",
    },
  },
);
```

For threaded Convex Agent code, keep the normal Convex Agent flow and let the Crux wrapper prepare the prompt once:

```ts
const { thread } = await editorAgent.continueThread(ctx, {
  threadId,
  userId,
  projectId,
});

await thread.streamText({
  input: {
    projectId,
    instruction: "Tighten the introduction.",
  },
  stopWhen,
});
```

Structured prompts use the same lifecycle. When a prompt declares `output`, Crux injects the resolved schema into Convex Agent object calls:

```ts
const metadataPrompt = prompt({
  id: "editor.metadata",
  input: z.object({ projectId: z.string(), instruction: z.string() }),
  output: z.object({ title: z.string() }),
  prompt: ({ input }) => input.instruction,
});

const metadataAgent = crux.convexAgent({
  name: "Editor Metadata",
  prompt: metadataPrompt,
  languageModel: model,
});

const result = await metadataAgent.generateObject(
  ctx,
  { threadId, userId },
  {
    input: {
      projectId,
      instruction: "Suggest a title.",
    },
  },
);
```

Use `crux.prepare` when input or runtime `use[]` entries depend on the Convex Agent thread context. If `crux.prepare()` returns a prompt override and runtime `use[]`, the runtime entries are composed onto that prompt for the turn. If `memory()` does not receive an explicit namespace, `convexAgent()` defaults it to `thread:${threadId}`. Pass `crux.runtime.namespace` when a memory block should be scoped to a project, organization, user, or another durable boundary. Use `crux.observe` to customize or disable the profile `agent.run` span, and `crux.persistence` to disable best-effort skill or memory persistence for specialized agents.

`Agent` keeps the Convex Agent public mental model while wrapping prompt resolution, model calls, and tools. The high-level `convexAgent()` wrapper opens the `agent.run` span before Crux resolves the prompt/use[] stack, so memory reads, retrieval, dynamic tool registration, and generation appear under the agent turn. `thread.generateText()`, `thread.streamText()`, `generateObject()`, and `streamObject()` create canonical `generation.call` / `generation.stream` spans with usage events when the Convex Agent result exposes usage. In Devtools, a useful streamed turn renders as `AGENT Support Agent -> GENERATE stream response -> GENERATE step 1 / TOOL research / GENERATE step 2`; redundant single-step stream wrappers are folded as details. Token and cost metadata are normalized from `usage`, `totalUsage`, `cost`, `costUsd`, or `totalCost` so run summaries can display accumulated model spend when providers report it. Streaming generation spans close when the Convex Agent stream call returns, its finish callback fires, or the AI SDK step lifecycle reports a finished step, including `tool-calls` steps. That lifecycle path matters when Convex Agent is still consuming/saving stream deltas after final text, a tool call, a stop-condition tool, or a suspended child flow has already completed. Crux records tool calls from awaited step callbacks and from returned result metadata only when that metadata is already materialized; it never awaits promise-valued returned stream metadata. This keeps stop-condition tool calls such as `askUserQuestion` visible when Convex Agent reports them through the awaited lifecycle while preventing late metadata promises from keeping the generation span or action flush alive. Tool calls create readable labels, and nested delegates, flows, and handoffs inherit the tool span. Wrapped tools flush after completion so nested generation/flow records are delivered before the tool result returns to the Convex Agent loop. If a wrapped tool throws, its `tool.call` span records `phase: "tool.execute"`, `errorKind: "execute_error"`, stack/raw artifacts, and the original error is rethrown to Convex Agent. Interactive tool-call parts that do not execute a handler, such as UI question requests, still appear with `executed: false`. `createTool()` mirrors Convex Agent's `createTool()` and wraps the result automatically. When tools are passed through `Agent`, the object key is the trace label; direct standalone tools can set `title` for the same readable name. Descriptions are for the model, not devtools labels.

For manual lower-level wiring, `createAgent()` resolves a Crux prompt or agent definition, wraps the model, infers Crux tools, and returns a Crux-aware Convex Agent:

```ts
const agent = await createAgent(components.agent, supportAgent, {
  name: "Support",
  input: { locale: "en" },
  model: languageModel, // optional when the Crux agent definition already has one
});
```

`input` is the typed input used to resolve the Crux prompt/agent definition. User chat input still goes through Convex Agent thread methods such as `thread.generateText()` and `thread.streamText()`.

`convexTools(tools)` remains available to bridge Crux prompt-resolved tools into Convex Agent `createTool()` objects when you assemble tools manually. Use this when a prompt `use`s primitives that auto-contribute tools, such as `blackboard()`. The returned tools are already Crux-observed; pass them to `Agent` as-is rather than wrapping them again.

```ts
import { convexTools } from "@use-crux/convex/agent";

const board = createThreadBlackboard(threadId, ctx);
const assistant = createAssistantPrompt([board]);
const resolved = await assistant.resolve({ input });

const tools = {
  ...businessTools,
  ...convexTools(resolved.tools),
};
```

For `blackboard()`, this exposes the same focused tool names as core:
`readBlackboard`, `writeBlackboard`, `patchBlackboard`, and `clearBlackboard`.

Direct Convex Agent tools created with `createTool()` should be wrapped with
`wrapConvexTool(tool, { name })` so nested delegates, flows, and handoffs inherit
the active tool span and devtools show the human tool name instead of the
provider's `toolCallId`.

```ts
import { wrapConvexTool } from "@use-crux/convex/agent";

const research = wrapConvexTool(
  createTool({
    description: "Run delegated research.",
    inputSchema,
    execute: async (toolCtx, args, options) =>
      runResearch(args, options.toolCallId),
  }),
  { name: "research" },
);
```

### `createComponentSwarm({ component, generate })` — experimental, from `@use-crux/convex/swarm`

Run swarm-style agent routing across Convex action boundaries. This is an experimental durable swarm helper, not the final stable Convex swarm contract. It works like `swarm()` but one turn per scheduled action. You provide your `generate` function — the component handles transfer tools, handoff detection, state persistence, and scheduling.

For launch-critical code, keep compositions immediate inside a Crux-aware `action()` or use `flow()` for durable Convex orchestration.

```ts
import { createComponentSwarm } from "@use-crux/convex/swarm";
import { generate } from "@use-crux/ai";
import { openai } from "@ai-sdk/openai";
import { components, internal } from "./_generated/api";

const model = openai("gpt-4o");

const swarm = createComponentSwarm({
  component: components.crux,
  generate: (prompt, opts) => generate(prompt, { ...opts, model }),
});

// Start:
await swarm.start(ctx, {
  agents: { triage, billing, refunds },
  startAgent: "triage",
  input: { message },
  resumeAction: internal.swarm.resume,
});

// Resume (scheduled automatically):
await swarm.resume(ctx, swarmRunId, {
  agents: { triage, billing, refunds },
  resumeAction: internal.swarm.resume,
});
```

**Key API:**

- `start(ctx, options)` — creates state, executes first turn, schedules next on handoff
- `resume(ctx, swarmRunId, options)` — loads state, executes one turn, schedules next
- `getState(ctx, swarmRunId)` — returns current swarm state
- `listRuns(ctx, options?)` — lists runs with optional status filter

### React transport

Use `createConvexTransport()` for `@use-crux/react` hooks. Convex's native `useQuery()` gives plans, task lists, and tasks automatic WebSocket-based reactivity with no polling or SSE needed.

```tsx
import { CruxProvider } from '@use-crux/react'
import { createConvexTransport } from '@use-crux/convex'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

const transport = createConvexTransport({ api: api.crux, useQuery })

<ConvexProvider client={convex}>
  <CruxProvider transport={transport}>
    <App />
  </CruxProvider>
</ConvexProvider>
```

The transport reads from the crux Convex component's `memory.get` and page-shaped `memory.list` queries, deserializing current Crux store documents back to `JsonObject` on read. `useDocumentList()` consumes `{ docs, cursor }` and applies decoded-value filters locally instead of passing them into the Convex component query.

## Media

Convex Agent media stays AI SDK-native across file storage, thread reloads,
tool continuation, and UI messages; Crux does not duplicate those writes. The
package re-exports the Crux AI `generateImage`, `transcribe`, and
`generateSpeech` functions by exact identity. Specialized results are not
automatically written to Convex storage—call the chosen `AssetStore` explicitly
when durable reuse is required.
