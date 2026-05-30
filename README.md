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

## Make Targets

Use the root `Makefile` for common repository workflows:

```bash
make install     # install workspace dependencies
make dev         # run all dev tasks through Turbo
make docs        # run the docs app
make build       # build devtools workers/UI, embed them, then build the Go CLI
make cli         # build devtools workers/UI, embed them, then build the Go CLI
make cli-go      # rebuild only Go using the currently embedded assets
make cli-all     # build embedded CLI binaries for supported platforms
make test
make typecheck
```

The full CLI build pipeline is:

1. `pnpm --filter @crux/devtools build` builds bundled Node workers into `packages/crux-devtools/dist/` and the React UI into `packages/crux-devtools/ui/dist/`. This is an explicit package build, not a Turbo/root build, and it does not build `crux-docs`.
2. `make -C packages/crux-cli embed` copies those worker and UI assets into Go `//go:embed` directories.
3. `make -C packages/crux-cli build-go` compiles the native `crux` binary.

`make cli` runs all three steps. `make cli-all` runs the same embedding pipeline and then cross-compiles platform binaries under `packages/crux-cli/dist/`.

## Release

This repository uses Changesets.

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

Packages are intended to publish under the public `@crux/*` npm scope once the initial open source cleanup is complete.
