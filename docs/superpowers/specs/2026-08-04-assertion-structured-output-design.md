# Assertion structured-output contract

## Problem

Model-backed assertion stages currently send the model a generic payload schema
with `data: unknown`, optional broad evidence references, and no coupling between
an assertion type and its authored Zod schema. Crux applies the real schema and
batch evidence constraints only after generation, so a provider can satisfy the
wire schema and still fail Crux validation and repair.

## Design

- Compile one structured-output branch per authored assertion type. Each branch
  couples the literal `type` to that type's original Zod `data` schema.
- Require at least one evidence reference and constrain every reference to an
  exact `(sourceId, chunkId)` pair offered in the current batch. Do not add ECO's
  stricter one-primary-evidence policy to generic Core behavior.
- Preserve Core's existing optional `exact | derived` provenance behavior.
- Keep post-generation validation as a defense-in-depth boundary.
- Report repair exhaustion through Crux's typed validation-exhausted error,
  without including generated content.
- Increment `EXTRACTION_CONTRACT_VERSION` so claims produced under the weaker
  model contract are not reused.

## Verification

- Assert at the model seam that authored data schemas and exact batch evidence
  references reach structured generation.
- Reject arbitrary data and evidence at that seam; accept valid type-specific
  output.
- Cover typed repair exhaustion and cache-version invalidation.
- Run focused Core knowledge tests, typecheck, and the relevant package checks.

## ECO follow-up

Once ECO consumes the fixed Core build, remove its stringified-`data` normalizer.
Retain content-free diagnostics, but preserve safe `NoObjectGeneratedError`
classification such as finish reason and cause category where useful.
