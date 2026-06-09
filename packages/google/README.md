# @crux/google

Google GenAI (Gemini) adapter for Crux. Wraps a `GoogleGenAI` client so Crux prompts and agents run against Google models — prompt composition, context engineering, memory, and flows all live in [`@crux/core`](../core); this package is only the provider boundary.

## Install

```bash
pnpm add @crux/google @crux/core @google/genai
```

`@google/genai` (`^1.0.0`) is a peer dependency.

## Usage

```ts
import { prompt } from '@crux/core'
import { createGoogle } from '@crux/google'
import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

const google = createGoogle(new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }))

const fixTypos = prompt({
  id: 'fix-typos',
  input: z.object({ instruction: z.string() }),
  prompt: ({ input }) => input.instruction,
})

const result = await google.generate(fixTypos, {
  model: 'gemini-2.5-flash',
  input: { instruction: 'Fix typos in this draft.' },
})

result.text // extracted text
result.raw // raw GenerateContentResponse
result._meta // normalized usage, finish reason, etc.
```

The adapter also exposes `stream()` and agent composition methods (parallel, pipeline, consensus, swarm), plus `embedding()`, `createGenerateObjectFn()`, and `createGenerateTextFn()` for `@crux/core` APIs that expect framework-agnostic functions. Provider-level caching via Google's CachedContent API activates automatically when system blocks set `providerCache: true`; disable it with `createGoogle(client, { cache: false })`.

See [@crux/core](../core) and the [Crux docs](https://cruxjs.dev) for the full API.
