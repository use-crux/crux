# @crux/openai

OpenAI SDK adapter for Crux. Wraps an `OpenAI` client so Crux prompts and agents run against OpenAI models — prompt composition, context engineering, memory, and flows all live in [`@crux/core`](../core); this package is only the provider boundary.

## Install

```bash
pnpm add @crux/openai @crux/core openai
```

`openai` (`^5.0.0 || ^6.0.0`) is a peer dependency.

## Usage

```ts
import { prompt } from '@crux/core'
import { createOpenAI } from '@crux/openai'
import OpenAI from 'openai'
import { z } from 'zod'

const openai = createOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

const fixTypos = prompt({
  id: 'fix-typos',
  input: z.object({ instruction: z.string() }),
  prompt: ({ input }) => input.instruction,
})

const result = await openai.generate(fixTypos, {
  model: 'gpt-4o',
  input: { instruction: 'Fix typos in this draft.' },
})

result.text // extracted text
result.raw // raw ChatCompletion
result._meta // normalized usage, finish reason, etc.
```

The adapter also exposes `stream()` and agent composition methods (parallel, pipeline, consensus, swarm), plus `embedding()`, `createGenerateObjectFn()`, and `createGenerateTextFn()` for `@crux/core` APIs that expect framework-agnostic functions. `createGenerateObjectFn()` is provider-native: it uses OpenAI structured parsing and preserves provider errors, but it does not run Crux prompt resolution, validation retry, safety, cassettes, tools, memory, or instrumentation. Use `createGenerateObjectFnFromGenerate(generate)` from `@crux/core/compaction` when a helper call needs full adapter runtime behavior.

The package exports `openaiProfile` for advanced adapter composition. `createOpenAI` is `openaiProfile.create`; adapter authors should use `@crux/core/adapter/profile` rather than provider-specific spec exports.

See [@crux/core](../core) and the [Crux docs](https://cruxjs.dev) for the full API.
