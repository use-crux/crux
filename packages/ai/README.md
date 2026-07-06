# @use-crux/ai

Vercel AI SDK adapter for Crux. Runs Crux prompts against any AI SDK `LanguageModel` via `generate()` and `stream()`.

Orchestration — prompt composition, context engineering, memory, tools, routing, safety — lives in [`@use-crux/core`](https://cruxjs.dev/docs/reference/crux-core). This package exports `aiSdkProviderRuntime`, a normal Crux adapter with `ownership: 'loop-owned'` for SDKs that own their own tool loop, and delegates mechanics to AI SDK natives: `stopWhen` for loop budgets, `prepareStep` for mid-loop steering, `experimental_repairText` for cheap JSON repair, native `needsApproval` for tool approvals, `abortSignal` for timeouts. It owns no policy of its own.

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

A prompt with an `output` schema routes through `generateObject` and returns a typed `result.object`, with tiered repair/retry when `validationRetry` is set. Models may be plain or wrapped in core's `fallback()` / `router()` / `cascade()`. Tool loops run up to `maxSteps: 10` by default — identical to every Crux adapter (and unlike the raw AI SDK's single-step default), so prompts behave the same when moved between adapters. Use Crux's portable `toolChoice`, `stopWhen`, `maxSteps()`, and `hasToolCall()` settings for adapter-neutral control; AI SDK-native stop conditions and tool-choice variants belong under the typed `extra` option. `stream()` returns the SDK's stream result extended with a typed `completion` promise (usage, cost, TTFT, tokens/sec). `embedding()` binds AI SDK embedding models as Crux primitives, and `generateObjectFn` / `generateTextFn` satisfy `@use-crux/core` APIs that expect a generate function (e.g. `judge`, `summarizeMessages`, and retrieval recipe model steps). `generateObjectFn` uses the same AI SDK structured-attempt mechanics as prompt structured generation: provider schema sanitation, core-backed `experimental_repairText`, and router/cascade model resolution before returning `{ object }`. If a `GenerateObjectFn` call needs to go through full adapter prompt execution, use `createGenerateObjectFnFromGenerate(generate)` from `@use-crux/core/compaction`.

Streaming structured output uses AI SDK `streamObject()`. In AI SDK v6 that API does not expose the text-loop tool event surface, so Crux omits tools for structured streams and emits a one-time warning when a structured stream declares tools. Use `generate()` for structured tool loops, or stream without an output schema when live tool observability is required.

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
