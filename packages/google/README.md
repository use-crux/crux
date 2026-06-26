# @use-crux/google

Google GenAI (Gemini) adapter for Crux. Wraps a `GoogleGenAI` client so Crux prompts and agents run against Google models — prompt composition, context engineering, memory, and flows all live in [`@use-crux/core`](../core); this package is only the provider boundary.

## Install

```bash
pnpm add @use-crux/google @use-crux/core @google/genai
```

`@google/genai` (`^1.0.0`) is a peer dependency.

## Usage

```ts
import { prompt } from '@use-crux/core'
import { createGoogle } from '@use-crux/google'
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

The adapter also exposes `stream()` and agent composition methods (parallel, pipeline, consensus, swarm), plus `embedding()`, `createGenerateObjectFn()`, and `createGenerateTextFn()` for `@use-crux/core` APIs that expect framework-agnostic functions. `createGenerateObjectFn()` is provider-native: it uses Google structured JSON output and preserves provider errors, but it does not run Crux prompt resolution, validation retry, safety, cassettes, tools, memory, or instrumentation. Use `createGenerateObjectFnFromGenerate(generate)` from `@use-crux/core/compaction` when a helper call needs full adapter runtime behavior.

Provider-level caching via Google's CachedContent API activates automatically for a leading run of system blocks with `providerCache: true`. The adapter sends that prefix as `cachedContent`, keeps the uncached remainder as `systemInstruction`, and shares the same planner between `generate()` and `stream()`. Disable cache lifecycle management with `createGoogle(client, { cachedContent: false })`, skip a single request with `extra: { cachedContent: { skip: true } }`, override a new cache object's TTL with `extra: { cachedContent: { ttlSeconds: 600 } }`, or provide a custom `GoogleCachedContentPort` with `createGoogle(client, { cachedContent: port })`.

The package exports `googleProviderRuntime` for advanced adapter composition. `createGoogle()` binds `googleProviderRuntime.create(client, { cacheResolver })` after resolving CachedContent options; adapter authors should use `defineProviderRuntime()` from `@use-crux/core/adapter`.

See [@use-crux/core](../core) and the [Crux docs](https://cruxjs.dev) for the full API.
