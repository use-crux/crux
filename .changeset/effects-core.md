---
"@use-crux/core": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
"@use-crux/otel": minor
---

Add the `@use-crux/core/effect` surface for typed in-process effects, immutable
receipts, individual recovery, automatic and delayed rollback, honest ambiguity
reconciliation, receipt-safe evidence, and canonical observability records.

Discover Effect definitions in the Project Index and surface their authored
identity and recovery configuration in Catalog, alongside receipt, outcome,
recovery-link, and ambiguity evidence in Devtools Runs.

Make exported Effect definitions eligible for the language server's generic
completion candidate pipeline while retaining kind-generic hover titles and
duplicate-identity diagnostics.

Make flow runs and pipeline, agent, and composition roots passive rollback
boundaries. Their results expose in-process Effect scope references, and flows
can explicitly recover completed units through `flow.rollback()`.

Add an internal audit-first native Effect contract so first-party domains can
contribute receipts, evidence, and Effect facets on their existing spans while
reporting unavailable or irreversible recovery honestly.

Export Effect spans through the OpenTelemetry adapter with the canonical
`crux.effect.run` span name.

Report an `effect.irreversible_in_required_boundary` Project Index error when
an irreversible Effect is certainly called inside a required-recovery
`rollbackOnError()` boundary, with guidance for defining recovery, moving the
Effect outside the boundary, or explicitly choosing best-effort recovery.
