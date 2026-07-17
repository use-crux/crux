# Node Basic

A typed prompt using `@use-crux/core` and the Vercel AI SDK adapter, plus a
production-task Eval with typed Cases.

```bash
pnpm add @use-crux/core @use-crux/ai ai @ai-sdk/openai zod
OPENAI_API_KEY=... pnpm tsx hello.ts
```

Crux discovers one default Eval export per `*.eval.ts` file:

```bash
cd examples/node-basic
crux eval list
crux eval examples.support-citations --plan
OPENAI_API_KEY=... crux eval examples.support-citations
```

The Eval imports the same callable `generate.task()` production task it tests.
Repeated runs automatically reuse exact safe evidence. Use `--offline` for a
zero-network run that fails on any evidence miss, or `--fresh` to bypass task
and managed-scorer evidence.

`evals/model-backed.example.ts` demonstrates a typed Variant without adding a
second discovered Eval. Rename it to `concise.eval.ts` to run it.

During alpha, packages may still be consumed from this repository workspace
before the first public npm release.
