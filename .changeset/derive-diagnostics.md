---
"@use-crux/core": minor
---

Surface Connected Knowledge derive diagnostics on `knowledgeBase().index()` and
`reindex()` results, replay cached derive warnings from claim manifests, and
record the same bounded knowledge summary on mutation receipt evidence.

Replace single-call generated relation and assertion extraction with
deterministic whole-chunk batching under the 12000-character derive batch
budget, invalidating pre-batching claim manifests with extraction contract
version 2.
