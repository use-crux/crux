# @use-crux/local Context

## Language

**Eval Filesystem**:
`internal/evalfs`, the read boundary for authoritative Eval V3 run and Baseline artifacts.
_Avoid_: experiment store, generic evaluation snapshot

**Inspect Filesystem**:
`internal/inspectfs`, the persistence boundary for Inspect insights, statuses, and silences.
_Avoid_: Eval store, observability query layer

**Review Service**:
`internal/review`, the durable feedback submission, action-history, and Review projection boundary.
Repository writes are delegated to `internal/reviewwriter`.
_Avoid_: feedback annotation, automatic training-data writer

**Project Index Read Model**:
The devtools-facing projection produced by `internal/projectindex/readmodel` from raw Project Index
snapshots. Eval, Inspect, and Review have separate read models.
_Avoid_: raw store index, cross-domain filesystem owner

**Project Index Event Wire**:
The `internal/projectindex/eventwire` package that validates Project Index worker event streams and
projects them into patch, source-profile, and artifact records.
_Avoid_: generic wire, request wire, worker host

**Project Index Workers**:
The `internal/projectindex/workers` package family that composes Local's TypeScript worker lanes and
Node process adapters.
_Avoid_: host, projectindexer, UI-owned worker packages

**TypeScript Worker Request Wire**:
The `internal/projectindex/workers/requestwire` package that builds batched requests for TypeScript
worker entrypoints.
_Avoid_: indexwire, eventwire, protocol mirror

**Static Syntax Frontend**:
The `internal/projectindex/staticindex/frontend` package that adapts parser frontend processes and
Static Syntax records.
_Avoid_: staticindex/syntax worker package, Static Index compiler client

**Static Index Compiler Client**:
The `internal/projectindex/staticindex/compiler` package that calls Rust Static Index compiler
methods.
_Avoid_: staticindex/client, parser frontend, semantic backend

**Resolved Project Model**:
The local-facing project shape assembled from Project Index facts, Runtime evidence, and optional
policy config. It should show inferred versus explicit provenance.
_Avoid_: central registry, dashboard config, hidden setup

**Local Tooling Policy**:
Optional local config or CLI/run-tier choices for lint profile, discovery overrides, extension trust,
and local/cloud data boundaries.
_Avoid_: prompt registry, context registry, tool registry

**Local Auto-Attach**:
Best-effort local observability attachment when `crux dev` provides a local Devtools target.
_Avoid_: production telemetry default, cloud export default

## Relationships

- EvalFS validates V3 artifacts without making archived V2 records reusable.
- InspectFS owns only Inspect persistence; Review owns durable feedback and human actions.
- ReviewWriter adds validated Cases through the project-local Core contract and never copies model
  output into expected truth automatically.
- Project Index storage and read models remain raw with respect to Eval, Inspect, and Review data.
- Project Index Event Wire consumes worker event streams; TypeScript Worker Request Wire builds worker
  requests. Keep those directions separate.
- Static Syntax Frontend adapts parser evidence; Static Index Compiler Client calls compiler methods.
  Keep both separate from semantic backend behavior.
- Local Tooling Policy may constrain local behavior, but it must not be the only way local tools
  discover authored prompts, contexts, tools, memories, retrieval, flows, or agents.

## Rules

- Keep Eval, Inspect, Review, and legacy-migration persistence in their focused packages; do not
  recreate a cross-domain snapshot or workbench service.
- The physical `.crux/quality` directory is retained migration provenance, not a public API name.
- Archived V2 records are read-only and cannot influence Eval reuse, Baselines, or current truth.
- Do not add new `host`, `indexwire`, `wire`, `staticindex/syntax`, or `staticindex/client` package
  references when adding Project Index runtime code; use the responsibility names above.
- Keep production telemetry, cloud upload, raw-content capture, retention, durable stores, providers,
  and destructive capabilities explicit. Local Auto-Attach is local-only and best-effort.
