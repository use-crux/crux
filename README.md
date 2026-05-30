# Crux

Context engineering toolkit for TypeScript.

Crux provides typed primitives for prompts, contexts, memory, retrieval, flows, evaluation, agents, guardrails, and provider adapters. The SDK is currently pre-1.0 and being prepared for open source release.

## Packages

- `@crux/core` - core prompt, context, memory, retrieval, flow, evaluation, safety, and agent primitives.
- `@crux/ai` - Vercel AI SDK adapter.
- `@crux/openai` - OpenAI SDK adapter.
- `@crux/anthropic` - Anthropic SDK adapter.
- `@crux/google` - Google GenAI SDK adapter.
- `@crux/convex` - Convex integration.
- `@crux/upstash` - Upstash Vector and Redis adapters.
- `@crux/otel` - OpenTelemetry integration.
- `@crux/ingest` - source loaders for files and URLs.
- `@crux/react` - React integration helpers.
- `@crux/devtools` - local development UI and trace tooling.
- `@crux/cli` - native CLI wrapper.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Release

This repository uses Changesets.

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

Packages are intended to publish under the public `@crux/*` npm scope once the initial open source cleanup is complete.

