# Static Index Contract Gates Design

## Decision

Replace the checked, whole-repository Rust static-output golden with two
separate gates:

1. exact, small curated compiler contract fixtures; and
2. a first-party repository smoke, invariant, and determinism gate.

The second gate runs the production Rust/Oxc frontend over the repository, but
does not treat ordinary repository source as a checked compiler fixture.

## Problem

`rust-first-party-static-golden.json` is an 8k+ line, checked fixture for the
entire `staticDefinitionFiles(root)` result. Its per-file entries include a
canonical-output SHA-256, byte count, fact counts, and global totals. The
current test requires exact equality for the complete discovered repository.

Consequently, an ordinary indexed-source edit changes a raw source-dependent
hash or byte count and requires an unrelated golden refresh. This makes the
gate noisy, hides meaningful compiler regressions among mechanical updates,
and makes the checked fixture a snapshot of repository churn rather than a
stable compiler contract.

The fixture is produced by the Rust/Oxc frontend and compared with another run
of that same frontend. Current code does not provide an independent static
frontend that can compare first-party whole-repository output. The TypeScript
extension host is not a first-party compiler baseline. Therefore this design
makes no whole-repository “parity” claim.

## Target Gate Architecture

### Curated compiler contracts

Keep exact normalized-output assertions for compact, intentionally curated
inputs. Each fixture names the language or Crux construct it covers and checks
the relevant normalized definitions, relations, dependencies, and diagnostics.
Existing shared Static Syntax, protocol, descriptor, relation, and primitive
fixtures remain the preferred contract corpus. Add focused fixture cases only
when an extractor contract changes; do not add repository source to that corpus.

Where a real independent frontend comparator exists for a specific curated
input, compare its normalized output there. If it does not exist, an exact
curated expected result is still a compiler contract, but must not be labelled
parity.

### Repository invariants

Run `staticDefinitionFileSelection(root)` and a cache-disabled
`createStaticExtraction` with the Rust/Oxc frontend over actual first-party
source. Run the same normalized collection twice. The runner returns an
in-memory, root-normalized result for assertion; it does not write a fixture.

The required invariants are deliberately structural and deterministic:

- Both runs have identical normalized extraction output after the existing
  canonical normalization. This detects nondeterministic output without
  checking it into the repository.
- The selected-file list accounts for extraction: each discovered file is
  extracted exactly once, neither run reports an extra file, and skipped
  candidates are retained only as discovery accounting.
- Every extracted file has one unique, root-relative POSIX path. No path is
  empty, absolute, outside the root, or duplicated.
- There are no unexpected diagnostics. The invariant runner must distinguish
  expected source-level diagnostics represented by a curated input from worker,
  protocol, source-read, or extractor-failure diagnostics; the latter fail the
  repository gate. It must not suppress diagnostics by count or threshold.
- Every local dependency path and every dependency target that the current
  normalized extraction represents as a file path resolves inside the selected
  repository set. Non-file specifiers remain valid external dependencies and
  are not coerced into paths.

No raw source hashes, canonical byte lengths, per-file fact counts, global
counts, checked repository output, or performance threshold is an invariant.
The test must make no assumptions about how many definitions, relations, or
diagnostics the evolving repository contains.

### Diagnostic census

The runner may calculate and log a whole-repository census (file and fact
counts, diagnostic grouping, or canonical byte size) to help diagnose changes.
It is process-local diagnostic output: it is neither checked in nor used as a
PR-blocking equality assertion.

## Migration Plan (TDD)

Make one vertical slice at a time, keeping the old gate until its replacement
slice is proven.

1. Add a regression test using a temporary, discovered source corpus. Mutate
   an irrelevant indexed source's contents while retaining valid extraction
   output; both runs must pass repository invariants without regenerating any
   fixture. This test establishes the reason for the migration before changing
   the release gate.
2. Extract shared root/path normalization, discovery accounting, deterministic
   collection, diagnostic classification, and local-dependency validation into
   a small repository-invariants runner. Reuse existing canonical static
   normalization rather than adding another serializer.
3. Add the Rust/Oxc first-party repository test around that runner. It runs
   twice with `cache: "none"`, asserts the invariants, and can log the optional
   census. It does not read or update `rust-first-party-static-golden.json`.
4. Move exact first-party extractor coverage needed by the old gate into small
   curated contract fixtures, adding only cases that are not already covered
   by the shared corpus. If a comparator is introduced later, use it only on
   these curated inputs.
5. Replace the release-script entry with the repository-invariants test;
   delete the whole-repository golden helper, fixture type, JSON fixture, and
   update environment variables. Remove update-mode fixture regeneration.
6. Rename the CI/job/script/readiness language from “static-index parity” to
   “static-index contract gate” (or equally precise invariant wording). Update
   the readiness-doc test and the runtime architecture baseline so they describe
   exact curated contracts plus first-party invariants, not a Rust-to-Rust
   golden comparison.

Each slice has focused tests before its production gate wiring. Do not combine
the deletion, runner extraction, naming change, and fixture expansion into one
unreviewable rewrite.

## Module Boundaries

Keep modules under roughly 300 lines where practical:

- a curated contract-corpus test/helper owns fixture inputs and exact expected
  normalized output;
- a repository-invariants runner owns collection, normalization, accounting,
  determinism comparison, diagnostics, and dependency validation;
- the Rust/Oxc repository test supplies the real frontend and repository root;
- the release script only builds the worker and invokes named gates.

The runner must not become a second extraction engine or public API. It is
test-only orchestration around production discovery and extraction helpers.

## Documentation and Compatibility

Delete, rather than refresh, the huge exact golden once the replacement gate
is active. Demote any optional census to logs. Update
`STATIC_INDEX_READINESS.md` and the runtime architecture baseline to use honest
contract/invariant terminology, and adjust their executable documentation test.

This changes test and release-gate evidence only. It introduces no public API
or runtime behavior change, requires no cache-identity or cache-epoch bump,
and needs no changeset.

## Verification

During each slice, run its focused Vitest file with a built Rust worker. Before
landing the completed migration, run:

```bash
pnpm --filter @use-crux/indexer test
pnpm test:static-index-contracts
make local
```

The final command name replaces `pnpm test:static-index-parity`; update the
root package script and CI workflow together so the executable contract and
readiness documentation cannot drift.
