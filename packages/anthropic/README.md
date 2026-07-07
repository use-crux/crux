# @use-crux/anthropic

Anthropic SDK adapter for Crux. Runs Crux prompts and agents directly against Claude models through the official `@anthropic-ai/sdk` client.

Orchestration — prompt composition, context engineering, memory, tools, agents — lives in [`@use-crux/core`](https://cruxjs.dev/docs/reference/crux-core). This package is the binding: `createAnthropic()` wraps an `Anthropic` client through the `single-turn` `anthropicProviderRuntime` and owns no orchestration logic of its own. It is generation-only; pair it with `embedding()` from `@use-crux/ai` or another provider for retrieval/indexing.

## Install

```sh
pnpm add @use-crux/anthropic @use-crux/core @anthropic-ai/sdk
```

`@anthropic-ai/sdk` is a peer dependency (`>=0.74.0`).

## Usage

```ts
import { prompt } from "@use-crux/core";
import { createAnthropic } from "@use-crux/anthropic";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = createAnthropic(
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
);

const fixTypos = prompt({
  id: "fix-typos",
  template: ({ instruction }: { instruction: string }) => instruction,
});

const result = await anthropic.generate(fixTypos, {
  model: "claude-sonnet-4-5-20250929",
  input: { instruction: "Fix typos" },
});

result.text; // extracted text
result.raw; // raw Anthropic.Message
```

`generate()` returns the canonical Crux envelope: `text`, `object` when present,
optional accumulated `usage`, optional `cost`, `steps`, `finalStep`,
provider-neutral `messages`, typed `raw`, and retained `_meta` for observability.
`usage` is present only when every provider-call step reported usage. `stream()`
returns `{ textStream, raw, completion }`, where `completion` resolves to the
same envelope fields without `raw`/`_meta`.

`createAnthropic()` returns a `CruxAdapter` with `generate()`, `stream()`, and agent composition methods (`parallel`, `pipeline`, `consensus`, `swarm`). Use `createGenerateObjectFn(client, model)` / `createGenerateTextFn(client, model)` to satisfy `@use-crux/core` APIs that expect a generate function (e.g. `llmJudge`, `summarizeMessages`). `createGenerateObjectFn()` is provider-native: it uses Anthropic structured parsing and preserves provider errors, but it does not run Crux prompt resolution, validation retry, safety, cassettes, tools, memory, or instrumentation. Use `createGenerateObjectFnFromGenerate(generate)` from `@use-crux/core/compaction` when a helper call needs full adapter runtime behavior.

The package exports `anthropicProviderRuntime` for advanced adapter composition. Internally, Anthropic uses `defineSingleTurnProviderBundle()` from `@use-crux/core/adapter`; adapter authors building similar single-turn providers should start there.

Crux maps portable `GenerationSettings.toolChoice` values to Anthropic `tool_choice`: `'auto'` → `{ type: 'auto' }`, `'none'` → `{ type: 'none' }`, `'required'` → `{ type: 'any' }`, and `{ tool }` → `{ type: 'tool', name }`. Portable `reasoning` maps to Claude thinking budgets (`low` 2k, `medium` 8k, `high` 24k tokens). `toolApproval` declares portable human-in-the-loop approval policy by tool name at context, prompt, or call site. Tools that declare `contextSchema` require `toolsContext.<toolName>` at the call site, and `runtimeContext` is threaded through tool execution, middleware, and function-form approval policies. `timeout` accepts structured budgets (`totalMs`, `stepMs`, `chunkMs`, `toolMs`, and `tools[name]`) and expired budgets reject with `TimeoutError`. Anthropic-native options that Crux does not model portably belong in the typed `extra` option.

For provider prompt caching, Crux resolves cached contexts into a stable prefix and marks the final cached `SystemBlock` with `cacheBoundary`. This adapter places Anthropic `cache_control: { type: 'ephemeral' }` on that boundary block only.

## Message and Tool-Round Serialization

Anthropic provider-history conversion is owned inside this package. The public `toMessages()` and `fromMessages()` helpers are wrappers over the same codec used by `createAnthropic()` for request messages, assistant tool-call extraction, and second-call tool-loop transcripts.

Anthropic has no native `tool` role, so canonical Crux tool messages become `user` messages with `tool_result` content blocks. Assistant tool calls become ordered `tool_use` blocks alongside optional text. Rich tool outputs keep native Anthropic image and PDF blocks where supported, and unsupported media falls back to deterministic text references.

See the [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) and the [Crux docs](https://cruxjs.dev) for the full API.
