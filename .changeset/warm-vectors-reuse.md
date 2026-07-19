---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/google": minor
"@use-crux/openai": minor
---

Cache validated dense and sparse embedding bundles per source when an indexer
uses `cache: true`, including dry-run reuse and cache modes for `indexChunks()`.
Embedding instances now expose vector-semantic fingerprints, and provider
helpers derive model/request identity while accepting an additional `version`
for explicit invalidation.

The first sync after an embedding identity change intentionally classifies
unchanged source content as `indexChanged`; cached vectors are reused when the
ordered chunk content remains compatible. In `appendOnly` mode that source is
skipped without updating its index identity, so later append-only syncs keep
reporting the same skip until a replace-mode sync accepts the change.

Index results and source ledgers now include `embedding` stage records with
`embeddingKind` and cache outcomes. Consumers that match stage objects by exact
shape should accept these new records and field.
