# Observability Schema Versioning

The canonical observability wire contract is owned by
`packages/core/src/observability/contract.ts` and validated by
`packages/core/src/observability/schema.ts`. The Go local runtime mirrors that
contract for storage and read models. Keep these surfaces in the same change
whenever graph records change.

## Current Version

`CRUX_OBSERVABILITY_SCHEMA_VERSION` is `5`.

Version 5 adds the canonical `evidence` family, `evidence.record` primitive,
and qualified `evidence.for` relationships. Evidence edges require a strict
safe metadata shape with role-correlated conclusions. Writers and readers
accept v5 only.

Version 4 added required `operationId` identity to every record and immutable
`parentRunId`/`triggeredBySpanId` topology to child `run:start` records. Writers
could not assign earlier records truthful operation families from trace,
timing, names, or edges.

Version 3 added optional, validated `deployment` identity to the record
envelope.

Version 2 was a clean pre-launch cutover. Graph records carry execution segment
identity with `segmentId` and positive segment-local `segmentSeq`; the old
process-local `seq` field is not retained or reinterpreted. The local SQLite
runtime detects pre-v2 observability storage transactionally, drops only the
observability raw/projection tables that cannot carry truthful segment identity,
and recreates the v2 schema. Application tables and unrelated local state are
not touched.

## When To Bump

Bump `CRUX_OBSERVABILITY_SCHEMA_VERSION` when a newly emitted record cannot be
safely consumed by an older server or subscriber that understands the previous
version.

Examples that require a bump:

- Removing or renaming a record type.
- Removing, renaming, or changing the meaning of a required field.
- Changing the type of an existing field.
- Tightening a canonical enum so previously valid emitted records become
  invalid.
- Changing identity or ordering semantics in a way that changes how consumers
  must correlate records.

Examples that do not require a bump:

- Adding an optional field.
- Adding a canonical primitive, edge type, artifact kind, or metric key while
  preserving existing values.
- Adding a new optional attribute under `attributes`.
- Adding a new fixture or read-model-only presentation type.
- Changing capture policy or redaction behavior without changing the wire
  record shape.

## Forward Compatibility

TypeScript emitters are closed over `CruxGraphRecord`: the producer schema does
not accept unknown record discriminants. Consumers should narrow on `record.type`
and ignore variants they do not understand.

The Go local runtime is more permissive at ingest time. It accepts unknown
record types after base identity validation, stores the raw JSON in `records`,
and skips normalized projection for that record. Unknown JSON fields on known
records are preserved in `records.payload_json` even when the normalized Go
struct ignores them.

## Field-Change Checklist

When changing a graph field or canonical taxonomy value, update all of these in
the same slice:

1. Public TypeScript type in `contract.ts`.
2. Runtime schema in `schema.ts`.
3. Shared fixture corpus in `fixtures/`.
4. TypeScript contract tests in `packages/core/__tests__/observability/`.
5. Type-level checks in `packages/core/__type_tests__/` when the change affects
   type safety.
6. Go mirror structs, validators, projections, and tests in
   `packages/local/internal/observability`.
7. Relevant user-facing docs if the change alters emitted behavior.

The shared fixture corpus is the executable contract between TypeScript and Go.
Known producer fixtures must parse through `CruxGraphRecordBatchSchema`; forward
compatibility fixtures document unknown discriminants and extra fields without
widening the TypeScript producer schema.
