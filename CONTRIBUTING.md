# Contributing

Crux is currently alpha software. APIs, package boundaries, docs, and local runtime behavior can change quickly while the project moves toward a stable release.

## Local Development

```bash
pnpm install
pnpm typecheck
pnpm test
```

Prefer the root `Makefile` for repository workflows:

```bash
make install     # install workspace dependencies
make dev         # run dev tasks through Turbo
make docs        # run the docs app
make build       # build devtools, embed assets, and build Crux Local
make local       # same local runtime build pipeline
make local-go    # rebuild only Go from already embedded assets
make local-all   # cross-compile local binaries
make test
make typecheck
```

The Crux Local build pipeline is:

1. `pnpm --filter @crux/devtools build` builds Node workers into `packages/devtools/dist/` and the React UI into `packages/devtools/ui/dist/`.
2. `make -C packages/local embed` copies worker and UI assets into Go `//go:embed` directories.
3. `make -C packages/local build-go` compiles the native `crux` binary.

## Changes

Use Changesets for changes that affect published packages:

```bash
pnpm changeset
```

Keep `@crux/core` provider-agnostic. Provider, framework, database, and observability integrations should live in adapter packages.

## Release Notes

Crux uses Changesets for release management:

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

Before public npm release, publishable packages need compiled `dist` entrypoints, `files`, `publishConfig.access`, and `publishConfig.provenance` metadata. See [docs/OPEN_SOURCE_CHECKLIST.md](./docs/OPEN_SOURCE_CHECKLIST.md) for the current checklist.
