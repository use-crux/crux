---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/google": minor
"@use-crux/openai": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
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

Add native multimodal dense embeddings with declared, const-inferred
`modalities`, typed text/image/audio/video/document inputs, and query/document
roles. Google `gemini-embedding-2` maps those inputs natively and has a
zero-config model-aware path; OpenAI and the installed AI SDK embedding surface
remain explicitly text-only and reject media before provider I/O.

Indexers can store media documents through `AssetStore`, stamp vectors with a
SHA-256 embedding-space digest, and retrieve the same namespace with text or
media while retaining `RetrieverHit.source.assetRef` attribution. Namespace
guards reject incompatible model, dimension, normalization, modality, or task
spaces before writes or search and require a full reindex or new namespace.
Media bytes and provider locators never enter record/vector metadata, pipeline
caches, observability artifacts, or retrieval traces.

Breaking (pre-1.0 minor): custom dense provider batch functions now receive
validated `NormalizedEmbeddingInput[]` plus `{ role }` instead of `string[]`.
Embedding fingerprints now include modality/space semantics, invalidating old
embedding and indexing cache entries once so they are safely re-embedded.

Project Index now emits module-scoped embedding definitions, embedding-call
facts, vector-indexer facts, and consumer-to-embedding relations. Semantic
lints reject proven unsupported media modalities, sparse/media combinations,
and exact embedding-identity mismatches within a shared vector namespace.

The embedded Devtools catalog now shows each retriever and knowledge base's
resolved embedding modalities and dense vector-space identity, with the new
embedding lints presented through the standard Health view. Run Detail now
presents embedding roles, modality counts, and space digests, plus byte-safe
asset, media-type, and page/time attribution on media retrieval hits.
