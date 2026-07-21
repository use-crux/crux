# RFC 0002: Native Multimodal Embeddings

Status: Accepted (implemented)

Date: 2026-07-20

## Summary

Crux uses one embedding abstraction for text and native media embeddings.
Dense embeddings declare the modalities they encode, accept a typed
`EmbeddingInput`, and expose an identity for their vector space. Indexers can
write media and text into that space; retrievers can query it with text or
media and return the existing `RetrieverHit` shape.

The first native adapter is Google `gemini-embedding-2`. OpenAI and the
installed AI SDK embedding surface remain honestly text-only. Anthropic still
has no direct embedding operation.

## Motivation

Native multimodal models can place text, images, audio, video, and documents in
one comparable space. That enables text-to-image, image-to-image, and
image-to-text search without converting media to captions or exposing provider
payloads in Core.

The contract also has to prevent a more dangerous failure: comparing vectors
from different models, dimensions, normalizations, or task semantics. A vector
namespace therefore records the digest of the embedding space that created it.

## Public Interface Decision

### Option A: widen the existing abstraction (selected)

```ts
type EmbeddingModality = "text" | "image" | "audio" | "video" | "document";

interface DenseEmbedding<M extends EmbeddingModality = EmbeddingModality> {
  readonly modalities: readonly M[];
  readonly space: EmbeddingSpace;
  embed(input: EmbeddingInput<M>, options?: EmbedOptions): Promise<number[]>;
  embedMany(
    inputs: readonly EmbeddingInput<M>[],
    options?: EmbedOptions,
  ): Promise<number[][]>;
}
```

This preserves one noun, one factory, and one indexing/retrieval path. Literal
provider configuration narrows invalid inputs at compile time. Dynamic model
configuration retains the same API and fails with `EmbeddingModalityError`
before provider I/O.

### Option B: add a separate operation (rejected)

```ts
interface MultimodalEmbedding {
  embed(input: MultimodalEmbeddingInput): Promise<number[]>;
  embedMany(inputs: readonly MultimodalEmbeddingInput[]): Promise<number[][]>;
}
```

This would duplicate governance, indexing, retrieval, cache, and observability
composition for a capability difference already represented by `modalities`.
It would also force applications to choose between abstractions when a model
supports both text and media.

## Decisions

### Capability and unsupported inputs

Providers that expose embeddings use the uniform dense-embedding API and
declare their native modalities. Unsupported inputs throw before any network
call. A provider with no embedding API exposes no factory; Crux never captions
media and labels the result a native media embedding.

Omitting `modalities` means `['text']`, preserving the simple text-only path.
Sparse embeddings are always text-only and have no dense `space`.

### Vector cardinality and roles

One input always produces one vector, so `embedMany()` is strictly N-to-N.
Core does not pool vectors. Query and document roles may select provider task
hints, but both roles remain in the same declared space. Indexing supplies the
document role; retrieval supplies the query role.

Mixed text/media aggregate inputs are deferred. Providers such as Cohere Embed
v4 may support them, but that does not change this release's cardinality.

### Retrievable units and attribution

Sub-asset splitting is upstream of embeddings. A PDF page, image region, audio
interval, or video interval becomes independently retrievable only when the
loader supplies a separate part with its source location. Crux does not invent
provider-specific splitting or pool sub-assets.

Media documents become one chunk per media part. The owning indexer stores the
asset through `AssetStore` when available and persists only an `AssetRef`, MIME
type, source location, and allowlisted scalar facts. `AssetRef` is attribution,
never model input. Generated assets keep provenance through the document source
record rather than new fields on `Asset`.

### Byte safety

Media bytes, base64, signed URLs, provider file ids, and filenames never enter
record payloads, vector metadata, traces, cache artifacts, or retrieval recipe
traces. Data assets receive a SHA-256 identity after canonical normalization.
Sources containing media bypass pre-embedding pipeline caches; the
media-aware vector cache participates only when it has a safe identity.

### Embedding-space guard and migration

Dense `EmbeddingSpace` includes name, version, dimensions, modalities,
normalization, role-task mappings, and the full vector-semantic fingerprint.
Namespaces persist a full 64-character SHA-256 digest plus name and dimensions.

Before any vector write, an indexer compares its configured space with the
namespace record. A retriever performs the same check before query embedding or
search. Legacy vectors may supply a metadata fallback until a namespace record
exists. A mismatch throws `EmbeddingSpaceMismatchError`; migration is a full
reindex after `clear()`, or a new namespace. `deleteSource()` does not erase the
namespace space identity.

## Provider Conformance

| Provider                                                                                                      | Native request shape                                                                                             | Mapping to the Core contract                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Google `gemini-embedding-2`](https://ai.google.dev/gemini-api/docs/embeddings)                               | `Content` values containing text, inline data, or file data; separate `Content` objects produce separate vectors | Text, image, audio, video, and document inputs map one-to-one. Known literal ids supply model-aware modality defaults.                                         |
| OpenAI hosted embeddings                                                                                      | Text values                                                                                                      | Declares `['text']`; media fails in Core before the client call.                                                                                               |
| Anthropic                                                                                                     | No direct embedding API                                                                                          | No embedding factory or throwing stub.                                                                                                                         |
| AI SDK 6 / provider V3                                                                                        | `EmbeddingModelV3CallOptions.values: Array<string>`                                                              | Declares `['text']`; no multimodal emulation.                                                                                                                  |
| [Cohere Embed v4](https://docs.cohere.com/v1/docs/semantic-search-embed)                                      | `inputs[].content[]` supports text and image parts; `input_type` distinguishes search query/document             | A future adapter can map a single Core text or image input and map roles to `input_type`. Cohere's mixed-part aggregate form remains deferred.                 |
| [Amazon Titan Multimodal G1](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html) | `inputText` and/or base64 `inputImage`, with selectable output length                                            | A future adapter can map one text or image input to the same Core union. Output length participates in dimensions; combined text/image input remains deferred. |

These independent shapes show why Core owns normalized modality values and role
semantics, not Google `Content`, Cohere content arrays, or Bedrock JSON.

Convex integration is deferred; it continues to reuse its selected embedding
and vector ownership rather than gaining a hidden second implementation.

## Evaluation Specification

Wiring correctness and model quality are separate gates. Deterministic fake
providers prove request mapping, attribution hydration, byte safety, space
guards, and text-to-image, image-to-image, and image-to-text plumbing. They do
not establish ranking quality.

A representative model evaluation must contain at least 20 images across at
least four categories. Each category needs multiple positive matches and hard
negatives, such as a dog photo, wolf photo, and dog drawing. Every fixture has
a stable id, category, media asset, human-authored text queries, relevance
labels, and a caption used only by the baseline arm.

Run and report these directions independently:

| Direction      | Query               | Indexed candidates          | Metrics       |
| -------------- | ------------------- | --------------------------- | ------------- |
| text-to-image  | Human-authored text | Native image vectors        | recall@5, MRR |
| image-to-image | Image               | Native image vectors        | recall@5, MRR |
| image-to-text  | Image               | Human-authored text records | recall@5, MRR |

The baseline indexes captions with a text embedding. Text-to-image queries the
caption index directly; image-to-image and image-to-text first use the fixture's
caption for the query image. Results must show native and caption-derived arms
side by side, per direction and category, without claiming one direction proves
another.

A model-upgrade case indexes with one embedding, configures a changed model or
space identity, asserts the digest guard throws before provider/search I/O,
then clears or changes namespace and reindexes successfully. An optional real
Google smoke may use no more than 30 embedding calls, but requires an explicit
API key and consent to spend before it is run.

Multimodal similarity is ranking, not an exact-duplicate guarantee. Exact
identity uses SHA-256. Near-duplicate detection may need a future perceptual
hash. No quality claim is made for fashion, medical imagery, faces, products,
or another domain without representative domain evaluation.

## Observability and Static Analysis

Runtime observability emits bounded modality, role, space digest, dimensions,
counts, usage, and cost. It never emits raw media or vectors. Existing
embedding, indexing, source, and retrieval graph records carry the operation
relationships; `RetrieverHit` remains the one result shape.

Project Index emits embedding definitions and callsites, consumer dependency
relations, and conclusive lints for unsupported modalities, sparse/media
combinations, and shared-namespace identity mismatches. Runtime validation
remains authoritative. Devtools resolves those relations into catalog cards,
renders the lints through its standard Health view, and presents byte-safe
embedding and retrieval attribution evidence in Run Detail.

## Acceptance Checklist Cross-check

- Google plus Cohere and Titan were checked against independent native request
  shapes; only Google ships an adapter in this release.
- Both public type prototypes are recorded above; compile-time fixtures cover
  allowed and rejected modality combinations.
- Text-only inference is preserved by the `['text']` default.
- Adapter capability fixtures use declared modalities and recorded requests,
  not a public runtime registry.
- Space identity, vector metadata, cache invalidation, byte safety, attribution,
  and reindex migration are implemented and tested.
- Native-versus-caption benchmark results are not claimed; the reproducible
  evaluation contract is defined above as the release gate for quality claims.
- Project Index facts/lints ship through the backend-neutral semantic evidence
  contract and have dedicated catalog, Health, and Run Detail presentation.
- The incremental implementation plan was executed through the local workplan;
  this RFC records the resulting accepted design.

## Deferred Work

- Composite mixed text/media inputs and provider-side aggregate vectors.
- Perceptual-hash near-duplicate detection.
- A runtime `CruxIngestWarning` when sparse-only indexing drops media.
- Explicit vector-store identity in the namespace guard contract; until then,
  distinct vector stores sharing a record store must use distinct namespaces.
- Convex, Cohere, and Bedrock embedding adapters.
- Media splitting helpers for pages, regions, and time intervals.
- Media input for LLM-facing retrieval tools.
