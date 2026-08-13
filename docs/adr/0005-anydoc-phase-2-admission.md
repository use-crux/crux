# ADR 0005: Anydoc Phase 2 Admission

Status: Accepted

Date: 2026-08-08

Baseline SHA-256: `ff3442e70c956de4e1633cb0841f300b6066c3160848a19b10a3f49021a225a7`

## Decision

DOCX primary: **none**. Exactly one primary is selected only when one candidate passes every applicable fixture gate. No fallback trigger is admitted. This evaluation does not change production routing.

## DOCX evidence

| Parser | Native facts | Core facts | Deterministic | Resource <= 50% |
| --- | ---: | ---: | ---: | ---: |
| anydoc | false | false | false | false |
| mammoth | false | false | true | true |

## Format-wide blockers

- `anydoc`: `docx-structure-v1`
- `anydoc`: `encrypted-v1`
- `anydoc`: `truncated-v1`
- `anydoc`: `malformed-v1`
- `anydoc`: `mislabeled-v1`
- `anydoc`: `expansion-heavy-v1`
- `anydoc`: `external-link-v1`
- `anydoc`: `timeout-v1`
- `anydoc`: `memory-limit-v1`
- `anydoc`: `containment-unavailable-v1`
- `anydoc`: `hard-memory-containment`
- `mammoth`: `docx-structure-v1`

Missing fixtures and source-hash mismatches are hard non-admission results; they are never inherited from another format or parser. The machine-readable baseline contains only logical fixture, package, fact, assertion, decision, and gate evidence. Runtime versions, host provenance, and exact resource samples are emitted separately as run attestation and cannot authorize routing.
