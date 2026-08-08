# ADR 0005: Anydoc Phase 2 Admission Is Blocked

Status: Accepted

Date: 2026-08-08

## Context

Phase 2 evaluates Anydoc only through the bounded offline corpus. The result
must choose one DOCX owner only when required facts, parser-native facts, Core
projection, three-cold/five-warm determinism, hostile-input handling, and the
50% rollout-resource gate all pass. A parser success is not an admission.

The replayable machine evidence is
`packages/ingest/evals/anydoc/evidence-baseline-v1.json`. It records exact
Anydoc/native package pins, fixture SHA-256 values, canonical output hashes,
typed outcomes, required-fact failures, determinism samples, and p95 resource
measurements without retaining document content.

## Decision

No Anydoc format is admitted and DOCX has no primary parser selection in this
phase. This is the only deterministic result supported by the evidence:

- Anydoc's available DOCX run is deterministic and below the rollout resource
  gate (p95: 181 ms wall, 58,167,296 bytes RSS, 40 ms CPU), but it has no
  assertion-addressable parser-native fact surface and loses required Core
  facts/provenance.
- Mammoth has a deterministic, resource-compliant DOCX run (p95: 16 ms wall,
  257,126,400 bytes host RSS, 37 ms CPU), but fails required Core facts after
  projection. It therefore cannot win the tie-breaker.
- Every other available Anydoc candidate also fails required native/Core fact
  admission. XLS is additionally non-deterministic; hostile fixtures produce
  typed non-success outcomes and are not admitted.

This does not alter existing production routing. DOCX remains outside a new
Anydoc route until a later evidence baseline supports exactly one owner.

## Controls

The control role matrix remains unchanged:

| Format | Parser retained | Evidence result |
| --- | --- | --- |
| CSV | `csv-parse` | required facts and deterministic hashes pass |
| XLSX | `exceljs` | required facts and deterministic hashes pass |
| PDF | `pdf-inspector` | required facts and deterministic hashes pass |

Anydoc is not selected for any control. The controls' host-process RSS samples
are recorded for comparison but are not Anydoc rollout evidence.

## DOCX fallback triggers

There is no fallback. None of `unsupported-feature`, `invalid-result`, or
`parser-crash` has the required representative primary failure plus a fallback
success that passes all DOCX facts, three-cold/five-warm hashes, hostile safety,
and the 50% resource gate. Timeout, resource, containment, encryption, and
input-validation failures remain forbidden fallback triggers.

## Consequences

- DOCM and legacy PPT remain non-admitted because their manifests are blocked
  by missing redistribution-safe source bytes.
- Encrypted Office input remains non-admitted because no genuine encrypted
  fixture is available; it cannot be inferred from a ZIP-password wrapper.
- Phase 3 must not add production Anydoc loading or routing from this evidence.
  It may resume only after the parser-native adapter and required structural
  projections are independently proven and a replacement baseline selects one
  owner.

## Validation

Run the evidence writer serially and offline:

```sh
UPDATE_ANYDOC_EVIDENCE=1 pnpm --filter @use-crux/ingest exec vitest run \
  evals/anydoc/admission-baseline.test.ts --maxWorkers=1
```

The run executes each available fixture/family serially, with one parser child
at most, and writes only the bounded baseline above.
