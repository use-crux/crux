# @use-crux/core/observability

Canonical Crux observability graph contract.

This package owns the TypeScript source of truth for graph records emitted by Crux runtimes and ingested by devtools backends.

## Field-Change Checklist

When changing a graph field, update all of these in the same slice:

1. Public TypeScript type in `contract.ts`.
2. Runtime schema in `schema.ts`.
3. Shared fixture in `fixtures/`.
4. TypeScript contract tests in `__tests__/observability/`.
5. Type-level checks in `__type_tests__/` when the change affects type safety.
6. Go mirror structs/tests in `packages/local/internal/observability`.
7. Relevant ADR or docs if the change alters semantics.

Do not add mandatory code generation. TS and Go stay aligned through this checklist plus shared fixtures.

## Namespaces

Built-in edge types and artifact kinds are closed canonical lists. User-defined edge types and artifact kinds must use the `custom.*` namespace so backend read models and UI layouts can distinguish supported semantics from app-specific payloads.

## Generation Metrics

Generation terminal span records use the existing `metrics` field for client-side performance values:

- `gen.duration_ms`
- `gen.time_to_first_token_ms`
- `gen.output_tokens_per_second`
- `gen.time_per_output_chunk_ms`

These keys do not change the graph shape and do not require a schema-version bump.

## Capture Policy

`config({ observability: { recordInputs, recordOutputs } })` controls whether input/output-family artifacts include previews. Both options default to `true`.

When a direction is disabled, `observe.artifact()` emits the artifact as `encoding: 'reference'` with `sizeBytes` and `hash`, and omits `preview`. The artifact record shape is unchanged; consumers should already handle reference artifacts.
