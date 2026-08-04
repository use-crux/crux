# Search hit provenance for native hybrid retrieval

Status: approved implementation design.

## Goal

Let applications consume PostgreSQL `SearchStore` dense, sparse, and lexical
rank evidence through the high-level `knowledgeBase().retriever()` path. This
removes the need for application-owned lexical retrievers and RRF while keeping
per-leg retrieval evidence available for audit and evaluation.

## Public contract

`HitProvenance` gains one optional field:

```ts
matches?: readonly SearchLegMatch[]
```

The field reuses the canonical `SearchStore` match contract without renaming or
reinterpreting its values. Each entry retains `kind`, one-based `rank`, and the
leg's raw `score`. It is absent for custom retrievers and stores that do not
provide match details. Existing `perSource` remains federation provenance and
must not be overloaded with search-leg data.

## Data flow

Indexed Knowledge keeps the complete `SearchHit` while hydrating its canonical
record. `indexedChunkToHit()` receives the final score and match details and
projects the details to `EvidenceHit.provenance.matches`. Existing stored
record provenance is merged rather than replaced. The projection clones match
objects so adapter-owned values never leak mutable identity into a retriever
hit.

Search ranking, fusion, filtering, and hydration behavior do not otherwise
change. Search stores remain responsible for producing deterministic match
details.

## ECO adoption

ECO will enable PostgreSQL lexical storage with the `dutch` text-search
configuration and request one native search plan containing dense and lexical
legs with RRF. Its candidate projection reads dense and lexical ranks from
`hit.provenance.matches`. The application-owned PostgreSQL lexical query,
custom lexical retriever, and recipe-level federation are removed.

The migration does not add BM25 or learned sparse retrieval. It does not change
assertion extraction and cannot improve a run whose assertions were not
successfully produced.

## Setup and rollout

Enabling lexical storage requires `crux setup --apply` for the generated
`tsvector` column and GIN index. Candidate documents are indexed again by the
normal knowledge-base lifecycle, which populates lexical content. No nightly is
published or triggered as part of this work; ECO consumes the Crux change only
after the user chooses a release path.

## Verification

- Core tests prove dense-only and fused SearchStore hits retain exact per-leg
  kind, rank, and score through Indexed Knowledge hydration.
- Tests prove canonical stored provenance is preserved when search matches are
  added.
- ECO tests prove native fused retrieval maps dense and lexical matches to its
  existing auditable candidate fields and no longer invokes custom lexical SQL.
- PostgreSQL setup checks prove the Dutch lexical capability is configured.
