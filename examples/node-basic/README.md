# Node Basic

A tiny typed prompt using `@crux/core` and the Vercel AI SDK adapter, plus a
deterministic quality eval that demonstrates score-aware `assert`.

```bash
pnpm add @crux/core @crux/ai ai @ai-sdk/openai zod
OPENAI_API_KEY=... pnpm tsx hello.ts
```

The quality example is local-only, does not call a model, and does not need a
`crux.config.ts` file. Quality discovers `*.eval.ts` files from the project
directory by convention:

```bash
cd examples/node-basic
crux quality list
crux quality run examples.support-citations
```

`quality-model-backed.example.ts` shows the model-backed shape without
project-wide `quality.setup()`: the eval imports `createQualityModelRuntime()`
from a nearby helper and passes `generate`/`model` directly to `target.prompt`.
Rename it to `quality-model-backed.eval.ts` when you want to run it, then use
`crux quality run examples.model-backed-support-answer --replay record-new` to
record its first cassette.

During alpha, packages may still be consumed from this repository workspace before the first public npm release.
