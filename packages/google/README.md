# @use-crux/google

Google GenAI (Gemini) adapter for Crux. Wraps a `GoogleGenAI` client so Crux prompts and agents run against Google models — prompt composition, context engineering, memory, and flows all live in [`@use-crux/core`](https://cruxjs.dev/docs/reference/crux-core); this package is a `single-turn` provider runtime and owns only the Google wire boundary.

## Install

```bash
pnpm add @use-crux/google @use-crux/core @google/genai
```

`@google/genai` (`^1.0.0 || ^2.0.0`) is a peer dependency.

## Usage

```ts
import { prompt } from "@use-crux/core";
import { createGoogle } from "@use-crux/google";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const google = createGoogle(
  new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }),
);

const fixTypos = prompt({
  id: "fix-typos",
  input: z.object({ instruction: z.string() }),
  prompt: ({ input }) => input.instruction,
});

const result = await google.generate(fixTypos, {
  model: "gemini-2.5-flash",
  input: { instruction: "Fix typos in this draft." },
});

result.text; // extracted text
result.raw; // raw GenerateContentResponse
result.usage; // accumulated usage when every provider step reported it
result.finalStep; // text, usage, finish reason, response id, and actual model for the final step
```

The adapter also exposes `stream()` and agent composition methods (parallel, pipeline, consensus, swarm), plus `embedding()`, `createGenerateObjectFn()`, and `createGenerateTextFn()` for `@use-crux/core` APIs that expect framework-agnostic functions. `generate()` returns the canonical Crux envelope with accumulated `text`, optional `usage`, optional `cost`, `steps`, `finalStep`, provider-neutral `messages`, typed `raw`, and retained `_meta`; `usage` is present only when every provider-call step reported usage. `stream()` returns `{ textStream, raw, completion }`, where `completion` resolves to the same envelope fields without `raw`/`_meta`. `createGenerateObjectFn()` is provider-native: it uses Google structured JSON output and preserves provider errors, but it does not run Crux prompt resolution, validation retry, safety, cassettes, tools, memory, or instrumentation. Use `createGenerateObjectFnFromGenerate(generate)` from `@use-crux/core/compaction` when a helper call needs full adapter runtime behavior.

Provider-level caching via Google's CachedContent API activates automatically for a leading run of system blocks with `providerCache: true`. A single `GoogleCachedContentLifecycle` owns prefix detection, cache keying/reuse, SDK cache operations, and fallback policy; it returns a request-ready config patch that both `generate()` and `stream()` merge. The adapter sends the cacheable prefix as `cachedContent` and keeps the uncached remainder as `systemInstruction`.

Configure it through `createGoogle(client, { cachedContent })`:

- `cachedContent: false` — disable cache lifecycle management entirely.
- `cachedContent: { defaultTtlSeconds, maxEntries, onError }` — tune the built-in lifecycle. `onError: 'throw'` surfaces cache failures instead of falling back to an inline `systemInstruction`.
- `cachedContent: { port }` — back caching with a custom `GoogleCachedContentCachePort` (create/delete) while keeping built-in keying, TTL, and eviction.
- `cachedContent: <GoogleCachedContentLifecycle>` — supply a fully custom lifecycle.

Per request, skip caching with `extra: { cachedContent: { skip: true } }` or override a new cache object's TTL with `extra: { cachedContent: { ttlSeconds: 600 } }`.

The package exports `googleProviderRuntime` for advanced adapter composition. Internally, Google uses `defineSingleTurnProviderBundle()` from `@use-crux/core/adapter`; `createGoogle()` is the bundle's mapped `create(client, opts)` factory, which resolves the CachedContent option into a lifecycle before core receives it.

Portable `GenerationSettings.reasoning` maps to Google `thinkingConfig.thinkingLevel` (`LOW` / `MEDIUM` / `HIGH`). `timeout` accepts structured budgets (`totalMs`, `stepMs`, `chunkMs`, `toolMs`, and `tools[name]`) and expired budgets reject with `TimeoutError`. Exact thinking budgets and thought-output controls are Google-native settings and belong in typed `extra`.

See the [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) and the [Crux docs](https://cruxjs.dev) for the full API.
