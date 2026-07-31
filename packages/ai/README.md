# @use-crux/ai

Vercel AI SDK adapter for Crux. Runs Crux prompts against any AI SDK `LanguageModel` via `generate()` and `stream()`.

Orchestration — prompt composition, context engineering, memory, tools, routing, safety — lives in [`@use-crux/core`](https://cruxjs.dev/docs/reference/crux-core). This package exports `aiSdkProviderRuntime`, a normal Crux adapter with `ownership: 'loop-owned'` for SDKs that own their own tool loop, and delegates mechanics to AI SDK natives: `stopWhen` for loop budgets, `prepareStep` for mid-loop steering, `experimental_repairText` for cheap JSON repair, SDK-owned tool approval hooks, `abortSignal` for timeouts. It owns no policy of its own.

Internally, AI SDK request planning and result projection live in a private call-plan codec. The codec prepares `generateText`, `generateObject`, `streamText`, `streamObject`, and cached replay plans; the executor only invokes the selected `SdkGateway` method and decodes or attaches the raw SDK result. `SdkGateway` remains the only runtime seam that calls the `ai` package.

The package exports `aiSdkProviderRuntime` for advanced adapter composition. `createCruxAi({ gateway })` binds `aiSdkProviderRuntime.create(gateway)`, including its embedding and reranking extensions; public integrations should depend on the provider runtime rather than the package's internal executor.

## Install

```sh
pnpm add @use-crux/ai @use-crux/core ai@^6
```

`ai` is a peer dependency (`^6.0.0`). Add a provider package (e.g. `@ai-sdk/openai`) for the models you call. `react` is an optional peer, required only for the `@use-crux/ai/stream` transport.

## Usage

```ts
import { prompt } from "@use-crux/core";
import { generate } from "@use-crux/ai";
import { openai } from "@ai-sdk/openai";

const fixTypos = prompt({
  id: "fix-typos",
  template: ({ instruction }: { instruction: string }) => instruction,
});

const result = await generate(fixTypos, {
  model: openai("gpt-4o"),
  input: { instruction: "Fix typos" },
});

result.text; // string
```

## Managed Eval tasks

Bind production defaults once with `generate.task()` or `stream.task()`. The
result remains an ordinary callable, while `@use-crux/core/eval` can infer its
Case input, semantic output, call options, Variants, and captured capabilities.

```ts
import { generate, stableModel } from "@use-crux/ai";

const support = generate.task(supportPrompt, {
  model: stableModel(openai("gpt-4o-mini")),
  temperature: 0.2,
});

const result = await support({ question: "Can I get a refund?" });
```

`stableModel()` attests that the model's hidden endpoint, middleware, and
provider configuration are stable, so Crux can reuse exact Eval evidence. It
returns the same model with the same inferred type. Standard AI SDK models
derive a key from `provider:modelId`; for custom providers or middleware, pass
a secret-free versioned key and change it whenever hidden behavior changes:

```ts
const customModel = stableModel(createCustomModel(), "acme:support-model:v2");
```

`stableModel()` accepts leaf AI SDK models only. For `router()`, `split()`,
`retry()`, `fallback()`, or `cascade()`, attest each object model leaf; Crux
fingerprints callback-free route-tree structure recursively and records the
resolved model target after execution. Route-tree evidence remains fresh when
that target is not covered at planning; trees with runtime callbacks also run
fresh because source provenance cannot cover closure or ambient state.

Never include API keys, bearer tokens, headers, or other credentials in that
key because it is fingerprint material. An unattested model still runs
normally, but executes fresh and reports `model_identity_unattested` with the
`stableModel(model)` remedy. Crux never guesses identity from constructor
names or function source.

Function-form `prompt`, `system`, and `messages` fields participate in automatic
reuse when their managed task comes from a tracked literal-ESM source closure.
Crux captures a one-way fingerprint of the exact normalized prompt resolved by
the real generate/stream invocation. Only after finding an evidence candidate,
it cheaply renders the same input again and compares fingerprints. A mismatch
runs inference fresh with `nondeterministic_renderer`; raw prompt material never
enters the evidence record. Route environment, time, random, filesystem, or
network state through Case input, call options, or Variants. Non-literal dynamic
imports, CommonJS/generated source, unresolved local imports, or non-portable
outside source run fresh with `unresolved_source_dependency`.

Imported pure-render contexts participate in the same identity proof. Static
contexts, inline skills, and schema-only tools are fingerprinted as data.
Dynamic context renderers, `when()`/`match()` selectors, executable or
function-produced tools, memoized contexts, and
memory/retriever/blackboard/contributor/tool-source entries run fresh because
their effective output or effects are not covered by stable identity.

Managed production tasks should be imported into the Eval. Keeping the task in
its production module lets Crux reuse task evidence across assertion-only and
deterministic-scorer-only Eval edits. Current and replacement Variant imports
are fingerprinted independently, so editing an unselected candidate does not
invalidate Current. An inline managed task runs fresh because Crux cannot
safely separate its source from assessment code.

For feedback on an AI message carrying Crux stream metadata, use the dedicated
server-side helper:

```ts
import { feedback } from "@use-crux/ai/feedback";

const message = await messages.getOwned(messageId, user.id);
if (!message) throw new Response("Not found", { status: 404 });

await feedback(message, "down");
```

The helper extracts the canonical run id and awaits the configured durable
observability destination.

A prompt with an `output` schema routes through `generateObject` and returns a typed `result.object`. Structured output is always validated against the authored schema; `validationRetry` adds tiered repair and re-prompting, and without it an invalid candidate throws `ValidationExhaustedError` rather than being returned. Models may be plain or wrapped in core's `fallback()` / `router()` / `cascade()`. Tool loops run up to `maxSteps: 10` by default — identical to every Crux adapter (and unlike the raw AI SDK's single-step default), so prompts behave the same when moved between adapters. Use Crux's portable `maxTokens`, `topK`, `stopSequences`, `seed`, `toolChoice`, `stopWhen`, `maxSteps()`, `hasToolCall()`, `reasoning`, and `toolApproval` settings for adapter-neutral control; AI SDK-native stop conditions, tool-choice variants, `providerOptions`, headers, retries, and fine-grained provider reasoning controls belong under the typed `extra` option. Tools that declare `contextSchema` require `toolsContext.<toolName>` at the call site, and `runtimeContext` is threaded through tool execution, middleware, and function-form approval policies. `timeout` accepts structured budgets (`totalMs`, `stepMs`, `chunkMs`, `toolMs`, and `tools[name]`) and expired budgets reject with `TimeoutError`. `generate()` returns the canonical Crux envelope: accumulated `text`, optional complete `usage`, optional `cost`, `steps`, `finalStep`, provider-neutral `messages`, retained `_meta`, and typed `.raw` for the AI SDK result. `stream()` returns one managed logical stream — `{ runId, textStream, fullStream, partialOutputStream, completion, cancel, _meta }` — with no `raw`: the AI SDK stream result resolves before terminal Safety and describes only one attempt, so exposing it would bypass guardrail holds, structured occurrence gating, commit gates, and validation retry. Use `toUIMessageStream(result)`, `createUIMessageStreamResponse(result)`, `pipeUIMessageStreamToResponse(result, options)`, or `createTextStreamResponse(result)` for AI SDK `useChat` integration; all four translate the logical `fullStream`, so a discarded attempt is unrepresentable in their input. `embedding()` binds AI SDK embedding models as Crux primitives, and `generateObjectFn` / `generateTextFn` satisfy `@use-crux/core` APIs that expect a generate function (for example, `llmJudge` and retrieval recipe model steps). `generateObjectFn` uses the same AI SDK structured-attempt mechanics as prompt structured generation: provider schema sanitation, core-backed `experimental_repairText`, and router/cascade model resolution before returning `{ object }`.

For `useChat` route handlers, keep the AI SDK message edge native:

```ts
import { convertToModelMessages } from "ai";
import { createUIMessageStreamResponse, stream } from "@use-crux/ai";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = await stream(chatPrompt, {
    model,
    input: { tenantId: "acme" },
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse(result);
}
```

`toParams(resolved, { model })` exposes the AI SDK request-planning codec for
headless power users, and `fromResponse(response)` normalizes an AI SDK
generate result into Crux response facts. These helpers translate only; use
managed `generate()`/`stream()` for Crux-owned tools, approvals, memory,
validation retry, safety, and observability.

`prepare(prompt, opts)` returns a sans-I/O handle over the package's
`SdkGateway` seam: inspect `params`, call the AI SDK yourself, then pass the
raw SDK result to `finish(response)`. Use `generate(prompt, { ...opts,
transport })` when Crux should keep owning the loop and your callback should
make each `SdkGateway` call. Streaming with `transport` is not supported and
rejects with `CruxTransportStreamUnsupportedError`.

Streaming structured output uses AI SDK `streamObject()`. In AI SDK v6 that API does not expose the text-loop tool event surface, so Crux omits tools for structured streams and emits a one-time warning when a structured stream declares tools. Use `generate()` for structured tool loops, or stream without an output schema when live tool observability is required.

## Media

AI SDK `ModelMessage` and `useChat` content stay model-owned. Crux preserves
normal image/audio/video/file parts and ordered mixed assistant output without
adding a second message or tool loop. The package exports native AI SDK
`generateImage()`, `transcribe()`, and `generateSpeech()` wrappers with the
shared Crux result tail, cancellation, timeout, and descriptor-only reporting.
Provider-native controls remain in typed `extra`; persistence is a separate
application `assetStore.put()` call.

The package root is portable across web-standard runtimes. `transcribe()`
accepts bytes, `ArrayBuffer`, `Blob`, data URLs, and data assets without hidden
network I/O. The AI SDK adapter currently rejects provider-file assets before
gateway I/O; hydrate them to bytes first. An HTTPS source that Crux must
materialize fails with `UnsupportedCapabilityError`; provide bytes in a
portable runtime, or use the explicit Node subpath:

```ts
import { transcribe } from "@use-crux/ai/transcription/node";

const result = await transcribe({ model, audio: remoteAudioUrl });
```

The Node subpath uses Crux's bounded, DNS-pinned downloader. It also exports
`createAiSdkTranscribe(gateway)` for custom/test gateways; the package root
keeps gateway injection on `createCruxAi({ gateway })` and does not export a
second transcription creator.

For Anthropic AI SDK models, Crux converts the stable provider-cache prefix into system messages and places `providerOptions.anthropic.cacheControl` on the single `cacheBoundary` block.

## Agent frameworks

Use `@use-crux/ai/agent` when an AI SDK-compatible framework, such as Convex Agent or Mastra, owns the model loop but you still want Crux prompt resolution and tracing:

```ts
import { resolve } from "@use-crux/ai/agent";

const { instructions, model } = await resolve(chatPrompt, {
  model: languageModel,
  input: { mode: "support" },
  tools: Object.keys(tools),
});
```

`@use-crux/ai/agent` composes instructions through the normal core prompt pipeline and adds the AI SDK runtime binding: when Crux execution hooks are installed, the returned model is wrapped with `wrapLanguageModel()` middleware for generate/stream traces, tool timing estimates, stream progress, and provider metadata cost extraction.

## Testing without module mocks

The only module that calls AI SDK functions is the `SdkGateway`. Bind your own with `createCruxAi({ gateway })` to script results in tests — no `vi.mock('ai')`:

```ts
import { createCruxAi } from "@use-crux/ai";

const ai = createCruxAi({ gateway: myScriptedGateway });
const result = await ai.generate(myPrompt, { model, input });
```

For loop-mechanics coverage, pass `MockLanguageModelV3` (from `ai/test`) models through the default live gateway.

AI SDK helpers such as `tool()` are not re-exported — import them from `'ai'` or this package's helper exports as documented. Crux's portable loop helpers (`maxSteps`, `hasToolCall`) come from `@use-crux/core`. Agent compositions come from `@use-crux/core/agent`.

See the [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) and the [Crux docs](https://cruxjs.dev) for the full API.
