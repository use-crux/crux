# @crux/core/observability

Canonical Crux observability graph contract.

This package owns the TypeScript source of truth for graph records emitted by Crux runtimes and ingested by devtools backends.

## Field-Change Checklist

When changing a graph field, update all of these in the same slice:

1. Public TypeScript type in `contract.ts`.
2. Runtime schema in `schema.ts`.
3. Shared fixture in `fixtures/`.
4. TypeScript contract tests in `__tests__/observability/`.
5. Type-level checks in `__type_tests__/` when the change affects type safety.
6. Go mirror structs/tests in `packages/cli/internal/observability`.
7. Relevant ADR or docs if the change alters semantics.

Do not add mandatory code generation. TS and Go stay aligned through this checklist plus shared fixtures.

## Namespaces

Built-in edge types and artifact kinds are closed canonical lists. User-defined edge types and artifact kinds must use the `custom.*` namespace so backend read models and UI layouts can distinguish supported semantics from app-specific payloads.
