# @use-crux/openai

OpenAI SDK adapter for Crux. Wraps an `OpenAI` client so Crux prompts and agents run against OpenAI models — prompt composition, context engineering, memory, and flows all live in [`@use-crux/core`](https://cruxjs.dev/docs/reference/crux-core); this package is a `single-turn` provider runtime and owns only the OpenAI wire boundary.

## Install

```bash
pnpm add @use-crux/openai @use-crux/core openai
```

`openai` (`^5.0.0 || ^6.0.0`) is a peer dependency.

## Usage

```ts
import { prompt } from "@use-crux/core";
import { createOpenAI } from "@use-crux/openai";
import OpenAI from "openai";
import { z } from "zod";

const openai = createOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

const fixTypos = prompt({
  id: "fix-typos",
  input: z.object({ instruction: z.string() }),
  prompt: ({ input }) => input.instruction,
});

const result = await openai.generate(fixTypos, {
  model: "gpt-4o",
  input: { instruction: "Fix typos in this draft." },
});

result.text; // extracted text
result.raw; // raw ChatCompletion
result.usage; // accumulated usage when every provider step reported it
result.finalStep; // text, usage, finish reason, response id, and actual model for the final step
```

Pass media in the normal message list. Crux validates it after prompt resolution
and lowers it to OpenAI content parts before each SDK call:

```ts
const describeChart = prompt({ id: "describe-chart" });

await openai.generate(describeChart, {
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What changed?" },
        { type: "image", source: new URL("https://example.com/chart.png") },
      ],
    },
  ],
});
```

Images accept HTTPS/data URLs, bytes, `Blob`, or usable assets. Files accept
data or an OpenAI provider-file asset. Known unsupported model/media pairs fail
before the OpenAI client or a custom transport is called.

For guaranteed media results, the package also exports `generateImage()`,
`transcribe()`, and `generateSpeech()`. They use OpenAI's native image,
transcription/translation, and speech endpoints and return usable media or
validated seconds-based transcript facts. Provider-only controls belong in
each operation's typed `extra`; model operations never accept an `AssetStore`
or persist implicitly. Chat audio input is limited to supported audio models
and WAV/MP3, while video input rejects before I/O.

The adapter also exposes `stream()` and agent composition methods (parallel, pipeline, consensus, swarm), plus `embedding()`, `createGenerateObjectFn()`, and `createGenerateTextFn()` for `@use-crux/core` APIs that expect framework-agnostic functions. `generate()` returns the canonical Crux envelope with accumulated `text`, optional `usage`, optional `cost`, `steps`, `finalStep`, provider-neutral `messages`, typed `raw`, and retained `_meta`; `usage` is present only when every provider-call step reported usage. `stream()` returns the Core-owned logical stream `{ runId, _meta, textStream, fullStream, partialOutputStream, completion, cancel }`; it never exposes the physical provider stream. `createGenerateObjectFn(client)` is provider-native: pass `model` in each prompt-or-messages call. It uses OpenAI structured parsing and preserves provider errors, but it does not run Crux prompt resolution, validation retry, safety, tools, memory, or instrumentation. Use `createGenerateObjectFnFromGenerate(generate)` from `@use-crux/core/compaction` when a helper call needs full adapter runtime behavior.

The package exports `openaiProviderRuntime` for advanced adapter composition. Internally, OpenAI uses `defineSingleTurnProviderBundle()` from `@use-crux/core/adapter`; adapter authors building similar single-turn providers should start there.

`toParams(resolved, { model })` converts a resolved prompt into OpenAI
chat-completion params, and `fromResponse(response)` normalizes an OpenAI
response into Crux response facts. These codecs are translation-only; use
managed `generate()`/`stream()` when Crux should run tools, approvals, memory,
validation retry, safety, and observability.

For headless orchestration, `openai.prepare(prompt, opts)` returns `{ params,
step, finish }` over the same executor path as managed `generate()`. Use
`generate(prompt, { ...opts, transport })` when Crux should keep owning the
loop and your callback should make each OpenAI call from public params. Streaming
with `transport` is not supported and rejects with
`CruxTransportStreamUnsupportedError`.

Crux maps portable `GenerationSettings.toolChoice` values to OpenAI `tool_choice`: `'auto'`, `'none'`, `'required'`, and `{ tool }` → `{ type: 'function', function: { name } }`. Portable `reasoning` maps to OpenAI `reasoning_effort`. `toolApproval` declares portable human-in-the-loop approval policy by tool name at context, prompt, or call site. Tools that declare `contextSchema` require `toolsContext.<toolName>` at the call site, and `runtimeContext` is threaded through tool execution, middleware, and function-form approval policies. `timeout` accepts structured budgets (`totalMs`, `stepMs`, `chunkMs`, `toolMs`, and `tools[name]`) and expired budgets reject with `TimeoutError`. OpenAI-native options that Crux does not model portably belong in the typed `extra` option.

See the [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) and the [Crux docs](https://cruxjs.dev) for the full API.
