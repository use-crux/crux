# @crux/anthropic

Anthropic SDK adapter for Crux. Runs Crux prompts and agents directly against Claude models through the official `@anthropic-ai/sdk` client.

Orchestration — prompt composition, context engineering, memory, tools, agents — lives in [`@crux/core`](../core). This package is the binding: `createAnthropic()` wraps an `Anthropic` client through `anthropicProviderRuntime` and owns no orchestration logic of its own. It is generation-only; pair it with `embedding()` from `@crux/ai` or another provider for retrieval/indexing.

## Install

```sh
pnpm add @crux/anthropic @crux/core @anthropic-ai/sdk
```

`@anthropic-ai/sdk` is a peer dependency (`>=0.74.0`).

## Usage

```ts
import { prompt } from '@crux/core'
import { createAnthropic } from '@crux/anthropic'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = createAnthropic(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))

const fixTypos = prompt({
  id: 'fix-typos',
  template: ({ instruction }: { instruction: string }) => instruction,
})

const result = await anthropic.generate(fixTypos, {
  model: 'claude-sonnet-4-5-20250929',
  input: { instruction: 'Fix typos' },
})

result.text // extracted text
result.raw // raw Anthropic.Message
```

`createAnthropic()` returns a `CruxAdapter` with `generate()`, `stream()`, and agent composition methods (`parallel`, `pipeline`, `consensus`, `swarm`). Use `createGenerateObjectFn(client, model)` / `createGenerateTextFn(client, model)` to satisfy `@crux/core` APIs that expect a generate function (e.g. `llmJudge`, `summarizeMessages`). `createGenerateObjectFn()` is provider-native: it uses Anthropic structured parsing and preserves provider errors, but it does not run Crux prompt resolution, validation retry, safety, cassettes, tools, memory, or instrumentation. Use `createGenerateObjectFnFromGenerate(generate)` from `@crux/core/compaction` when a helper call needs full adapter runtime behavior.

The package exports `anthropicProviderRuntime` for advanced adapter composition. `createAnthropic` is `anthropicProviderRuntime.create`; adapter authors should use `defineProviderRuntime()` from `@crux/core/adapter`.

## Message and Tool-Round Serialization

Anthropic provider-history conversion is owned inside this package. The public `toMessages()` and `fromMessages()` helpers are wrappers over the same codec used by `createAnthropic()` for request messages, assistant tool-call extraction, and second-call tool-loop transcripts.

Anthropic has no native `tool` role, so canonical Crux tool messages become `user` messages with `tool_result` content blocks. Assistant tool calls become ordered `tool_use` blocks alongside optional text. Rich tool outputs keep native Anthropic image and PDF blocks where supported, and unsupported media falls back to deterministic text references.

See [@crux/core](../core) and the [Crux docs](https://cruxjs.dev) for the full API.
