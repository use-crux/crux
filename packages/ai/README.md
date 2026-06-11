# @crux/ai

Vercel AI SDK adapter for Crux. Runs Crux prompts against any AI SDK `LanguageModel` via `generate()` and `stream()`.

Orchestration — prompt composition, context engineering, memory, tools, routing, safety — lives in [`@crux/core`](../core). This package implements core's `ExecutorSpec` contract (the adapter port for SDKs that own their own tool loop) and delegates mechanics to AI SDK natives: `stopWhen` for loop budgets, `prepareStep` for mid-loop steering, `experimental_repairText` for cheap JSON repair, native `needsApproval` for tool approvals, `abortSignal` for timeouts. It owns no policy of its own.

## Install

```sh
pnpm add @crux/ai @crux/core ai@^6
```

`ai` is a peer dependency (`^6.0.0`). Add a provider package (e.g. `@ai-sdk/openai`) for the models you call. `react` is an optional peer, required only for the `@crux/ai/stream` transport.

## Usage

```ts
import { prompt } from '@crux/core'
import { generate } from '@crux/ai'
import { openai } from '@ai-sdk/openai'

const fixTypos = prompt({
  id: 'fix-typos',
  template: ({ instruction }: { instruction: string }) => instruction,
})

const result = await generate(fixTypos, {
  model: openai('gpt-4o'),
  input: { instruction: 'Fix typos' },
})

result.text // string
```

A prompt with an `output` schema routes through `generateObject` and returns a typed `result.object`, with tiered repair/retry when `validationRetry` is set. Models may be plain or wrapped in core's `fallback()` / `router()` / `cascade()`. Tool loops run up to `maxSteps: 10` by default — identical to every Crux adapter (and unlike the raw AI SDK's single-step default), so prompts behave the same when moved between adapters; pass `maxSteps` or a custom `stopWhen` to change the budget. `stream()` returns the SDK's stream result extended with a typed `completion` promise (usage, cost, TTFT, tokens/sec). `embedding()` / `reranker()` bind AI SDK embedding and reranking models as Crux primitives, and `generateObjectFn` / `generateTextFn` satisfy `@crux/core` APIs that expect a generate function (e.g. `llmJudge`, `summarizeMessages`).

## Testing without module mocks

The only module that calls AI SDK functions is the `SdkGateway`. Bind your own with `createCruxAi({ gateway })` to script results in tests — no `vi.mock('ai')`:

```ts
import { createCruxAi } from '@crux/ai'

const ai = createCruxAi({ gateway: myScriptedGateway })
const result = await ai.generate(myPrompt, { model, input })
```

For loop-mechanics coverage, pass `MockLanguageModelV3` (from `ai/test`) models through the default live gateway.

AI SDK helpers (`tool`, `stepCountIs`, `hasToolCall`) are not re-exported — import them from `'ai'`. Agent compositions come from `@crux/core/agent`.

See [@crux/core](../core) and the [Crux docs](https://cruxjs.dev) for the full API.
