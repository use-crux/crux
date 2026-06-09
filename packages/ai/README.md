# @crux/ai

Vercel AI SDK adapter for Crux. Runs Crux prompts, agents, and flows against any AI SDK `LanguageModel` via `generate()` and `stream()`.

Orchestration — prompt composition, context engineering, memory, tools, agents — lives in [`@crux/core`](../core). This package is the binding that executes a resolved prompt through the `ai` package; it owns no orchestration logic of its own.

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

A prompt with an `output` schema routes through `generateObject` and returns a typed `result.object`. Use `stream()` for streaming, `createAIExecutor()` (plus `parallel` / `pipeline` / `consensus` / `swarm`) for agent composition, and `generateObjectFn` / `generateTextFn` to satisfy `@crux/core` APIs that expect a generate function (e.g. `llmJudge`, `summarizeMessages`).

See [@crux/core](../core) and the [Crux docs](https://cruxjs.dev) for the full API.
