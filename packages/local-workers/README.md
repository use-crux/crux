# @use-crux/local-workers

Private TypeScript worker bundles embedded by `@use-crux/local`.

This package owns Node worker entrypoints that need to run near a user's
TypeScript project:

- `project-indexer.mjs`
- `project-semantic-indexer.mjs`
- `project-runtime-indexer.mjs`
- `eval-coordinator.mjs`
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

The Eval coordinator deliberately does not bundle `@use-crux/core`; it resolves
the project's own Core instance so authored Eval brands, loader identity, and
the internal runner protocol remain shared with user files.

## Checks

```bash
pnpm --filter @use-crux/local-workers typecheck
pnpm --filter @use-crux/local-workers test
```

Indexer parity and benchmark helpers live here because they exercise worker and
compiler behavior, not browser UI behavior.
