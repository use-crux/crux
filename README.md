<p align="center">
  <img src="assets/crux-logo.svg" alt="Crux" width="320" />
</p>

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
- `@crux/local` - native local runtime, CLI, TUI, dev server, and embedded devtools.

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
make build       # build devtools workers/UI, embed them, then build Crux Local
make local       # build devtools workers/UI, embed them, then build Crux Local
make local-go    # rebuild only Go using the currently embedded assets
make local-all   # build embedded Crux Local binaries for supported platforms
make test
make typecheck
```

The full Crux Local build pipeline is:

1. `pnpm --filter @crux/devtools build` builds bundled Node workers into `packages/devtools/dist/` and the React UI into `packages/devtools/ui/dist/`. This is an explicit package build, not a Turbo/root build, and it does not build `docs`.
2. `make -C packages/local embed` copies those worker and UI assets into Go `//go:embed` directories.
3. `make -C packages/local build-go` compiles the native `crux` binary.

`make local` runs all three steps. `make local-all` runs the same embedding pipeline and then cross-compiles platform binaries under `packages/local/dist/`. `make cli`, `make cli-go`, and `make cli-all` remain compatibility aliases.

## Release

This repository uses Changesets.

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

Packages are intended to publish under the public `@crux/*` npm scope once the initial open source cleanup is complete.
