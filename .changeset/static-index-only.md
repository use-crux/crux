---
"@use-crux/core": major
"@use-crux/indexer": major
"@use-crux/local": major
---

Make Rust/Oxc the required Static Index path, remove the obsolete
`experimental.indexer.nativeAst` option and TypeScript static-plan worker
artifact, and advance Project Index worker events to protocol v3. Configured
third-party static extractors continue to run through the trusted JavaScript
host.

Lint suppressions now remain in Project Index snapshots as materialized
evidence instead of deleting matched findings. `IndexLintFinding` is a strict
active/suppressed union: suppressed rows require directive source, scope, and
optional reason metadata, while canonical active rows omit suppression state.
Default lint/check views remain active-only, `--include-suppressed` exposes the
retained rows, and suppressed findings never fail a gate.

Devtools Index and Catalog Health now report active and suppressed totals
separately while retaining complete directive evidence for audit. Crux Local
run-detail reads correlate observed definition references with current Project
Index findings, and Devtools presents that non-historical context as Current
project health with links back to Catalog. This read-time context never changes
run status or creates suppression telemetry.
