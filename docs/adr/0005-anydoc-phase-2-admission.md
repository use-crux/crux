# ADR 0005: Anydoc Phase 2 Admission

Status: Accepted

Date: 2026-08-08

Baseline SHA-256: `f45875c6a4ca335f09da94107ded8e3758b6abda9556b8370d55585720a82022`

## Decision

DOCX primary: `anydoc`. Exactly one primary is selected only when one candidate passes every applicable fixture gate. No fallback trigger is admitted. This evaluation does not change production routing.

## DOCX evidence

| Parser | Native facts | Core facts | Deterministic | Resource <= 50% | p95 wall ms | p95 RSS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| anydoc | true | true | true | true | 1000 | 134217728 |
| mammoth | false | false | true | true | 1000 | 268435456 |

## Format-wide blockers

- `anydoc`: `encrypted-v1`
- `anydoc`: `external-link-v1`
- `anydoc`: `timeout-v1`
- `anydoc`: `memory-limit-v1`
- `anydoc`: `containment-unavailable-v1`
- `anydoc`: `hard-memory-containment`
- `mammoth`: `docx-structure-v1`

Missing fixtures and source-hash mismatches are hard non-admission results; they are never inherited from another format or parser. The machine-readable baseline embeds every fixture outcome, deterministic hash, and resource sample used by this decision.
