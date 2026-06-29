# @use-crux/local-workers

Private TypeScript worker bundles embedded by `@use-crux/local`.

This package owns Node worker entrypoints that need to run near a user's
TypeScript project:

- `project-indexer.mjs`
- `project-semantic-indexer.mjs`
- `project-runtime-indexer.mjs`
- `quality-runner.mjs`
- `source-resolver.mjs`

The React devtools UI lives in `@use-crux/devtools`. The Go local runtime builds
and embeds both packages as separate asset groups.

## Build

```bash
pnpm --filter @use-crux/local-workers build
```

The build script bundles entrypoints from `bin/` into self-contained ESM files in
`dist/`. Node builtins stay external. Optional peer dependencies with native
addons, such as local tunnel providers, stay external.

The quality runner deliberately does not bundle `@use-crux/core`; it resolves
the project's own core instance at runtime and drives Quality through
`@use-crux/core/quality/internal/runner`'s `createQualityRunner()` facade. That
keeps evaluation symbols shared with user files without exposing engine
internals such as definitions, baseline helpers, cassette sessions, or output
cache keys. Devtools auto-attach resolves the same project's
`@use-crux/core/observability` facade separately so observability state is shared
without widening the Quality runner contract.

## Checks

```bash
pnpm --filter @use-crux/local-workers typecheck
pnpm --filter @use-crux/local-workers test
```

Indexer parity and benchmark helpers live here because they exercise worker and
compiler behavior, not browser UI behavior.
