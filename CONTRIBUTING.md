# Contributing

Crux is currently pre-1.0. Public contribution guidelines will be expanded before the repository is made public.

## Local Development

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Changes

Use Changesets for changes that affect published packages:

```bash
pnpm changeset
```

Keep `@crux/core` provider-agnostic. Provider, framework, database, and observability integrations should live in adapter packages.

