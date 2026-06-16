# Node Basic

A tiny typed prompt using `@crux/core` and the Vercel AI SDK adapter, plus a
deterministic quality eval that demonstrates score-aware `assert`.

```bash
pnpm add @crux/core @crux/ai ai @ai-sdk/openai zod
OPENAI_API_KEY=... pnpm tsx hello.ts
```

The quality example is local-only and does not call a model:

```bash
crux quality run examples.support-citations
```

During alpha, packages may still be consumed from this repository workspace before the first public npm release.
