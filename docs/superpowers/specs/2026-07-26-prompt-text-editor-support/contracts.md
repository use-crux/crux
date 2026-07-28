# PromptText editor contracts

Parent: [PromptText editor support](../2026-07-26-prompt-text-editor-support-design.md)

## Transient query

The request contains:

- protocol version;
- file, language, open epoch, document version, source hash, and text;
- bounded proven fragment source refs/snippets and exact interpolation joins;
  and
- centralized size, candidate, traversal, and output limits.

Each analyzed template contains:

- request-local candidate identity;
- tag and template ranges;
- literal islands and interpolation barriers;
- projection-to-source mappings;
- normalized blocks, spans, links, and nesting; and
- static preview text, segments, placeholders, and truncation.

The preview evidence is backend-neutral. Fragment records contain IDs, display
symbols, snippets, hashes, and source locations. Join records identify one
exact interpolation and its proven fragment target. Neither contains compiler
AST/checker objects. Missing or uncertain joins remain placeholders.

Preview segments distinguish authored literals, known values, named fragments,
and placeholders. Their concatenation reconstructs preview text exactly.
Truncation is metadata and never contributes document bytes.

### Literal projection and source mapping

CommonMark consumes ECMAScript-cooked template text after the construction-time
whitespace normalization performed by Core's `createTemplateNode`. It never
consumes raw quasi bytes or fully rendered PromptText output.

The transient compiler applies these steps in order:

1. Use each Oxc quasi's `value.cooked`; do not decode escapes independently.
2. If any quasi has no cooked value, retain the candidate envelope and ranges
   but mark the template `unsupported`. Literal islands, mappings, structure,
   links, nesting, and preview are all empty. Raw text is never a fallback.
3. Weave cooked quasis with opaque interpolation barriers and split cooked
   lines on LF.
4. Apply exactly Core's construction normalization: trim authored outer blank
   lines, compute the exact space/tab common prefix across nonblank logical
   lines, and remove that prefix. Tabs are characters, not visual columns.
5. Classify every resulting literal island independently. CommonMark state and
   constructs never cross an interpolation barrier.

This normalization excludes render-time interpolation expansion, block-value
indentation, empty-block seam removal, fragment rendering, and segment
coalescing. ECMAScript cooking owns escape interpretation and line-terminator
normalization, so authored CRLF projects as LF and escaped newlines, tabs,
backticks, backslashes, Unicode escapes, and line continuations follow the Oxc
cooked value.

An unpaired UTF-16 surrogate in any cooked quasi also makes only its containing
template `unsupported`. The request remains `complete` unless an independent
request-wide condition changes it, and other candidates remain analyzable. The
unsupported template retains its candidate, tag, template, and two exact
backtick ranges. Its literal islands, interpolation barriers, mappings, blocks,
spans, links, nesting, preview text, and preview segments are empty. CommonMark
never
receives Oxc's private U+FFFD-plus-hex surrogate marker or a substituted
replacement character.

Adjacent high and low surrogate code units in the same cooked quasi are
reconstructed as their Unicode scalar and remain supported, regardless of the
escape spellings that produced them. They do not pair across an interpolation
barrier. The scalar has UTF-16 projection length two and maps nonlinearly to
the complete authored spans that produced both code units. A genuine U+FFFD
remains supported and distinct whether literal or escaped, with an exact
mapping to its authored representation. Raw surrogate source bytes are invalid
UTF-8 request input rather than replacement-character text.

Source mappings are ordered by island and projection start, nonoverlapping, and
half-open. They segment every nonlinear transformation or removed normalization
span. Ordinary retained text may be coalesced one-to-one. A cooked code unit
may map to the complete authored escape or CRLF range; unequal projection and
source lengths are valid. Removed indentation, trimmed lines, and line
continuations have no projected span. `projectionLength` is the normalized
cooked island's UTF-16 length.

A normalized structure record is publishable only when both endpoints of every
required classifier range map unambiguously. Otherwise the compiler suppresses
that record instead of widening or guessing. Mappings and published editor
ranges must never overlap a tag, backtick, interpolation delimiter, or
interpolation expression.

### Preview-evidence identity

The transient coordinator computes the preview-evidence digest; callers supply
fragments and joins, never a trusted digest. It validates both vectors, sorts
the same records that will be sent to the worker, and hashes this canonical
byte stream with SHA-256:

```text
ASCII "crux-prompt-text-preview-evidence-v1\0"
u32be(fragment count)
fragment records sorted lexicographically by their complete encoded record bytes
u32be(join count)
join records sorted lexicographically by their complete encoded record bytes
```

Each fragment record encodes these fields in order:

```text
id, symbol, file, sourceHash, start.line, start.character,
end.line, end.character, snippet
```

Each join record encodes these fields in order:

```text
key.file, key.sourceHash,
key.templateRange.start.line, key.templateRange.start.character,
key.templateRange.end.line, key.templateRange.end.character,
key.interpolation,
key.expressionRange.start.line, key.expressionRange.start.character,
key.expressionRange.end.line, key.expressionRange.end.character,
fragmentId,
u8 proof // 1 = semantic-exact
```

Strings encode as `u32be(UTF-8 byte length) || exact UTF-8 bytes`; positions,
counts, and the interpolation ordinal encode as `u32be`. Digesting does not
normalize Unicode, paths, line endings, or hashes, and it does not use JSON.
Evidence construction must already have produced canonical file and
source-hash values. A repeated fragment ID or join key, including an identical
duplicate, is invalid.

The empty evidence digest is SHA-256 over the domain prefix followed by zero
fragment and join counts:

```text
6e6550df1ee9835c362c9f846fc0327d5cec77c9c0dea2f7768c8aa550679895
```

Invalid UTF-8 or length overflow, malformed ranges, noncanonical required
identity fields, duplicate IDs or join keys, dangling targets, invalid proofs,
and evidence-limit violations make transient analysis unavailable. A join
owner must be the exact document or a supplied fragment. The coordinator does
not call the worker or reuse a prior result. The digest enters the
coalescing/cache key beside the selected view revision.

This digest is private PromptText preview-evidence identity. Its domain, inputs, and
lifecycle are distinct from #266's semantic-source-profile digest; neither may
substitute for, include, or be included in the other.

`maxFragmentBytes` bounds the sum of all canonical encoded fragment and join
record lengths, not each snippet or record:

```text
sum(encoded_fragment.len) + sum(encoded_join.len) <= maxFragmentBytes
```

The count includes every length prefix, exact UTF-8 string, position,
interpolation ordinal, and proof byte described above. It excludes the digest
domain prefix, vector count words, digest bytes, JSON syntax and escaping, and
all request fields outside the evidence records.

Go checks `maxFragments` and `maxFragmentJoins` first, then validates and
encodes records in caller order and accumulates encoded lengths with checked
`u64` addition. Equality fits. Excess or arithmetic/length overflow fails
closed. A zero byte or matching count limit permits only an empty corresponding
vector; the limits are conjunctive. Sorting occurs only after every record and
the aggregate budget validate. A failure yields no canonical vectors or
digest, cannot reuse a cached/coalesced result, and never invokes the worker.

The strict ATTACHED V1 request-body limit is:

```text
MaxRequestBytes =
    6 * MaxDocumentBytes
  + 6 * defaultMaxFragmentBytes
  + 64 KiB
```

At the V1 defaults this is `13_041_664` bytes. The final 64 KiB is fixed JSON
envelope allowance for field names, quotes, punctuation, numeric rendering,
revision/file/language metadata, and at most 256 fragment plus 256 join
objects; it is not evidence-payload capacity. A known larger `Content-Length`
returns HTTP 413 before decoding. The identical `http.MaxBytesReader` bound
handles absent or dishonest lengths and also returns 413 without analyzer
invocation.

### Native query ABI v1

The persistent compiler method is `promptTextQuery`; its protocol version is
`1`. The following Rust records are the single source of truth for the
Rust-to-Go JSON ABI. JSON field names are camel case. Every source position is
zero-based UTF-16 and every range is half-open. Projection offsets are
zero-based UTF-16 code-unit offsets within one literal island; parser-private
UTF-8 byte offsets never cross this boundary.

```rust
pub const PROMPT_TEXT_QUERY_METHOD: &str = "promptTextQuery";
pub const PROMPT_TEXT_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextRange {
    pub start: PromptTextPosition,
    pub end: PromptTextPosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextOffsetRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextDocumentRevision {
    pub open_epoch: u64,
    pub version: i64,
    pub source_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextAnalysisStatus {
    Complete,
    Truncated,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextLimits {
    pub max_source_bytes: u32,
    pub max_templates: u32,
    pub max_template_bytes: u32,
    pub max_traversal_nodes: u32,
    pub max_output_bytes: u32,
    pub max_string_refactors: u32,
    pub max_string_refactor_bytes: u32,
    pub max_string_refactor_output_bytes: u32,
    pub max_fragments: u32,
    pub max_fragment_joins: u32,
    pub max_fragment_bytes: u32,
    pub max_fragment_depth: u32,
    pub max_preview_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextFragment {
    pub id: String,
    pub symbol: String,
    pub file: String,
    pub source_hash: String,
    pub range: PromptTextRange,
    pub snippet: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextEvidenceProof {
    SemanticExact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextInterpolationJoinKey {
    pub file: String,
    pub source_hash: String,
    pub template_range: PromptTextRange,
    pub interpolation: u32,
    pub expression_range: PromptTextRange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextFragmentJoin {
    pub key: PromptTextInterpolationJoinKey,
    pub fragment_id: String,
    pub proof: PromptTextEvidenceProof,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextQueryRequest {
    pub protocol_version: u16,
    pub file: String,
    pub language_id: String,
    pub revision: PromptTextDocumentRevision,
    pub source: String,
    pub fragments: Vec<PromptTextFragment>,
    pub fragment_joins: Vec<PromptTextFragmentJoin>,
    pub limits: PromptTextLimits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextWorkerRequest {
    pub id: u64,
    pub method: String,
    pub query: PromptTextQueryRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextLiteralIsland {
    pub index: u32,
    pub range: PromptTextRange,
    pub projection_length: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextLineIsolationEdit {
    /// Half-open UTF-16 source range replaced by the edit.
    pub range: PromptTextRange,
    /// Exact authored source text currently occupying `range`.
    pub expected_text: String,
    /// Exact replacement text.
    pub new_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextInterpolationBarrier {
    pub index: u32,
    pub range: PromptTextRange,
    pub expression_range: PromptTextRange,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_isolation_edit: Option<PromptTextLineIsolationEdit>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextRefactorProofLevel {
    SyntaxExact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextRefactorProof {
    OrdinaryStringToMd {
        candidate_id: u32,
        range: PromptTextRange,
        expected_text: String,
        template_text: String,
        proof: PromptTextRefactorProofLevel,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextRefactorAnalysis {
    pub status: PromptTextAnalysisStatus,
    pub proofs: Vec<PromptTextRefactorProof>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextSourceMapping {
    pub island: u32,
    pub projection_range: PromptTextOffsetRange,
    pub source_range: PromptTextRange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextBlock {
    Heading {
        index: u32,
        island: u32,
        level: u8,
        label: String,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    Paragraph {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    Blockquote {
        index: u32,
        island: u32,
        range: PromptTextRange,
        marker_ranges: Vec<PromptTextRange>,
    },
    List {
        index: u32,
        island: u32,
        range: PromptTextRange,
        ordered: bool,
        start: Option<u64>,
    },
    ListItem {
        index: u32,
        island: u32,
        range: PromptTextRange,
        marker_range: PromptTextRange,
    },
    CodeBlock {
        index: u32,
        island: u32,
        range: PromptTextRange,
        content_range: PromptTextRange,
        fenced: bool,
        info: Option<String>,
    },
    ThematicBreak {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    Html {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextSpan {
    Emphasis {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    Strong {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    InlineCode {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    Html {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    SoftBreak {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    HardBreak {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextLink {
    Inline {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
        destination_range: PromptTextRange,
        destination: String,
        title: Option<String>,
    },
    Autolink {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
        destination: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextNodeRef {
    Block { index: u32 },
    Span { index: u32 },
    Link { index: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextNesting {
    pub parent: PromptTextNodeRef,
    pub child: PromptTextNodeRef,
    pub ordinal: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextPreviewSegment {
    AuthoredLiteral {
        text: String,
        range: PromptTextRange,
    },
    KnownValue {
        text: String,
        interpolation: u32,
        interpolation_path: Vec<u32>,
    },
    Fragment {
        text: String,
        fragment_id: String,
        source_hash: String,
    },
    Placeholder {
        text: String,
        interpolation: u32,
        interpolation_path: Vec<u32>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextPreviewEvidence {
    SyntaxExact,
    SemanticExact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PromptTextPreviewStatus {
    Complete,
    Truncated,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextPreviewTruncationReason {
    MaxPreviewBytes,
    MaxFragmentDepth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextPreviewTruncation {
    pub reason: PromptTextPreviewTruncationReason,
    pub limit: u32,
    pub emitted_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextPreview {
    pub status: PromptTextPreviewStatus,
    pub evidence: Option<PromptTextPreviewEvidence>,
    pub text: String,
    pub segments: Vec<PromptTextPreviewSegment>,
    pub truncation: Option<PromptTextPreviewTruncation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextTemplate {
    pub candidate_id: u32,
    pub range: PromptTextRange,
    pub tag_range: PromptTextRange,
    pub template_range: PromptTextRange,
    pub backtick_ranges: [PromptTextRange; 2],
    pub status: PromptTextAnalysisStatus,
    pub literal_islands: Vec<PromptTextLiteralIsland>,
    pub interpolation_barriers: Vec<PromptTextInterpolationBarrier>,
    pub mappings: Vec<PromptTextSourceMapping>,
    pub blocks: Vec<PromptTextBlock>,
    pub spans: Vec<PromptTextSpan>,
    pub links: Vec<PromptTextLink>,
    pub nesting: Vec<PromptTextNesting>,
    pub preview: PromptTextPreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextQueryResponse {
    pub protocol_version: u16,
    pub file: String,
    pub revision: PromptTextDocumentRevision,
    pub status: PromptTextAnalysisStatus,
    pub templates: Vec<PromptTextTemplate>,
    pub refactors: PromptTextRefactorAnalysis,
}
```

Join coordinates are absolute, zero-based UTF-16 and half-open.
`templateRange` is the complete tagged-template range; `expressionRange` is
the expression-only barrier range. Rust accepts a join only when Oxc
independently finds that exact owner template, interpolation ordinal, and
expression range in the current source or matching supplied fragment. It never
guesses by `symbol`.

Go obtains joins only from one coherent `EvidenceSemantic + RequireCurrent`
view. Structured semantic evidence names the owner template range,
interpolation ordinal/range, and resolved target `ProjectSourceRef`; Go adds
exact source hashes from that publication. Both semantic backends emit this
narrow evidence with parity. Missing, ambiguous, stale, partial,
lifecycle-mismatched, cross-owner, or non-resolved evidence is omitted. Saved
joins are never transformed or reused for dirty bytes.

Oxc/Rust owns all syntax-exact scalar, array, JSON, and same-document fragment
evaluation. Go never supplies rendered value bytes, parses TypeScript, or
evaluates expressions. No persistent constant-value facts are added.

The backend-neutral Project Index record is attached to the owning source ref:

```ts
/**
 * Describes how a canonical PromptText template was reached from its owning
 * definition. Compiler-owned semantic evidence is never inferred by editor or
 * transport consumers.
 */
export type PromptTextSourceKind =
  | "owner"
  | "named-fragment"
  | "anonymous-fragment";

export interface PromptTextFragmentJoinEvidence {
  readonly kind: "named-fragment";
  readonly ownerSourceRefId: string;
  readonly ownerTemplateRange: SourceSnippet["range"];
  readonly interpolationIndex: number;
  readonly expressionRange: SourceSnippet["range"];
  readonly targetSourceRefId: string;
  readonly targetTemplateRange: SourceSnippet["range"];
  readonly proof: "semantic-exact";
}

export interface ProjectSourceRef {
  readonly metadata?: {
    readonly promptText?: {
      readonly tag: "md";
      readonly language: "markdown";
      readonly lifecycle: "static" | "dynamic";
      readonly sourceKind: PromptTextSourceKind;
      readonly fragmentJoins?: readonly PromptTextFragmentJoinEvidence[];
    };
  };
}
```

Export `PromptTextSourceKindSchema` and require it from the strict
`ProjectSourceRefSchema`. Whenever `metadata.promptText` exists, `sourceKind`
is required for static and dynamic refs. New producers emit fields in the
stable order `tag`, `language`, `lifecycle`, `sourceKind`, then optional
`fragmentJoins`. Missing, null, unknown, or foreign values fail schema
validation. This classification is saved semantic evidence and does not amend
the transient Rust V1 ABI.

The shared semantic reachability model assigns `sourceKind` before either
backend projects facts:

- `owner` means a tagged template used directly as a manifest-declared
  `prompt` or `system` field, or returned directly from a supported callback
  branch. Transparent wrappers and canonical tag aliases/namespace access do
  not change it.
- `named-fragment` means the template was reached through an exactly resolved
  terminal `const` identifier or accepted object-property access. Local,
  imported, aliased, default-imported, star-exported, and resolvable re-export
  chains qualify. It remains named when it is the whole field value, when no
  join survives, or when a cyclic/ambiguous occurrence suppresses its join.
  Its `symbol` is required and nonempty.
- `anonymous-fragment` means a canonical tagged template found within another
  template's interpolation traversal without an accepted named binding,
  including supported nested expression branches. Its `symbol` is absent or
  empty.

Traversal carries an explicit root-versus-nested origin. Do not derive owner
versus anonymous from node/range equality or the final join set. Named
resolution overrides traversal origin. Shared physical templates retain one
definition-scoped ref per owner. Cycles retain named classification while
their joins remain suppressed. Ambiguous or unresolved declarations/re-exports
emit no ref, and unreachable standalone `md` constants remain outside the
Project Index. Role never determines `sourceKind`: direct system templates are
owners, named system targets are named fragments, and nested system templates
are anonymous fragments.

The existing top-level `metadata.fragment` field remains an independent legacy
marker. System-role refs continue emitting `fragment: true`; prompt-role refs
continue omitting it; producers never emit `false`. No PromptText semantic,
transport, editor, preview, navigation, hover, decoration, symbol, link, or
diagnostic consumer may use it to classify PromptText. In particular, a direct
system owner with the marker is still an owner, while a prompt-role named
fragment without the marker remains named.

`SourceSnippet["range"]` is the existing file plus one-based, half-open
line/column representation. The owner ID equals the ref carrying the array.
Owner and target are exact, untruncated, resolved canonical `md` source refs in
the same definition, role, property, lifecycle, and semantic result. Their
template ranges equal their snippet ranges, and the expression range is
contained by its owner.

There is one record per proven named-fragment occurrence. Sort by interpolation
index, expression range, then target ID. Duplicate owner/interpolation/range
keys, multiple targets for one key, unresolved/partial targets, and ambiguous
or cyclic resolution emit no join for that occurrence. Target refs retain
existing source-ref deduplication; multiplicity exists only in the owner's
array.

Go resolves both IDs and source-row hashes inside the selected immutable
publication, converts one-based ranges to zero-based UTF-16, and builds the
worker join. A join target must be `named-fragment`; its owner may have any
recognized source kind. A missing row/hash or failed invariant suppresses it.
Both semantic backends emit identical source kinds; the native direct path
consumes shared reachability classification or falls back to the complete
shared analyzer. It must not duplicate classification in its manifest.

These records change semantic facts and the Go snapshot. Phase 14's already
planned `SEMANTIC_FACTS_CACHE_EPOCH = "semantic-facts-v37"` and
`ProjectIndexSnapshotCacheEpoch = 50` jointly own refactor metadata and
PromptText source classification; do not bump them a second time in this
unreleased worktree. Pre-v37/pre-50 artifacts miss and rebuild. A live legacy
record without `sourceKind` contributes no transformed PromptText view until
reindex; it never falls back to `metadata.fragment`, `symbol`, nesting, or
joins. Preserve `sourceKind` and the independent legacy marker through worker
facts, Store/read-model capture, SQLite restart, snapshot/delta transport, OWN,
and ATTACHED. Do not bump `STATIC_PARSE_CACHE_EPOCH` or
`SEMANTIC_COMPILER_OPTIONS_ID`.

The request-level status describes the file query:

- `unsupported` requires an empty template list because the request language or
  source cannot be analyzed;
- `truncated` means request-wide candidate, traversal, or output accounting
  could not prove a complete template list. Included templates remain whole;
  zero or more later templates may have been omitted; and
- `complete` means no whole template was omitted.

Each included template has its own authoritative status. `truncated` means its
payload is a safe bounded prefix; `unsupported` requires all payload
collections and preview to be empty. Consumers never downgrade a complete
included template because the request-level status is truncated.

Preview status is independent:

- `complete` requires evidence and has no truncation;
- `truncated` requires evidence and truncation metadata;
- `unavailable` has no evidence or truncation and has empty text and segments;
  and
- structural `unsupported` makes preview unavailable, while preview truncation
  never changes template status.

Concatenating nonempty, source-ordered preview segment text must equal
`preview.text`; adjacent identical provenance is coalesced. A semantic-exact
preview has at least one accepted semantic join; every other available preview
is syntax-exact. Semantic fragment segments use the catalogue ID.
Syntax-local/direct fragments use `document:<candidateId>`.

If `maxOutputBytes` rejects a finalized compact template object, that entire
template and all later templates are omitted and only request status becomes
`truncated`. Preview status does not replace structural output-byte accounting.

#### V1 document-link projection and trust policy

PromptText links use the standard `textDocument/documentLink` request. Server
initialization advertises exactly:

```json
{
  "documentLinkProvider": {
    "resolveProvider": false
  }
}
```

Every returned link contains its final validated `target`. The server does not
register `documentLink/resolve`, and returned links omit `data`, `tooltip`, and
all Crux-private fields. Rejected destinations produce no unresolved record.
Results preserve Rust/source order. Unavailable, stale, cancelled, or
superseded analysis returns a non-nil empty array and never substitutes an
older result.

`DocumentLink.range` is Rust's parser-proven `textRange` for both inline links
and autolinks. A missing, invalid, zero-width, out-of-island, or
barrier-crossing `textRange` suppresses the record. Go never widens it to the
full construct `range` or substitutes inline `destinationRange`; inline titles
never participate in the clickable range. Reference-style links are
non-publishable throughout V1; Rust does not resolve or guess definitions for
this feature.

Rust supplies the CommonMark-decoded literal `destination`. Go does not rescan
Markdown or slice source. Before classifying that string, Go:

1. requires a nonempty, valid UTF-8 string;
2. rejects every literal Unicode whitespace scalar, C0 control, DEL, NUL, and
   raw backslash;
3. requires every percent sign to begin exactly two ASCII hexadecimal digits;
4. parses one RFC 3986 URI reference, then percent-decodes each syntactic
   component exactly once for validation, using URI percent semantics rather
   than form/query `+` semantics;
5. rejects decoded invalid UTF-8, NUL, C0 controls, DEL, and backslash; and
6. never trims, environment-expands, home-expands, or decodes a second time.

Here, literal Unicode whitespace means the fixed Unicode White_Space set
`U+0009..U+000D`, `U+0020`, `U+0085`, `U+00A0`, `U+1680`,
`U+2000..U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, and `U+3000`.
Do not delegate this decision to a locale-sensitive predicate.

For example, `%252e` denotes literal filename text `%2e`; it does not become
`.`. Percent-decoded non-control whitespace may remain a filename or URI
component even though the ambiguous raw-whitespace spelling is rejected.

Authored absolute web targets accept only `http` and `https`,
case-insensitively, and normalize the scheme to lowercase. They must use
hierarchical `scheme://authority` form with no opaque component, no userinfo,
and a nonempty ASCII host. DNS/reg-name, IPv4, and bracketed IPv6 hosts are
allowed. Percent-escaped hosts and IPv6 zone identifiers are rejected. An
optional port must contain only decimal ASCII digits and have value
`1..65535`; empty, zero, nondecimal, overflow, and malformed ports are
rejected. Query and fragment are allowed. Web path dot segments and encoded
slashes retain web-server semantics and are not cleaned. Go serializes the
validated URI after lowercasing its scheme and never fetches, probes, or
resolves its host.

Protocol-relative `//host/path` references and every other authored scheme are
rejected, including `file`, `command`, `javascript`, `data`, `mailto`, `ftp`,
and unknown schemes. CommonMark email autolinks therefore produce no V1
document link.

A workspace-local target has no scheme or authority, a nonempty relative path,
no query, and an optional fragment. Fragment-only references are suppressed.
`guide.md#usage` is allowed; `guide.md?mode=raw` and `#usage` are not.
Absolute and root-relative paths, Windows drive and UNC forms, raw
backslashes, and percent-encoded `/` or `\` path separators are rejected.

Local path resolution is deterministic and lexical:

1. inspect the escaped path and reject encoded separators;
2. percent-decode it exactly once and interpret `/` as its path separator;
3. require cleaned absolute source-file and active-scope-root inputs;
4. resolve against `filepath.Dir(sourceFile)` and apply lexical
   `filepath.Clean`;
5. use `filepath.Rel` to require both the source file and result to remain
   inside the cleaned active scope root; and
6. construct a fresh escaped `file:` URI from the cleaned absolute result,
   attaching the already parsed fragment through URI serialization rather than
   string concatenation.

Literal or percent-encoded `..` is allowed when this cleaned result remains
inside the scope and rejected when it escapes. Thus
`../guide.md` from `scope/docs/source.ts` may resolve to
`scope/guide.md`; `../../outside.md` does not. An encoded dot segment is
decoded once before the same containment check. Percent-encoded separators
remain rejected because decoding them would change the parsed component
boundaries.

Existence is irrelevant: a lexically valid target is returned even when no
file currently exists. Production resolution must not call `EvalSymlinks`,
`Lstat`, `Stat`, open/read APIs, directory traversal, DNS, or network APIs.
Crux proves lexical containment only. It makes no claim about a physical
target reached through an existing symlink after the user activates the link;
that traversal belongs to VS Code and the operating system.

Heading `range` contains the complete construct, including `#` markers and
trailing authored content. `textRange` contains only the parser-proven heading
text. Go and VS Code must never derive either range from the other.

Heading `label` is a required, nonempty, provider-neutral display value emitted
by Rust from the same balanced CommonMark event vector that produced the
heading record. Go and VS Code never slice `textRange`, rescan source, or parse
Markdown to derive it.

For each `Start(Tag::Heading)`, Rust finds the balanced matching heading end and
walks only the intervening events:

- `Text` appends the parser-decoded value, so CommonMark entities and
  backslash escapes contribute their decoded characters.
- `Code` appends the parser-produced code value. Pulldown-cmark's code-span
  normalization is authoritative before the label's whitespace normalization.
- `SoftBreak` and `HardBreak` each contribute one whitespace boundary.
- `InlineHtml`, including tags, declarations, processing instructions, and
  comments, contributes nothing and no separator. Text between HTML events
  still arrives as `Text` and is retained.
- `Start` and `End` contribute nothing. Link/autolink visible child events and
  image alt child events are retained, while destinations, titles, and
  reference identifiers are never read.
- `Html`, `FootnoteReference`, `TaskListMarker`, `InlineMath`, `DisplayMath`,
  and `Rule` cannot occur in a heading under V1's `Options::empty()`. If
  encountered defensively, they contribute nothing and no separator. Enabling
  a parser option that makes one meaningful requires a contract amendment.

Whitespace is exactly Unicode White_Space:

```text
U+0009..U+000D, U+0020, U+0085, U+00A0, U+1680,
U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
```

Every nonempty whitespace run becomes one ASCII space and leading/trailing
whitespace is removed. Adjacent retained event fragments receive no implicit
separator. No NFC/NFKC normalization, case folding, punctuation rewriting, or
grapheme rewriting occurs; all other Unicode scalar values are preserved.
Empty normalized output becomes the exact, nonlocalized fallback
`Heading <level>`, such as `Heading 3`.

Label construction is template- and island-local and never crosses an
interpolation barrier. Malformed inline syntax that CommonMark emits as literal
`Text` remains visible as parser-decoded text. If the balanced heading end is
unexpectedly absent, Rust suppresses the heading record rather than rescanning
source or manufacturing a label.

PromptText ABI V1 is amended in place because it is unreleased and Rust, Go,
the worker, OWN, and ATTACHED ship atomically. Rust's `label: String` is
required with no default, optional representation, or serialization omission.
Go's flat tagged-union carrier uses `Label *string` to distinguish absence,
while its typed `PromptTextHeading` exposes `Label string`. `Heading()` rejects
a non-heading, missing `textRange`, missing or empty label, or level outside
1–6. Heading JSON marshaling requires a nonempty label and omits the field for
all other block variants.

The shared V1 golden heading gains `"label": "Hello"`. Rust protocol/static
compiler/worker assertions, strict Go decode/round-trip and typed-accessor
assertions, Go service equality, and OWN/ATTACHED parity update atomically.

The label is part of the finalized `PromptTextTemplate`, so existing
`maxOutputBytes` accounting charges its complete compact JSON representation,
including the field name, quotes, escaping, and UTF-8 label bytes. If `N` is
the finalized serialized template length, `N` fits and `N - 1` truncates; the
existing inter-template comma rule is unchanged. Tests derive `N` from the
final object rather than preserving a pre-label size. Input-side
`maxTemplateBytes` and ATTACHED request bounds do not change.

#### V1 traversal and output accounting

`maxTraversalNodes` and `maxOutputBytes` are enforced by the Phase 3 tracer.
They are request-wide fail-closed limits, not advisory telemetry.

`maxTraversalNodes` counts exactly the number returned by the completed Oxc
semantic node table's `len()` operation. The count includes whatever entries
Oxc places in that table and does not double-charge tagged-template quasis,
interpolation expressions, CommonMark events, normalized records, mapping
conversions, or serialization. The source-byte limit bounds parsing and
semantic construction; the traversal limit bounds whether compiler-owned
candidate projection may begin.

- `semantic.nodes().len() <= maxTraversalNodes` permits candidate projection;
- a larger count returns request-level `truncated` with an empty template
  list; and
- a zero limit therefore permits only a genuinely empty semantic node table.

This deliberately omits the entire request result rather than returning a
prefix tied to Oxc node ordering. It keeps every included template whole and
makes an Oxc upgrade's node-table change fail closed.

`maxOutputBytes` counts the variable serialized template payload, not fixed
transport metadata. For each final `PromptTextTemplate` in source order, Rust
uses compact `serde_json` UTF-8 serialization and charges:

```text
serialized template object bytes
+ one comma byte when a prior template is already retained
```

The outer `templates` array brackets, the `PromptTextQueryResponse` fields, the
worker response envelope and request ID, newline/framing bytes, and HTTP or
JSON-RPC envelopes do not count. This exclusion guarantees that an empty,
versioned `truncated` response can always be returned.

A template is appended only when its entire charge keeps the cumulative total
at or below `maxOutputBytes`. At the first overflow, that template and every
later template are omitted and request status becomes `truncated`; the
compiler never skips a large template to retain a later small one. An exact
boundary fits. A zero limit returns `complete` for no candidates and
`truncated` with no templates when any candidate would otherwise be retained.
The charge is calculated after template-level status and payload limits are
final, so later phases extend the same rule without changing V1 accounting.

The golden ABI fixture is
`packages/indexer/src/contracts/fixtures/prompt-text-query-v1.json`. It contains
one complete worker request and response envelope. Rust must assert exact
serialization and Go must assert exact decoding against that same file.

### Decoration request

Decorations are pull-only. The client schedules
`crux/promptText/decorations`; the server never pushes decoration payloads.
The versioned request and response are:

```ts
type PromptTextDecorationRequest = {
  protocolVersion: 1;
  uri: string;
  openEpoch: number;
  version: number;
  sourceHash: string;
};

type PromptTextDecorationResult = {
  protocolVersion: 1;
  uri: string;
  openEpoch: number;
  version: number;
  sourceHash: string;
  decorations: Array<{
    role:
      | "heading"
      | "link"
      | "code"
      | "emphasis"
      | "strong"
      | "list"
      | "blockquote";
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }>;
};
```

The server echoes the complete stamp. The client computes its own current
stamp and discards any mismatched result. A non-nil empty `decorations` array
is the only clear payload. Document changes clear synchronously in the client
before the replacement request starts.

The dedicated highlighting switch is:

```json
{
  "crux.promptText.decorations.enabled": {
    "type": "boolean",
    "default": true,
    "scope": "window"
  }
}
```

It is owned only by the VS Code client and is never sent to Go or advertised
through LSP initialization. One controller-lifetime configuration listener
uses `affectsConfiguration("crux.promptText.decorations.enabled")`; the setting
is not language-overridable. Disabling synchronously cancels pending pulls and
clears every managed editor before the handler returns. Document events and
refresh requests do not pull while disabled. Enabling schedules fresh pulls
for all visible eligible editors.

The setting affects only mapped PromptText Markdown decorations. Folding,
symbols, links, diagnostics and actions, hover, navigation, and previews remain
enabled. It is independent of `crux.decorations.mode`, TypeScript semantic
highlighting, and semantic-token settings.

Each PromptText decoration type is created once per controller lifetime with
`ThemeColor` references. VS Code's automatic `ThemeColor` resolution is the
required no-reload theme update. The client must not listen for active-theme
changes, rebuild decoration types, clear ranges, or repull solely because the
theme changed.

Disposal first stops and cancels controller work, then disposes subscriptions,
then disposes every decoration type exactly once and releases editor
references. A completion arriving after disposal must never call
`setDecorations`. Visible repaint, range loss, artificial rendering, or
illegibility in Dark+, Light+, High Contrast Dark, or High Contrast Light is an
architecture stop gate rather than permission to rebuild types or change
transport.

`crux/promptText/refresh` is a capability-gated server-to-client request with
params `{ protocolVersion: 1 }` and a `null` result. The exact initialize-time
client capability is:

```ts
type CruxPromptTextClientCapabilities = {
  experimental?: {
    crux?: {
      promptText?: {
        refreshSupport?: boolean;
      };
    };
  };
};
```

The fully qualified field is
`capabilities.experimental.crux.promptText.refreshSupport`. Only literal
`true` enables refresh; absent, false, or malformed values mean unsupported.
The capability does not inherit from or imply inlay-hint, code-lens, semantic
token, or other standard refresh support. The request's `protocolVersion`
versions the method payload, so the capability remains a boolean.

VS Code advertises the field through a `vscode-languageclient` static feature
registered before `LanguageClient.start()`. The Go server decodes the
vendor-namespaced field into a dedicated PromptText refresh flag and never
branches on a generic `experimental` map after initialization.

The request is only an invalidation signal: the client schedules fresh pull
requests for visible editors, and it never carries decoration data. The server
sends it, best effort and only when supported, after:

- a coherent Project Index publication changes identity evidence used by
  PromptText decorations; or
- the selected transient source epoch/availability changes through
  OWN/ATTACHED handover, reconnect, or invalidation.

Document edits do not need the server signal because the client clears and
pulls from its own document lifecycle. The client returns `null` even when no
visible editor needs a pull.

### Canonical identity join

Transient Oxc candidates are tag-neutral and cannot prove PromptText identity.
Go joins a candidate only when all of the following are true:

1. the saved semantic backend emitted the resolved source ref through
   `canonicalPromptTextIdentity` and `isCanonicalPromptTextTag`, proving module
   `@use-crux/core` and export `md`;
2. the source ref language is `markdown` and lifecycle is `static`;
3. the source ref and candidate are in the same normalized file; and
4. the resolved source-ref snippet range exactly equals the candidate's whole
   tagged-template `range`.

The serialized metadata name `tag: "md"` is descriptive and is never identity
proof by itself. A local or shadowed `md`, an alias without canonical saved
evidence, or an off-by-one range produces no identity-sensitive output.

### Unified transient source

OWN and ATTACHED expose one `TransientSource` containing both completion and
PromptText query capabilities. Source replacement is atomic and
establish-before-retire: the new source and epoch become visible together, and
in-flight work that still matches its captured epoch is not cancelled merely
because the old transport is retired. The existing completion behavior and
tests are the compatibility fence for this extraction.

## Best available view

The Go boundary is request-relative:

```go
type EvidenceLevel string

const (
	EvidenceIndex    EvidenceLevel = "index"
	EvidenceSemantic EvidenceLevel = "semantic"
)

type FreshnessPolicy string

const (
	RequireCurrent     FreshnessPolicy = "require-current"
	AllowSavedFallback FreshnessPolicy = "allow-saved-fallback"
)

type DocumentRevision struct {
	OpenEpoch  uint64
	Version    int
	SourceHash string
}

type ViewRequest struct {
	ScopeID         string
	File            string
	Document        *DocumentRevision
	MinimumEvidence EvidenceLevel
	Freshness       FreshnessPolicy
}

type ViewProvider interface {
	BestAvailableView(ViewRequest) ViewSelection
}

type ViewOrigin string

const (
	ViewOriginSaved        ViewOrigin = "saved"
	ViewOriginDirtyOverlay ViewOrigin = "dirty-overlay"
)

type SourceOrigin string

const (
	SourceOriginSaved SourceOrigin = "saved"
	SourceOriginDirty SourceOrigin = "dirty"
)

type BufferMatch string

const (
	BufferMatchExact     BufferMatch = "exact"
	BufferMatchDifferent BufferMatch = "different"
	BufferMatchUnknown   BufferMatch = "unknown"
)

type ViewStatus string

const (
	ViewStatusExact         ViewStatus = "exact"
	ViewStatusSavedFallback ViewStatus = "saved-fallback"
	ViewStatusUnavailable   ViewStatus = "unavailable"
)

type ViewSelectionReason string

const (
	ViewReasonNone                 ViewSelectionReason = ""
	ViewReasonGenerationUnknown    ViewSelectionReason = "generation-unknown"
	ViewReasonSourceHashUnknown    ViewSelectionReason = "source-hash-unknown"
	ViewReasonSourceDifferent      ViewSelectionReason = "source-different"
	ViewReasonEvidenceInsufficient ViewSelectionReason = "evidence-insufficient"
	ViewReasonDirtyUnavailable     ViewSelectionReason = "dirty-unavailable"
)

type ViewStamp struct {
	ScopeID string

	BaseGeneration      uint64
	BaseGenerationKnown bool
	Revision             uint64
	OverlayRevision      uint64

	Origin   ViewOrigin
	Evidence EvidenceLevel
}

type SourceEvidence struct {
	File string

	Origin              SourceOrigin
	EffectiveSourceHash string
	BaseSourceHash      string
	Document            *DocumentRevision
	BufferMatch         BufferMatch
}

type ProjectIndexView struct {
	Stamp       ViewStamp
	Publication Publication
	Sources     map[string]SourceEvidence
}

type ViewSelection struct {
	Status ViewStatus
	View   *ProjectIndexView
	Reason ViewSelectionReason
}
```

Evidence levels are `index` and `semantic`. Freshness policies are
`require-current` and `allow-saved-fallback`.

`DocumentRevision` contains an open epoch, LSP version, and the same canonical
source hash representation as `IndexSourceFile.sourceHash`. Versions are
comparable only inside one client session, URI, and open epoch.

The returned stamp contains:

- scope;
- authoritative saved base generation and whether it is known;
- client-local overlay revision;
- monotonic local publication revision used for consumer caches;
- saved or dirty-overlay origin;
- evidence level.

Per-source evidence contains:

- file;
- saved or dirty origin;
- effective compiled source hash;
- saved base hash;
- document revision when dirty bytes supplied the source; and
- `exact`, `different`, or `unknown` buffer relationship.

Selection status is `exact`, `saved-fallback`, or `unavailable`. Its stable
reason is telemetry/debug information only; features must not branch on it.

The publication is one atomically captured detached value containing:

- definitions and source refs;
- relations and navigation sites;
- `IndexDiagnostic`s grouped by source;
- lint findings grouped by anchor; and
- actual source rows grouped by file.

The existing WebSocket diagnostics field remains a complete per-file
replacement, including an empty array. Source-row values must be retained
instead of reduced to change booleans.

### Selection rules

1. Saved bytes matching the requesting buffer select the saved view as exact.
2. A dirty view is preferred only when session, scope, saved base generation,
   source profile, all participating dirty revisions/hashes, required evidence,
   and current overlay revision match.
3. Without a qualifying dirty view, saved fallback returns the saved view;
   require-current returns unavailable.

Fallback never downgrades evidence. A previous dirty result is never fallback
for a newer version.

Incomplete dirty compilations are not selectable. `didChange`, `didSave`,
`didClose`, generation advance, handover, and reconnect retire affected views.
Dirty content remains memory-only and client-private.

The saved provider retains the Store and captures a detached publication for
each request under one Store read lock. It does not keep a second publication
that must be replaced after generation changes.

The semantic source-profile digest is private dirty-candidate validation state,
not a `ProjectIndexView` field. #266 computes it from version
`crux-semantic-source-profile-v1`, profile completeness, the sorted unique
dependency closure, and sorted `(file, sourceHash)` rows. It excludes source
text, byte counts, and hints, and remains separate from compiler/cache identity.

### Feature policies

- PromptText diagnostics and actions use semantic/current.
- Navigation uses semantic/saved-fallback with existing range transforms.
- Decorations require current semantic identity.
- Folding and static preview remain transient syntax features.

### Coherent transformed PromptText view

Every navigation or hover request for an open document snapshots the current
buffer and passes its `DocumentRevision` to the view request:

```go
Document: &view.DocumentRevision{
	OpenEpoch:  document.Revision.OpenEpoch,
	Version:    document.Version,
	SourceHash: document.Revision.SourceHash,
}
MinimumEvidence: view.EvidenceSemantic
Freshness:       view.AllowSavedFallback
```

A missing or unavailable open-buffer snapshot makes only the PromptText
contribution unavailable; it is never represented as `Document: nil`. Closed-
document queries use nil. The ordinary-string refactor uses the same port with
`EvidenceSemantic + RequireCurrent`.

Add a client-session-owned, server-neutral concern:

```text
packages/local/internal/lsp/prompttext/view/
  types.go
  provider.go
  transform.go
```

Its boundary is:

```go
type Provider interface {
	Select(context.Context, Request) Selection
	Current(Stamp) bool
}

type Request struct {
	ScopeID         string
	File            string
	Document        *indexview.DocumentRevision
	MinimumEvidence indexview.EvidenceLevel
	Freshness       indexview.FreshnessPolicy
}

type Selection struct {
	Status indexview.ViewStatus
	View   *View
}

type Stamp struct {
	Project           indexview.ViewStamp
	TransformRevision uint64
	RequestDocument   *indexview.DocumentRevision
}

type DocumentStamp struct {
	File              string
	Revision          indexview.DocumentRevision
	BaseSourceHash    string
	TransformRevision uint64
}

type SourceRefKey struct {
	DefinitionID string
	SourceRefID  string
}

type FragmentJoinKey struct {
	DefinitionID       string
	OwnerSourceRefID   string
	InterpolationIndex uint32
	TargetSourceRefID  string
}

type Location struct {
	File  string
	Range protocol.Range
}

type Definition struct {
	ID                   string
	Kind                 string
	Name                 string
	Description          string
	Location             Location
	IncomingRelations    int
	OutgoingRelations    int
	PromptTextSourceRefs []SourceRefKey
}

type Site struct {
	ID                 string
	TargetDefinitionID string
	Role               string
	Location           Location
}

type PromptTextSourceKind string

const (
	PromptTextSourceOwner            PromptTextSourceKind = "owner"
	PromptTextSourceNamedFragment    PromptTextSourceKind = "named-fragment"
	PromptTextSourceAnonymousFragment PromptTextSourceKind = "anonymous-fragment"
)

type PromptTextSourceRef struct {
	Key        SourceRefKey
	Role       string
	Property   string
	Symbol     string
	Lifecycle  string
	SourceKind PromptTextSourceKind
	Fidelity   string
	Template   Location
}

type FragmentJoin struct {
	Key            FragmentJoinKey
	OwnerTemplate  Location
	Expression     Location
	TargetTemplate Location
	Proof          string
}

type RefactorBinding struct {
	Kind       string
	Expression string
}

type StringRefactorTarget struct {
	Key        SourceRefKey
	Role       string
	Property   string
	Lifecycle  string
	Expression Location
	Binding    RefactorBinding
	Proof      string
}

type View struct {
	Stamp           Stamp
	Documents       []DocumentStamp
	Definitions     []Definition
	Sites           []Site
	PromptTextRefs  []PromptTextSourceRef
	FragmentJoins   []FragmentJoin
	RefactorTargets []StringRefactorTarget
}
```

All values are detached. Sort documents by canonical file; definitions by ID;
sites by file, range, ID, and target; source refs by file, template range,
definition ID, and source-ref ID; joins by owner file, expression range, and
key; and refactor targets by file, expression range, and source-ref key.

The result contains no raw publication, API Project Definition, metadata map,
or Publisher object. Consumers never combine it with independently read
Publisher state or raw publication records. The provider calls the configured
`ViewProvider` exactly once, captures one detached publication, atomically
joins it to one client-session transform snapshot, and returns only normalized
records. It is not another mutable Project Index and never mutates the Store.

Normalization requires canonical `md`, Markdown language, recognized
lifecycle/source kind, resolved fidelity, exact role/property and snippet
invariants, and a nonempty symbol only for `named-fragment`. Owner and
anonymous refs require an empty symbol. Unknown, missing, null, or inconsistent
classification drops the ref and every dependent join. Go never derives a
replacement classification from legacy metadata. Use `SourceKind` in the
stable non-range signature so a classification change invalidates saved range
transformation.

Stable identities are:

- definition ID;
- navigation-site ID;
- `(definition ID, source-ref ID)`; and
- `(definition ID, owner source-ref ID, interpolation index, target source-ref
ID)`.

Duplicate stable identities invalidate every duplicate.

The transform snapshot tracks definition declarations, navigation sites,
PromptText source-ref template ranges, all three fragment-join ranges, and
ordinary-string refactor expression ranges.

For ordered incremental edits:

- an edit ending at or before a record start shifts the record;
- a zero-width insertion at the start shifts it right;
- an edit starting at or after the end leaves it unchanged;
- a zero-width insertion at the end is after the record; and
- every other overlap, containment, crossing, or interior insertion invalidates
  the record.

A full-document replacement invalidates every transformed record in that file.
Invalid records disappear and never collapse to zero width. Fragment joins are
atomic: unavailable owner ref, target ref, or any of their three ranges omits
the complete join.

An exact buffer hash uses selected ranges directly and reports exact, including
after edit-and-revert. A saved-fallback transform chain is usable only when it
started from the selected publication's saved source hash, the stable record's
non-range signature remains equal, every edit transformed without overlap,
and open epoch/version still match. A selected-generation advance may reuse
the chain only with the same saved source hash.

New selected records stay hidden in dirty open files without a current
transformed range. Removed records disappear. A stable ID whose role, property,
symbol, lifecycle, target, or proof changes is unavailable.

Transform destinations in every other open document through the same atomic
snapshot. Omit a destination whose base hash, open epoch, version, or record
does not qualify. Closed destinations use selected saved ranges.

`didSave`, `didClose`, full-document change, reconnect, handover, and scope
retirement retire affected chains. After save, transformed evidence remains
unavailable until a qualifying saved generation exists.

Navigation and hover also require a current complete transient V1 analysis for
the request document. The transformed template range must exactly match one
current transient `template.range`; zero or multiple matches suppress the
occurrence. Current syntax may veto saved identity but never invent it.

Before returning, require a live request context, exact request revision,
current project `ViewStamp`, current transform revision, matching transient
revision, and every contributing open destination's `DocumentStamp`. Recompute
once on mismatch while the request remains current. A second mismatch returns
`null`/`[]` or drops only the PromptText hover section. Client cancellation
returns standard `RequestCancelled`.

### PromptText navigation

PromptText V1 adds required:

```rust
pub backtick_ranges: [PromptTextRange; 2],
```

Wire name is `backtickRanges`. Oxc produces exactly two ordered one-UTF-16-unit
ranges whose source byte is a backtick. They lie inside `templateRange` and
never overlap the tag or a barrier. Unsupported templates retain candidate,
tag, template, and backtick ranges while structural payloads remain empty.
Their compact JSON bytes count normally in finalized-template
`maxOutputBytes`; whole-template truncation is unchanged.

For an exact transient/semantic match, claim cursor regions as follows:

| Cursor region                                                                            | Crux behavior                    |
| ---------------------------------------------------------------------------------------- | -------------------------------- |
| Tag identifier, alias, namespace identifier, `.`, or `md` member                         | Do not claim; TypeScript owns it |
| Opening or closing backtick                                                              | Claim the PromptText occurrence  |
| Any authored literal-island byte                                                         | Claim                            |
| Markdown block, span, link, or marker inside a literal island                            | Claim                            |
| Literal whitespace, normalized-away outer whitespace, common-indent bytes, or quasi gaps | Claim                            |
| `${`, interpolation expression/comments/nested syntax, or `}`                            | Explicitly veto                  |
| Position after closing backtick                                                          | Do not claim                     |

Use half-open containment; barrier ranges win when ranges touch. If current
syntax recognizes the containing template but the semantic join is missing,
ambiguous, unsupported, or unavailable, return no Crux PromptText definition
or references. Do not fall through to the existing prompt/system line-based
source-ref navigation. If transient analysis is unavailable or truncated,
transformed template ranges may suppress that line fallback but cannot publish
a PromptText target. Navigation outside these regions remains unchanged.

Definition returns one standard `Location` or null:

| Occurrence                                                   | Result                                             |
| ------------------------------------------------------------ | -------------------------------------------------- |
| Direct owner template literal/backtick                       | Canonical owner declaration                        |
| Anonymous or non-runtime-addressable fragment with one owner | Canonical owner declaration                        |
| Named fragment literal/backtick with one owner               | Canonical owner declaration                        |
| Template shared by multiple owners                           | Null                                               |
| Named-fragment reference expression                          | Null; TypeScript owns declaration navigation       |
| Fragment declaration identifier                              | Outside claim                                      |
| Tag alias, namespace, or re-export expression                | Null                                               |
| Ambiguous/cyclic/unresolved fragment join                    | No fragment target; unique owner may still resolve |
| Missing or range-invalid destination                         | Null                                               |
| Self-jump                                                    | Remove; null if nothing remains                    |

A self-jump targets the same URI with a range containing the request position.
Import aliases, namespace access, and resolvable re-exports affect semantic
identity only and never redirect to the tag declaration.

References identify a named fragment only when the matched ref has
`sourceKind: "named-fragment"`, has a nonempty symbol, and is the target of a
valid join. Otherwise they identify the canonical owner. A named fragment with
no valid incoming join retains its named label but follows owner-reference
fallback. Anonymous fragments never gain inferred incoming references.

Owner references contain the transformed declaration optionally, exact
transformed full tagged-template source-ref ranges, and existing non-PromptText
relation sites in their established shape. Named-fragment references contain
the transformed full-template declaration optionally and exact transformed
join expression ranges across owners. Anonymous fragments receive no inferred
incoming references.

Group shared fragment declarations only when canonical file, selected base
source hash, saved declaration range, symbol, role, property, and lifecycle all
agree. Never group by symbol spelling.

With `includeDeclaration`, put the declaration first. Sort the rest by URI,
range start, range end, and stable record identity. Deduplicate by exact URI
and range. Without it, remove only the declaration. A request within any
interpolation barrier or expression returns an empty Crux reference
contribution.

### PromptText hover

Hover claims the same literal-island and backtick regions. Its range is the
smallest current syntax range containing the cursor, with precedence:

1. literal link;
2. inline span;
3. block;
4. literal island;
5. exact backtick.

Equal ranges use that order. Tags and barriers have no PromptText section. If
existing finding or definition hover content exists, retain its existing
range; use the PromptText range only when it is the sole Crux contribution.

Compose one Crux hover response in this order:

1. existing displayed findings;
2. existing coherent definition summary;
3. PromptText.

Use the existing Markdown horizontal rule or plaintext blank-section
separator. Definition and PromptText semantic facts must come from the same
transformed view; displayed findings remain the existing diagnostic lane.
Crux does not proxy or synthesize native TypeScript hover.

Markdown PromptText content is exactly:

```md
**Crux PromptText**

**Owner:** <escaped name> — `<kind>` (`<definition-id>`)
**Template:** <template-label> · <lifecycle> lifecycle
**Composition:** <literal-count> literal island(s) · <barrier-count> interpolation barrier(s)
**Fragments:** <outgoing-count> outgoing · <incoming-count> incoming proven named-fragment edge(s)
**Evidence:** <evidence-label>
```

Omit `Fragments` when both counts are zero. Plaintext removes Markdown
emphasis/backticks but otherwise uses the same labels and order:

```text
Crux PromptText

Owner: <name> — <kind> (<definition-id>)
Template: <template-label> · <lifecycle> lifecycle
Composition: ...
Fragments: ...
Evidence: ...
```

Template labels are exactly:

```text
direct `prompt` template
direct `system` template
named fragment `<symbol>`
anonymous fragment
```

Select the label from compiler-owned `sourceKind`, never role, symbol, joins,
nesting, or legacy `metadata.fragment`. `owner` uses the direct prompt/system
label from its exact role, `named-fragment` uses its required symbol, and
`anonymous-fragment` uses the anonymous label. Incoming and outgoing counts
come only from accepted joins; cyclic or ambiguous suppressed joins contribute
zero.

Evidence labels are:

```text
exact semantic view
saved semantic fallback; current syntax matched
```

For a shared template, render at most three owners sorted by definition ID:

```md
**Owners:**

- <owner>
- <owner>
- <owner>

_…and N more owners_
```

Plaintext uses the same rows without Markdown markers. Inconsistent shared
records suppress the PromptText section.

The existing 4,000 UTF-16-unit hover cap, capped writer, whole-rune ellipsis,
and three-finding cap remain authoritative. Never include source snippets,
static preview, inferred values, runtime state, safety, trust, encoding,
escaping, sanitization, or sink claims.

Saved fallback requires exact transformation and current transient matching.
An overlapping template edit suppresses the contribution; edits before or
after may shift it. An invalid join expression suppresses only that edge.
Unsupported/truncated transient results drop only PromptText. Internal
unavailability or failed final validation may still return current finding-
only content. Client cancellation returns `RequestCancelled`.

### V3 semantic fact-group presence

V3 fact envelopes preserve rows but cannot alone distinguish an omitted fact
group from an explicitly empty replacement. Extend the existing
`phase:done.summary` additively:

```ts
export type IndexFactGroup =
  | "prompts"
  | "contexts"
  | "tools"
  | "lint"
  | "definitions"
  | "relations"
  | "sourceRefs"
  | "diagnostics"
  | "lintFindings"
  | "ruleDescriptors"
  | "sources"
  | "sourceGraph";

export interface ProjectIndexPhaseSummary {
  readonly factCount: number;

  /**
   * Fact groups that were own properties of the original patch.
   *
   * Omission identifies a legacy producer. An empty array is an explicit
   * presence claim and must not be collapsed to omission.
   */
  readonly factGroups?: readonly IndexFactGroup[];
}
```

The canonical group order is exactly the union order above. New producers
always emit `factGroups`, including `[]`. They derive it from the original
`patch.facts` before stripping facts from `phase:done.patch`: include a group
exactly when its value is not `undefined`. Therefore explicit empty arrays,
nonempty arrays, and defined singleton `lint` or `sourceGraph` values are
present; omitted or `undefined` groups are absent; `null` is invalid.

`factCount` remains the exact number of emitted fact envelopes. Empty arrays
contribute zero. The presence field applies to every fact group, not only
diagnostics.

When `factGroups` is present, validation is strict:

- it must be a JSON array, never `null`;
- values must be known strings in canonical order, without duplicates;
- every emitted envelope kind must be declared;
- undeclared groups must emit no envelope;
- declared array groups may emit zero or more envelopes;
- each declared singleton group, `lint` and `sourceGraph`, must emit exactly
  one envelope; and
- `factCount` must equal the total emitted envelope count.

Any inconsistent or malformed presence claim rejects the complete phase
transaction. No part of that phase may be applied, published, retained, or
cached.

Reconstruction first creates an own empty array for every declared array group,
then appends its envelopes. Declared singleton groups are populated by their
required envelope. Undeclared array groups remain absent in TypeScript and nil
in Go. This preserves the existing patch meanings:

```text
omitted = no patch
empty   = clear
values  = replace
```

Go must preserve omission, explicit empty presence, and invalid `null` at the
wire boundary. A pointer to a slice is prohibited because `encoding/json`
collapses omitted and `null` to the same nil value. Decode through raw JSON and
immediately validate into typed state:

```go
type IndexFactGroup string

type PhaseDoneSummary struct {
	FactCount  int64           `json:"factCount"`
	FactGroups json.RawMessage `json:"factGroups,omitempty"`
	// Existing fields remain unchanged.
}

type DecodedFactGroups struct {
	Present bool
	Value   []IndexFactGroup
}

func DecodeFactGroups(raw json.RawMessage) (DecodedFactGroups, error)
```

`DecodeFactGroups` returns `{Present:false, Value:nil}` only for nil or
zero-length raw bytes. It rejects trimmed `null`, non-arrays, malformed JSON,
trailing content, null or non-string elements, unknown values, duplicates, and
noncanonical order. A decoded `[]` becomes `{Present:true}` with a nonnil empty
slice. Only this validated typed value may reach reconstruction; raw bytes are
not inspected or retained afterward.

New Go producers assign a nonnil canonical `json.RawMessage`; an empty typed
input encodes as exact `[]`. With `omitempty`, nil raw bytes preserve legacy
omission and nonnil `[]` bytes preserve explicit presence.

An older producer with no `factGroups` field remains valid. Consumers infer
only groups represented by its envelopes and never invent an empty clear. This
is intentionally lossy only for legacy producers. The additive field does not
bump protocol V3. New TypeScript and Go consumers must decode both old and new
goldens, and known legacy consumers must ignore the new summary field. If a
legacy consumer rejects it, stop and return to architecture rather than
silently changing the representation.

## Diagnostic evidence

`IndexDiagnostic` gains an optional discriminated evidence field. Public types
and schemas live in `packages/core/src/project-index/diagnostic-evidence.ts`
and are re-exported from the existing Project Index entry point:

```ts
export type PromptTextRuntimeKind =
  | "non-finite-number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "function"
  | "object"
  | "cyclic-array";

export type PromptTextDiagnosticEvidence = {
  readonly kind: "prompt-text";
  readonly sourceRefId: string;
  readonly interpolationIndex: number;
  readonly interpolationPath?: readonly number[];
  readonly proof: "syntax-exact" | "semantic-exact";
  readonly cause:
    | {
        readonly kind: "invalid-interpolation";
        readonly runtimeKinds: readonly PromptTextRuntimeKind[];
        readonly mdJsonApplicable?: true;
      }
    | {
        readonly kind: "inline-sequence";
        readonly joinableWithComma?: true;
      }
    | {
        readonly kind: "json-serialization";
        readonly reason: "undefined-result";
      };
};
```

`sourceRefId` is nonempty. `interpolationIndex` is a safe integer in
`0..2^31-1`. `interpolationPath`, when present, requires the index, contains
`1..64` elements, and every element is a safe integer in `0..2^31-1`; an empty
path is noncanonical. The path is legal only for `invalid-interpolation`.

`runtimeKinds` contains `1..7` unique entries already ordered as:

```text
non-finite-number
boolean
bigint
symbol
function
object
cyclic-array
```

`mdJsonApplicable: true` is schema-legal only when the kind set is a nonempty
subset of `non-finite-number | boolean`. Production has the stricter whole-
expression proof below. `joinableWithComma` is legal only for
`inline-sequence`. `json-serialization` admits only `kind` and
`reason: "undefined-result"`.

Every new evidence and cause object rejects unknown fields recursively. Do not
retroactively make the outer `IndexDiagnostic` or all Project Index schemas
strict; their existing compatibility behavior remains. Phase 10 emits only
`proof: "semantic-exact"`. `syntax-exact` remains accepted for future
normalized compiler evidence.

Only #270 construction diagnostics ship:

- `CRUX_PROMPT_TEXT_INVALID_INTERPOLATION`;
- `CRUX_PROMPT_TEXT_INLINE_SEQUENCE`; and
- `CRUX_PROMPT_TEXT_JSON_SERIALIZATION`.

They are hard compiler diagnostics, not configurable `IndexLintFinding`s.

### Backend-neutral semantic conclusion

The backend-private type classifier projects only the following Crux-owned
record from
`packages/indexer/src/indexer/semantic/evidence/prompt-text-diagnostics.ts`.
TypeScript nodes, types, checker objects, symbols, and flow objects never cross
this boundary:

```ts
interface PromptTextDiagnosticConclusionBase {
  readonly kind: "prompt-text-diagnostic";
  readonly definitionId: string;
  readonly sourceRefId: string;
  readonly owner: {
    readonly role: "prompt" | "system";
    readonly property: "prompt" | "system";
    readonly lifecycle: "static" | "dynamic";
  };
  readonly proof: "semantic-exact";
}

interface PromptTextDiagnosticPoint {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

interface PromptTextInterpolationPoint {
  readonly index: number;
  readonly source: PromptTextDiagnosticPoint;
}

export type PromptTextDiagnosticConclusion =
  | (PromptTextDiagnosticConclusionBase & {
      readonly interpolation: PromptTextInterpolationPoint & {
        readonly path?: readonly number[];
      };
      readonly cause: {
        readonly kind: "invalid-interpolation";
        readonly runtimeKinds: readonly PromptTextRuntimeKind[];
        readonly mdJsonApplicable?: true;
      };
    })
  | (PromptTextDiagnosticConclusionBase & {
      readonly interpolation: PromptTextInterpolationPoint & {
        readonly path?: never;
      };
      readonly cause: {
        readonly kind: "inline-sequence";
        readonly joinableWithComma?: true;
      };
    })
  | (PromptTextDiagnosticConclusionBase & {
      readonly interpolation: PromptTextInterpolationPoint & {
        readonly path?: never;
      };
      readonly cause: {
        readonly kind: "json-serialization";
        readonly reason: "undefined-result";
      };
    });
```

`PromptTextDiagnosticPoint.file` is nonempty. `line` and `column` are integers
in `1..2^32-1`; `function` is not representable. A backend that cannot prove
the exact file, line, and column suppresses the conclusion instead of
defaulting the column or falling back to the tag/source-ref start. Public
projection copies exactly `{file, line, column}`.

Phase 11 makes the native backend produce byte-for-byte normalized parity over
this record. The internal classifier representation remains backend-private;
only the behavior and conclusion union are shared.

Sort conclusions by:

```text
source.file
source.line
source.column
definitionId
sourceRefId
interpolation.index
interpolation.path lexicographically
cause precedence
```

Cause precedence is `json-serialization`, `invalid-interpolation`, then
`inline-sequence`. Emit at most one conclusion per owner/source-ref/
interpolation. A direct canonical `md.json()` undefined result wins over every
outer interpolation conclusion. Otherwise, an invalid required tuple leaf
wins over inline-sequence; otherwise emit the proven inline sequence.

### Public diagnostic projection

Every PromptText diagnostic uses:

```ts
{
  severity: "error",
  relatedDefinitionIds: [conclusion.definitionId],
  source: {
    file: conclusion.interpolation.source.file,
    line: conclusion.interpolation.source.line,
    column: conclusion.interpolation.source.column,
  },
  evidence: promptTextDiagnosticEvidence,
}
```

Omit `suggestedFix`. Later phases derive actions from evidence plus exact
transient ranges; messages and fixes never encode edits.

Codes and messages are exact. `<path>` is the concatenation `[n][m]` or empty;
`<runtimeKinds>` is the canonical comma-space-joined list.

```text
CRUX_PROMPT_TEXT_INVALID_INTERPOLATION
PromptText interpolation <index><path> is always invalid (<runtimeKinds>). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence.

CRUX_PROMPT_TEXT_INLINE_SEQUENCE
PromptText interpolation <index> is a sequence in inline position. Move it to its own line or join supported scalar values explicitly.

CRUX_PROMPT_TEXT_JSON_SERIALIZATION
md.json() cannot produce text because JSON.stringify() is proven to return undefined for this value.
```

The diagnostic ID is:

```text
"prompt-text:" + lowercase_hex(SHA-256(stream))
```

The canonical stream is:

```text
ASCII "crux-prompt-text-diagnostic-v1\0"
string(definitionId)
string(sourceRefId)
string(code)
string(source.file)
u32be(source.line)
u32be(source.column)
u32be(interpolationIndex)
u32be(path length)
u32be(each path element)
string(cause kind)
cause payload
```

`string(value)` is `u32be(UTF-8 byte length) || exact UTF-8`. Cause payloads
are:

```text
invalid-interpolation:
  u32be(runtime kind count)
  string(each canonical runtime kind)
  u8(mdJsonApplicable ? 1 : 0)

inline-sequence:
  u8(joinableWithComma ? 1 : 0)

json-serialization:
  string("undefined-result")
```

IDs and files must satisfy existing Project Index invariants. Every numeric ID
input must fit `u32`; every length prefix must fit. Suppress rather than wrap
or truncate on overflow.

An ASCII case-insensitive substring fixture scans exactly diagnostic `code`,
`message`, and serialized `suggestedFix` when present, rejecting:

```text
sanitize
sanitization
encode
encoding
escape
escaping
trust
trusted
raw
xml
safe
safety
nested input
double-encoding
```

It does not scan IDs, source paths, related-definition IDs, or structured
evidence.

### Proof lattice

Conceptually, classification yields `accepted`, `invalid`, `sequence`,
`uncertain`, or `uninhabited`. The concrete classifier representation is
backend-private.

- `any`, `unknown`, and unconstrained type parameters are uncertain.
- `never` is uninhabited and is never diagnosed vacuously.
- Resolve aliases fully before classification.
- Only canonical Core `PromptText` is accepted; structural lookalikes are not.
- `string`, string literals, and branded string intersections are accepted.
- Finite numeric literal types are accepted.
- `number`, branded number, and numeric widening are uncertain.
- Prove nonfinite numbers only for exact, unshadowed `NaN`, `Infinity`,
  `+Infinity`, `-Infinity`, or numeric literal syntax whose parsed IEEE-754
  value is nonfinite. Transparent wrappers may be removed.
- `false` is accepted. `true` is invalid `boolean`. Widened `boolean` and
  `true | false` are uncertain because they include accepted `false`.
- `null` and `undefined` are accepted. An exact syntactic `void expression` is
  accepted. Type `void` alone is uncertain because a void-typed call may return
  another runtime value.
- `bigint` and BigInt literals are invalid `bigint`.
- Primitive `symbol` and unique symbol are invalid `symbol`.
- Callable or constructable types are invalid `function`, unless uncertainty
  comes through an unconstrained generic.
- A class/interface/object type provably neither PromptText nor Array is
  invalid `object`. Broad `object`, `{}`, and empty structural object types are
  uncertain because they may contain PromptText or arrays.
- Reduce intersections first. A never-reduced intersection is uninhabited;
  string refinements remain accepted; number refinements remain uncertain
  unless a finite literal; object refinements are invalid only when they
  exclude PromptText and arrays; unresolved generic intersections are
  uncertain.
- Classify finite enums as their known member-value union. Widened numeric
  enums are uncertain; string members are accepted; mixed accepted/invalid
  members are uncertain.
- For unions, discard uninhabited members. A union is invalid only when every
  remaining member is invalid; combine kinds uniquely in canonical order. It
  is a sequence only when every remaining member is a sequence. Any accepted
  or uncertain member prevents invalid diagnosis.
- Memoize recursive traversal by backend-neutral type identity. Revisiting an
  active type yields uncertain. Never infer `cyclic-array` from a recursive
  TypeScript type.

Mutable arrays, readonly arrays, and tuples are sequences. Inline position is
the #270 rule after construction normalization: the interpolation is inline
unless it is the only interpolation on a line whose other bytes are spaces or
tabs. A definitely sequential value in inline position produces
`INLINE_SEQUENCE`, including an empty array type.

Visit required tuple elements in ascending index order. Emit nested invalid
evidence only when an exact required tuple path guarantees reaching the
invalid leaf. Optional elements and array/rest elements do not guarantee a
runtime leaf. Generic or recursive element uncertainty never creates nested
invalid evidence. For example:

```text
[true]                 -> invalid at [0]
[true?] inline         -> inline sequence
[true, ...string[]]    -> invalid at [0]
true[] inline          -> inline sequence
true[] block           -> no hard diagnostic
```

`joinableWithComma: true` requires a definitely sequential top-level value,
at least one possible element, and every possible top-level element to be a
string or finite numeric literal. Optional elements, rest/generic uncertainty,
nullable values, PromptText, nested sequences, objects, widened `number`, and
uncertain unions disqualify it. Therefore `string[]`, `(1 | 2)[]`, and
`[string, 1]` qualify; `number[]`, `T extends string[]`, `[string?]`,
fragments, and nested arrays do not.

`mdJsonApplicable: true` has a stricter production proof than its public-schema
shape. Emit it only when `interpolationPath` is absent and the complete
top-level interpolation is proven to be exactly:

- literal `true`; or
- an exact syntactic nonfinite number accepted above.

Literal `true` may flow through transparent wrappers or a const alias whose
exact literal type is preserved. Nonfinite proof must remain exact syntax after
transparent wrappers; aliases do not qualify. Never emit it for a nested path,
array/tuple (including `[true]`), union containing anything else, `any`,
unknown, generics, BigInt, symbol, function, object, cyclic, or uncertain
value.

### Canonical `md.json(...)`

Recognize exactly one normal `CallExpression` with one non-spread argument, a
noncomputed and nonoptional property access named exactly `json`, no optional
call, and a receiver resolved through existing canonical package/export
identity to Core `md`.

Accept:

```ts
md.json(value);
text.json(value); // import/re-export alias of canonical md
core.md.json(value); // canonical namespace import
(md as MdTag).json(value);
(md satisfies MdTag).json(value);
md!.json(value);
```

Transparent parentheses around the receiver or complete callee are also
accepted: `(md).json(value)` and
`(md.json)(value)` are accepted even when a formatter removes those
parentheses. Parentheses, `as`, type assertions, `satisfies`, and non-null
wrappers may be removed.

Reject:

```ts
md["json"](value);
md?.json(value);
md.json?.(value);
md?.json?.(value);
const { json } = md;
json(value);
const json = md.json;
json(value);
const text = md;
text.json(value);
wrapper(md).json(value);
md.json.call(undefined, value);
md.json();
md.json(a, b);
md.json(...args);
```

Local receiver aliases, destructuring, property aliases, computed access, and
optional chains are outside V1 even when a checker could follow them.

Emit `JSON_SERIALIZATION` only when every possible top-level argument value
makes `JSON.stringify` return `undefined`, rather than throw. Qualifying proofs
are exact `undefined`, exact syntactic `void expression`, primitive
symbol/unique-symbol, or a union containing only those plus `never`.

Function/callable types do not qualify because a runtime function may have
`toJSON`. BigInt may throw. `any`, `unknown`, generics, objects, arrays,
PromptText, and any union containing a serializable, throwing, or uncertain
possibility do not qualify.

### Source-reference join

Publication requires all three records:

1. a resolved canonical source ref with matching owner/lifecycle;
2. normalized saved semantic diagnostic evidence; and
3. exact current transient syntax mapping.

For each conclusion:

1. Start from one source ref with `fidelity: "resolved"`, canonical
   `metadata.promptText.tag: "md"`, exact owning definition/role/property/
   lifecycle, and an exact nontruncated snippet/tagged-template range.
2. Match the semantic tagged-template node by exact file and full tag range.
3. Enumerate that template's interpolations in source order from zero.
4. Attach a nested named-fragment conclusion to that fragment's own source ref,
   not to the outer interpolation that references it.
5. Reset interpolation indices for every nested template/source ref.
6. Suppress when zero or multiple source refs match one definition/tag/
   lifecycle occurrence.
7. Existing source-ref deduplication yields one conclusion per owning
   definition/source ref, not per reachability path.
8. Point the public diagnostic at the complete interpolation expression start.
   A tuple path does not invent a narrower public range.
9. Point a direct `md.json()` diagnostic at the call start, which is also the
   offending interpolation expression start.
10. Phase 12 uses exact transient syntax to recover the current full range;
    Phase 10 adds no public range.

Promises retain runtime kind `object`. `cyclic-array` remains in the public
vocabulary but Phase 10 never infers it from recursive types. Both semantic
backends ultimately emit normalized evidence with exact parity.

## Actions

Allowed actions:

- “Serialize with `md.json()`” when `mdJsonApplicable`, reusing the actual local
  tag expression and preserving single evaluation;
- `.join(", ")` when `joinableWithComma`, initially only for proven strings or
  finite numeric literals;
- “Put sequence on its own line” when exact ranges prove an isolating edit,
  labelled as a layout change; and
- an explicit interpolation-free string-to-`md` refactor when #270
  normalization proves byte equivalence.

Actions preserve comments and use versioned document edits. JSON serialization
errors initially have no automatic fix.

Encoding, sanitization, suspicious-content, nested-input migration, `safe`,
`xml`, `escapeXml`, trust/raw markers, and suppression remain blocked on
#276/#277.

### Sequence action edits

The comma-join action title is exactly:

```text
.join(", ")
```

It requires current `inline-sequence` evidence with
`joinableWithComma: true` after every Phase 12 gate succeeds. Its sole edit
replaces `barrier.expressionRange` with:

```text
(<exact authored expression bytes>).join(", ")
```

Always add exactly one outer pair of parentheses; never remove or deduplicate
existing parentheses. Copy the expression-range bytes exactly once, including
comments, Unicode, line endings, non-null assertions, `as`, `satisfies`,
optional chains, nested templates, and every other TypeScript wrapper.
Whitespace or comments between `${` and the AST expression, or between the
expression and `}`, remain outside the range and untouched. Go may construct
this fixed wrapper but must not parse, simplify, or otherwise rewrite the
expression. A missing, empty, duplicate, or non-sliceable current expression
range suppresses the action.

General `number[]`, nullable values, fragments, uncertain unions, missing
evidence, and absent or false `joinableWithComma` never receive the join
action.

#### Rust-owned line-isolation proof

Rust owns layout applicability completely. Oxc retains ownership of parsing,
cooked quasis, normalization inputs, barriers, and source mappings. A small
private module under `crates/static-compiler/src/prompt_text/layout/` owns the
counterfactual Core-normalization, Markdown, and composition proof. It remains
tag-neutral and sequence-neutral.

Go may only:

- join an optional proof to current semantic `inline-sequence` evidence;
- validate the current revision, ranges, and expected source text; and
- copy the proven range and `newText` into the versioned LSP edit.

Go never derives applicability, chooses an EOL, infers indentation, inspects
source lines, simulates cooking, reruns normalization, or rescans Markdown.
Absent or malformed proof means no layout action.

PromptText V1 is amended in place with the optional
`lineIsolationEdit` field shown in the ABI above. Go mirrors it as:

```go
type PromptTextLineIsolationEdit struct {
	Range        PromptTextRange `json:"range"`
	ExpectedText string          `json:"expectedText"`
	NewText      string          `json:"newText"`
}

type PromptTextInterpolationBarrier struct {
	Index             uint32                       `json:"index"`
	Range             PromptTextRange              `json:"range"`
	ExpressionRange   PromptTextRange              `json:"expressionRange"`
	LineIsolationEdit *PromptTextLineIsolationEdit `json:"lineIsolationEdit,omitempty"`
}
```

Production omits unavailable proofs and never emits `null`. Consumers treat
absent or `null` as unavailable. Empty objects, empty strings, equal expected
and replacement text, or invalid ranges are unavailable proofs.

For a valid proof:

- `range` is inside `templateRange` and excludes the tag and both backticks;
- it contains the complete target barrier and no other barrier;
- `expressionRange` remains strictly inside the barrier;
- `expectedText` equals the exact UTF-8 source slice addressed by the
  half-open UTF-16 range;
- every boundary is exactly source-mappable;
- `newText` preserves the target barrier bytes exactly once; and
- only adjacent authored ASCII spaces or tabs, the barrier, inserted LF or
  CRLF, and copied indentation participate.

#### Exact line-isolation construction

Use the same ECMAScript-cooked, Core-normalized logical-line model as
PromptText placement while retaining exact authored mappings.

A target is eligible only when it is currently inline, is the only
interpolation on its normalized logical line, at least one side contains
non-horizontal-whitespace literal content, and every involved boundary, gap,
and carrier indentation maps exactly to source.

Determine:

- `leftContent`: non-space/tab literal content before the barrier on its
  logical line;
- `rightContent`: non-space/tab literal content after it;
- `leftGap`: the maximal mapped authored ASCII spaces/tabs touching the
  barrier on the left;
- `rightGap`: the equivalent right gap; and
- `carrierIndent`: exact authored ASCII spaces/tabs from raw template-content
  line start to its first non-whitespace byte.

Tabs are copied character-for-character and have no assumed width.
Escape-derived, discontinuously mapped, or otherwise nonlinear gaps or
indentation suppress the proof.

Select EOLs source-locally:

- `leftEOL` is the last physical LF/CRLF token before the replacement range,
  otherwise the first after it, otherwise LF;
- `rightEOL` is the first physical LF/CRLF token after the range, otherwise the
  last before it, otherwise LF;
- CRLF is one token; and
- mixed-EOL input may therefore use CRLF on the left and LF on the right.

A cooked line boundary derived from an escape, bare CR, U+2028, or U+2029 is
ineligible in V1 unless the required LF/CRLF mapping is independently exact.

The replacement is:

```text
(leftContent  ? leftEOL  + carrierIndent : "")
+ exactBarrierBytes
+ (rightContent ? rightEOL + carrierIndent : "")
```

The replacement range starts at `leftGap.start` when `leftContent`, otherwise
at `barrier.start`. It ends at `rightGap.end` when `rightContent`, otherwise
at `barrier.end`. Consume the maximal adjacent horizontal gap only on a side
being split; preserve every other whitespace byte.

Examples:

```text
start:  md`${xs} tail`
range:      `${xs} `
newText:    `${xs}\n`

end:    md`head ${xs}`
range:         ` ${xs}`
newText:       `\n${xs}`

middle: md`head ${xs} tail`
range:         ` ${xs} `
newText:       `\n${xs}\n`
```

With carrier indentation `\t  ` and CRLF:

```text
expectedText = " ${xs} "
newText      = "\r\n\t  ${xs}\r\n\t  "
```

For CRLF before and LF after:

```text
newText = "\r\n<carrierIndent>${xs}\n<carrierIndent>"
```

At template or logical-line start, insert no leading newline. At its end,
insert no trailing newline. The edit therefore never creates an exterior
outer blank line merely to isolate the interpolation. Treat multiline or
nested expressions and comments as an opaque barrier and copy their authored
bytes unchanged.

#### Counterfactual safety proof

“Without altering another construct” requires a Rust counterfactual proof,
never Go source-line heuristics. Apply the proposed edit to a compiler-private
counterfactual template model and rerun the same cooking/normalization,
Markdown classification, and composition placement logic. Emit the proof only
when:

1. The tag, interpolation count/order, every expression's authored bytes, and
   every non-target barrier are unchanged.
2. The target becomes the sole block-position interpolation on its normalized
   line.
3. Every other interpolation retains its exact inline/block placement.
4. Every literal contribution outside the edit retains identical cooked text,
   order, and mapping after range translation.
5. Outer-blank trimming and common-indent removal outside the edit are
   identical.
6. The range-free Markdown signature is identical: block/span/link kinds,
   heading levels/labels, list properties, code metadata, literal
   destinations, and nesting topology. Ignore index and source-range shifts;
   reject any added or removed break, emphasis, code span, link, heading,
   list, blockquote, or other construct.
7. Symbolic composition with empty, one-item, and two-item target sequences
   preserves every non-target literal/interpolation atom and provenance. Only
   the target's defined block-line and empty-seam behavior may change.
8. No other tagged-template candidate changes except deterministic
   source-position translation after the edit.

A full source reparse is permitted but not required; a bounded
counterfactual over Oxc's private projection is sufficient. Go reproduces none
of this proof.

The layout action title is exactly:

```text
Put sequence on its own line — changes layout
```

It uses U+2014 with one space on each side. If join and layout both apply,
return separate actions in this order:

1. `.join(", ")`
2. `Put sequence on its own line — changes layout`

Never combine their edits. Each action otherwise follows the Phase 12 eager,
one-diagnostic, one-versioned-document, one-`TextEdit` wire contract.

`lineIsolationEdit` is part of the finalized template object and counts
normally under existing V1 `maxOutputBytes`: charge its compact `serde_json`
UTF-8 field name, punctuation, ranges, strings, and all serializer escaping.
Exact equality fits. On overflow, omit the complete template and every later
template and report request-level `truncated`; never drop only the proof to
make a template fit. An ambiguous proof merely omits the optional field and
does not make the template unsupported.

This transient-only V1 amendment changes no Project Index cache epoch.

### Ordinary multiline string refactor

Phase 14 converts only compiler-proven ordinary multiline prompt/system
literals and reuses exactly one already-resolved local value binding for
canonical Core `md`. It never inserts, reorders, merges, or otherwise edits
imports.

#### Semantic evidence

Add strict public metadata:

```ts
type PromptTextRefactorBinding =
  | {
      readonly kind: "identifier";
      readonly expression: string;
    }
  | {
      readonly kind: "namespace-access";
      readonly expression: string;
    };

type PromptTextRefactorEvidence = {
  readonly kind: "ordinary-string-to-md";
  readonly proof: "semantic-exact";
  readonly lifecycle: "static";
  readonly target: "md";
  readonly binding: PromptTextRefactorBinding;
};
```

It lives at
`ProjectSourceRef.metadata.promptTextRefactor?: PromptTextRefactorEvidence`,
not under `metadata.promptText`, because the expression is not yet PromptText.

Both semantic backends emit a resolved source ref only when the owning
primitive/property is manifest-proven PromptText-compatible, role and property
are matching `prompt` or `system`, lifecycle is static, the initializer is a
direct accepted literal, and exactly one in-scope value binding resolves to
canonical Core `md`.

The source ref has `fidelity: "resolved"`; its source/snippet covers exactly
the literal token, excluding transparent parentheses; it carries
`promptTextRefactor` and no `metadata.promptText`; and its ID is:

```text
<definitionId>:source:<role>:<property>:prompt-text-refactor:<normalized-project-relative-file>:<startLine>:<startColumn>
```

Accepted object members are noncomputed own `PropertyAssignment`s:

```ts
prompt: "..."
"prompt": "..."
system: `...`
prompt: ("...")
```

Reject computed properties, aliased names, shorthand, spreads, methods,
getters/setters, identifier/property initializer indirection, callback returns,
TypeScript wrappers such as `as`/`satisfies`/non-null, concatenation,
`String.raw`, substitutions, and unrelated objects whose property merely has
the right spelling.

Binding evidence accepts direct or renamed value imports, namespace access,
and resolvable local re-export chains. Reject type-only imports, shadows,
unresolved/ambiguous bindings, unrelated/path-remapped packages, ordinary
`const alias = md` aliases, multiple usable bindings, and missing bindings.

`binding.expression` is the exact insertion-ready identifier or namespace
member expression, no more than 256 UTF-8 bytes. Semantic producers prove its
grammar and canonical identity; Go only copies it.

These source refs/metadata require JavaScript/native parity and are co-owned
with PromptText source classification by Phase 14's already-advanced
`SEMANTIC_FACTS_CACHE_EPOCH = "semantic-facts-v37"` and
`ProjectIndexSnapshotCacheEpoch = 50`. Do not bump them again in this unreleased
worktree. This changes neither `STATIC_PARSE_CACHE_EPOCH` nor
`SEMANTIC_COMPILER_OPTIONS_ID`.

#### Transient syntax proof

The V1 ABI above adds three flat `PromptTextLimits` fields:

```text
maxStringRefactors: 128
maxStringRefactorBytes: 262144
maxStringRefactorOutputBytes: 262144
```

There is no nested refactor-limits wire object. A private nonserialized helper
may group the values internally.

`PromptTextQueryResponse.refactors` is required and has independent
`complete | truncated | unsupported` status plus zero or more proofs. A proof
range covers only the literal token; `expectedText` is its exact authored
slice; `templateText` begins/ends with backticks and contains no interpolation.
Candidate IDs are zero-based source order among direct syntactic
prompt/system-literal property candidates, before semantic identity.

Count compact proof JSON plus inter-proof commas against the independent
refactor output budget. Array brackets, response envelope, and template
objects do not count. Exact equality fits; overflow retains a source-order
prefix and marks refactors truncated. Candidate-count, per-candidate-byte, or
output overflow changes only refactor status and never template analysis.
Consumers require complete status and publish no refactor from a truncated
result. Unsupported language/source/parser state yields unsupported; traversal
truncation yields truncated.

Rust/Oxc accepts only a `StringLiteral`,
`NoSubstitutionTemplateLiteral`, or transparent parentheses around either.
The cooked UTF-16 value must contain at least one LF, contain no unpaired
surrogate, convert losslessly to scalar UTF-8, and be an exact fixed point of
settled #270 outer-blank/common-indent normalization.

Let `V` be the original cooked scalar string. Prove:

```text
UTF-16(new PromptText output) == UTF-16(V)
UTF-8(new PromptText output)  == UTF-8(V)
```

For a no-substitution template literal, reuse the exact original backtick token
as `templateText` when fixed-point proof succeeds.

For a quoted literal, synthesize:

```text
`
<carrierIndent><encoded line 1>
<carrierIndent><encoded line 2>
<carrierIndent>`
```

Choose the last physical LF/CRLF before the literal, otherwise the first after
it, otherwise LF. CRLF is one source token and cooks to LF.
`carrierIndent` is the exact authored ASCII space/tab prefix of the literal's
physical line; tabs have no assumed width. Wrapper lines are authored blank
lines, and the same indent prefixes every value line and closing backtick.

Encode content canonically:

- LF becomes the selected physical EOL;
- CR becomes `\r`;
- backslash becomes `\\`;
- backtick becomes backslash followed by backtick (`U+005C U+0060`);
- `${` becomes `\${`;
- NUL and other C0/DEL controls use fixed `\xHH`, except tab may use `\t`;
- U+2028/U+2029 use `\u2028`/`\u2029`;
- quotes stay literal; and
- other scalar Unicode stays literal UTF-8.

Rust reparses the generated template, reruns the same cooking and Core
normalization, and emits only when it has zero interpolations and reconstructs
`V` exactly. Leading/trailing blank lines removed by #270, removable common
indent, all-whitespace multiline values, invalid escapes, and lone surrogates
fail. Internal blank lines, quotes, slashes, literal `${`, CR, source CRLF,
Unicode, tabs, and unequal indentation qualify only if both equality proofs
pass.

#### Refactor action

The exact title is:

```text
Convert multiline string to `md` PromptText
```

The kind is `refactor.rewrite`. Add `CodeActionRefactor = "refactor"` and
`CodeActionRefactorRewrite = "refactor.rewrite"`. Advertise
`refactor.rewrite` only when the client's literal-support value set contains
`refactor` or `refactor.rewrite`; quick-fix advertisement is unchanged.

The action is diagnostic-free. With absent `context.only`, it is eligible.
`refactor` or `refactor.rewrite` includes it; `quickfix`, other subtypes, and
unrelated kinds exclude it.

An empty request range must be inside the half-open literal range. A nonempty
range must be wholly contained by exactly one literal. A range covering the
property/object/multiple literals, or a position at the literal end, is
ineligible.

Require an exact current document snapshot, semantic/current `ViewExact`,
complete view stamp, exactly one semantic target, exactly one current complete
Rust proof with identical file/range/expected text, matching semantic/syntax
ownership, and all Phase 12 source-epoch/generation/cancellation/final-current
checks.

The sole edit is:

```go
protocol.TextEdit{
	Range:   proof.Range,
	NewText: target.Binding.Expression + proof.TemplateText,
}
```

Return one eager `TextDocumentEdit` pinned to current URI/version with exactly
one edit. Omit diagnostics, legacy `changes`, command, data, annotations, and
resolve behavior. No import edit is ever included.

### Diagnostic publication lifecycle

Maintain two independent diagnostic lanes for every canonical document URI:

```text
lint lane        owned synchronously by server.Publisher
PromptText lane  owned asynchronously by the PromptText controller
```

One client-session diagnostic composer combines them immediately before
`textDocument/publishDiagnostics`. The lint publisher snapshots or replaces
its lane under its existing lock, releases that lock, and then submits the lane
update. Transient analysis, view selection, joins, sorting, serialization, and
network writes never run under the lint publisher lock.

The composer:

- serializes lane updates and sends them in submission order;
- orders lint diagnostics first, then PromptText diagnostics sorted by range,
  code, and diagnostic ID;
- never deduplicates across lanes;
- emits one complete replacement on every send, including
  `diagnostics: []`;
- captures the current open-document version at composition time; and
- excludes any PromptText lane whose stored revision is not the exact current
  revision.

A synchronous clear means the invalidation handler clears the PromptText lane
and enqueues the composed replacement before returning. The transport may
finish writing asynchronously, but no later PromptText result may overtake the
clear.

A nonempty PromptText lane is stamped with:

```text
canonical URI
+ document open epoch, LSP version, source hash
+ transient source epoch
+ complete selected ViewStamp
+ PromptText controller request generation
```

Publication requires the document to remain open and every stamp component to
match exactly. It also requires a fresh `EvidenceSemantic + RequireCurrent`
selection with `ViewExact`, complete selected `ViewStamp` equality, the exact
resolved canonical source-ref owner/lifecycle join, and the exact current
transient template/interpolation match. Any mismatch discards the result; it
never restores, transforms, or publishes older PromptText diagnostics.

The lifecycle is exact:

| Event                                          | Immediate PromptText lane action                                                                      | Follow-up                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `didOpen`                                      | Reset to empty and enqueue the composed lint-only set with the open version                           | Schedule current analysis                                                     |
| accepted `didChange`                           | Cancel prior work, increment generation, clear, and enqueue using the new version                     | Schedule immediately; coordinator cancellation/coalescing handles rapid edits |
| `didSave`                                      | Cancel and clear because the previous semantic selection retires; enqueue with the still-open version | Schedule; remain empty until a coherent saved generation is available         |
| `didClose`                                     | Cancel, clear, enqueue lint-only without `version`, then remove PromptText document state             | Do not schedule                                                               |
| coherent semantic publication change           | Cancel and clear every affected open scope document, then enqueue                                     | Schedule each affected current document                                       |
| transient source epoch change                  | Cancel, clear, and enqueue before accepting the new epoch                                             | Schedule when the new source is available                                     |
| transient source or worker availability loss   | Cancel, clear, and enqueue immediately                                                                | Remain empty                                                                  |
| transient source or worker availability gain   | Never restore stale results                                                                           | Schedule current analysis                                                     |
| current analysis returns unavailable or errors | Clear and enqueue only if a nonempty current lane could otherwise remain                              | No saved fallback                                                             |
| superseded or cancelled result                 | Discard only                                                                                          | Never mutate a newer lane                                                     |

`didChange` schedules even before #266, allowing an edit that returns exactly
to saved bytes to regain saved semantic evidence. Cancelling code-action
revalidation never mutates the diagnostic lane.

Use the complete Rust
`PromptTextInterpolationBarrier.expressionRange` as the LSP diagnostic range.
It excludes `${` and `}` and contains the complete interpolation expression.
Nested evidence paths retain this outer expression range.

PromptText diagnostic data is a strict locator only:

```ts
interface PromptTextDiagnosticData {
  readonly kind: "prompt-text";
  readonly id: string;
}
```

`id` must match `^prompt-text:[0-9a-f]{64}$`. The complete diagnostic is:

```ts
{
  range: expressionRange,
  severity: 1,
  code: exactCruxCode,
  source: "crux",
  message: exactFrozenMessage,
  data: {
    kind: "prompt-text",
    id: indexDiagnostic.id,
  },
}
```

The data object rejects unknown fields. Omit `codeDescription`, `tags`,
`relatedInformation`, and all semantic evidence.

For every open document, `PublishDiagnosticsParams.version` is required and
equals the exact current `TextDocumentItem.version`, including before and
after save:

```ts
{
  uri,
  version: currentOpenDocumentVersion,
  diagnostics,
}
```

For a closed document, the PromptText lane is absent, the lint-only complete
replacement omits `version`, and `diagnostics: []` is sent when needed to clear
prior diagnostics. Project Index generation, overlay revision, open epoch, and
source hash are never used as the LSP version.

PromptText diagnostics require client
`textDocument.publishDiagnostics.versionSupport === true`; otherwise the
PromptText lane stays empty and lint behavior is unchanged. PromptText quick
fixes additionally require
`textDocument.publishDiagnostics.dataSupport === true`.

### Code-action revalidation

PromptText contributes eager standard `quickfix` actions only. Do not
implement `codeAction/resolve`.

For every distinct context diagnostic whose data strictly decodes as
`PromptTextDiagnosticData`:

1. Require its echoed range to equal the currently regenerated expression
   range.
2. Require the request range to intersect the expression range. A zero-width
   request position qualifies when it is within the closed endpoint interval.
3. Capture the current open document revision, source epoch, and request
   generation.
4. Perform a fresh `EvidenceSemantic + RequireCurrent` selection.
5. Obtain exact current transient analysis. Reusing the coordinator's exact
   current-revision result is allowed; reusing the published diagnostic lane
   is prohibited.
6. Regenerate the joined PromptText diagnostic from current evidence.
7. Require exact diagnostic ID and expression-range equality.
8. Recompute action eligibility and edit bytes from regenerated evidence and
   syntax.
9. Immediately before returning, recheck open state, open epoch, version,
   source hash, source epoch, request generation, and the complete selected
   `ViewStamp`.

Ignore client-echoed code, message, severity, source, and every field except
the strict `{kind, id}` locator and echoed range. Never accept client-echoed
semantic evidence.

A changed or closed document, unavailable view or worker, failed join, stale
generation, mismatched ID or range, unsupported `context.only`, or failed
final recheck returns no PromptText actions. A superseded request returns an
empty PromptText contribution. Protocol cancellation uses the standard
cancelled-request response.

Extend the local protocol with these standard narrow shapes:

```ts
interface VersionedTextDocumentIdentifier {
  readonly uri: string;
  readonly version: number;
}

interface TextDocumentEdit {
  readonly textDocument: VersionedTextDocumentIdentifier;
  readonly edits: readonly [TextEdit];
}

interface WorkspaceEdit {
  readonly documentChanges: readonly [TextDocumentEdit];
}
```

The version is never `null`. Every PromptText quick fix contains exactly one
`TextDocumentEdit` and one unannotated `TextEdit`, using the current canonical
URI and exact current open-document version. It contains no legacy `changes`,
resource operations, or change annotations. Closed documents receive no
action, and a version change during computation suppresses the action. The
versioned edit remains the final client-side race guard after the response.

Each action contains exactly:

```ts
{
  title: frozenActionTitle,
  kind: "quickfix",
  diagnostics: [currentRegeneratedDiagnostic],
  edit: versionedWorkspaceEdit,
}
```

Omit `isPreferred`, `disabled`, `command`, and `data`. Return applicable
actions in this order:

1. `Serialize with \`md.json()\``
2. `.join(", ")`
3. `Put sequence on its own line — changes layout`

`CRUX_PROMPT_TEXT_JSON_SERIALIZATION` has no action.

No new Crux initialize capability is added. Advertise standard code actions
as:

```ts
{
  codeActionKinds: ["quickfix"],
  resolveProvider: false,
}
```

PromptText actions additionally require client CodeAction literal support,
diagnostic data support, and an open versioned document. Existing non-
PromptText code-action behavior remains compatible.

## Static preview safety

The only placeholder bytes are `⟪unknown⟫` (U+27EA, ASCII `unknown`, U+27EB).
They never expose expression text, symbol names, inferred kinds, or values. A
placeholder is a nonempty scalar: at block position it receives normal parent
indentation and prevents empty-carrier seam removal. Truncation contributes no
preview text.

Without semantic joins, Oxc/Rust may prove:

- cooked string and no-substitution-template literals;
- finite numeric literals, including unary minus;
- `false`, `null`, and lexically unbound global `undefined`;
- direct array literals;
- direct nested tagged templates using the same Oxc-resolved tag binding;
- same-document `const` identifiers initialized directly with such a tagged
  template;
- one static property of a same-document `const` object literal whose value is
  directly such a template; and
- direct receiver-matching `tag.json(...)` over the inert grammar below.

Parentheses and runtime-transparent TypeScript wrappers (`as`, `satisfies`,
type assertion, and non-null) may be unwrapped. Do not follow aliases for
scalar/array/JSON values, fold constants or concatenation, or evaluate
conditionals, calls, imports, re-exports, or arbitrary property reads.
Imported/re-exported named fragments require an exact semantic join. Dirty
buffers keep same-document syntax preview but receive no saved joins.

Rendering uses Core #270 construction and render ordering:

- cooked strings render verbatim;
- finite numbers use ECMAScript `String(number)`, including `-0` as `0`, the
  shortest round-tripping decimal, fixed notation for
  `1e-6 <= abs < 1e21`, and otherwise lowercase `e`, an explicit positive
  exponent sign, and no exponent leading zeros;
- `false`, `null`, and `undefined` are omitted;
- `true`, nonfinite numbers, BigInt, objects, calls, and uncertain values are
  placeholders;
- an unknown/unsafe array leaf makes the whole interpolation a placeholder;
- every inline array is a whole-interpolation placeholder;
- block arrays recurse through direct literal arrays, omit holes and empty
  values, reject spreads, join remaining items with one LF, then apply the
  runtime empty-block seam and indentation rules; and
- direct/local/imported fragments normalize before parent indentation. An
  internal unknown remains its own placeholder. An active recursion cycle
  produces one placeholder at the cyclic reference.

`tag.json(...)` is syntax-exact only when the direct call receiver is the same
Oxc-resolved binding as the containing tag. Its closed inert argument grammar
allows string, numeric (including nonfinite and unary-negative), boolean,
`null`, unshadowed `undefined`, and recursively direct array/object literals,
including holes, trailing commas, and identifier/string/numeric object keys.
It rejects aliases other than unshadowed `undefined`, BigInt, spreads,
shorthand, methods/accessors, computed keys, calls/new/tagged values,
unpaired-surrogate values, and `__proto__` data properties.

Inert JSON follows JavaScript own-key order: canonical array-index keys
`0..2^32-2` ascending, then other keys in first-insertion order. Duplicate keys
retain first insertion position and last value. Array holes/undefined become
`null`; object undefined values are omitted; nonfinite numbers become `null`;
and `-0` becomes `0`. Output matches `JSON.stringify(value, null, 2)` exactly,
with LF and JavaScript escaping. A top-level undefined result is unknown.

`maxPreviewBytes` counts only UTF-8 bytes in `preview.text`, including
placeholders, separators, and indentation. Equality fits. Emit the longest
source-order prefix made of whole provenance segments; never split a segment
or Unicode scalar. The first segment that does not fit is omitted and yields
`max-preview-bytes` truncation.

The root template has fragment depth zero. Entering any direct, local, or
semantic fragment adds one; equality fits, and attempting the next level
truncates before expansion with `max-fragment-depth`. Cycle detection uses the
active stack, not a global visited set, so repeated acyclic references render
independently. The first deterministic source-order truncation wins.

Cancellation is transport-owned in V1. Cancelling `workerproc.CallRaw`
terminates the persistent Rust subprocess; its response is discarded and is
never cached or applied. A replacement worker serves later work. There is no
wire `cancelled` status and no claim of cooperative Rust cancellation.

Preview never imports modules, executes callbacks/getters/functions, parses
schemas, reads the environment, accesses the network, invokes tools, or
performs arbitrary JSON serialization. Runtime and Rust preview share golden
fixtures for normalization, numbers, placement, seams, arrays, JSON, fragments,
placeholders, limits, and reconstruction. Disagreement is a blocker.

## Static preview editor protocol

The client-to-server method is:

```text
crux/promptText/previewStatic
```

It needs no initialize-time client capability. The existing
`capabilities.experimental.crux.promptText.refreshSupport === true` remains
only the opt-in for the server-to-client `crux/promptText/refresh` request.

```ts
interface PromptTextDocumentStamp {
  readonly uri: string;
  readonly openEpoch: number;
  readonly version: number;
  readonly sourceHash: string;
}

type PromptTextPreviewTarget =
  | {
      readonly kind: "position";
      readonly position: Position;
    }
  | {
      readonly kind: "template-range";
      readonly range: Range;
    };

interface PromptTextPreviewStaticParams extends PromptTextDocumentStamp {
  readonly protocolVersion: 1;
  readonly target: PromptTextPreviewTarget;
}

interface PromptTextPreviewSelection {
  /** Request-local source-order display value, never template identity. */
  readonly ordinal: number;
  /** Exact current full tagged-template range. */
  readonly range: Range;
}

type PromptTextPreviewServerUnavailableReason =
  | "document-not-open"
  | "revision-mismatch"
  | "analysis-unavailable"
  | "request-unsupported"
  | "template-not-found"
  | "template-ambiguous"
  | "template-unsupported"
  | "preview-unavailable";

type PromptTextPreviewStaticResult =
  | (PromptTextDocumentStamp & {
      readonly protocolVersion: 1;
      readonly kind: "ready";
      readonly selection: PromptTextPreviewSelection;
      readonly requestStatus: "complete" | "truncated";
      readonly templateStatus: "complete" | "truncated";
      readonly previewStatus: "complete" | "truncated";
      readonly evidence: "syntax-exact" | "semantic-exact";
      readonly text: string;
      readonly truncation?: {
        readonly reason: "max-preview-bytes" | "max-fragment-depth";
        readonly limit: number;
        readonly emittedBytes: number;
      };
    })
  | (PromptTextDocumentStamp & {
      readonly protocolVersion: 1;
      readonly kind: "choose";
      readonly requestStatus: "complete" | "truncated";
      readonly choices: readonly PromptTextPreviewSelection[];
    })
  | (PromptTextDocumentStamp & {
      readonly protocolVersion: 1;
      readonly kind: "unavailable";
      readonly reason: PromptTextPreviewServerUnavailableReason;
    });
```

The stamp fields match decorations exactly: URI is nonempty; `openEpoch` is a
positive JavaScript safe integer; version is an LSP integer; and source hash is
64 lowercase hexadecimal characters. Ordinals, positions, and truncation
values are integers in `0..2^31-1`. Ranges are nonempty, ordered, half-open,
zero-based UTF-16.

Request and result decoding rejects unknown fields recursively. Invalid request
objects are JSON-RPC `InvalidParams`. An invalid/foreign result is never
partially interpreted. It becomes client-side `analysis-unavailable`; it may
clear only the exact slot already associated with that request. An unassociated
initial `position` result cannot mutate any retained slot.

A ready result cannot carry unsupported structural status. Complete preview
omits truncation; truncated preview requires exactly one valid truncation.
Choose results have nonempty, individually unique, strictly increasing
ordinals and unique strictly source-ordered ranges. Every result echoes the
exact request stamp. Phase 8 segments remain inside shared analysis and are
omitted because Phase 9 has no client consumer.

### Template selection and slot identity

The command uses only the active file-scheme TypeScript, TSX, JavaScript, or
JSX editor and its primary selection's active position. Additional selections
are ignored. Without an eligible editor it shows:

```text
Open a TypeScript or JavaScript source editor before previewing PromptText.
```

For a position request:

1. If exactly one included template exists, select it.
2. Otherwise choose the uniquely innermost full range containing the position.
3. An equal innermost tie returns only those tied choices.
4. No containing template returns all included templates in source order.
5. No choices returns `template-not-found`.

Quick Pick labels are exactly:

```text
Template <ordinal + 1> — line <range.start.line + 1>
```

Cancellation performs no second request, creates or changes no slot, and shows
no message. A chosen item is sent back in a second `template-range` request;
the client never trusts the earlier range locally. That request requires
exactly one current Oxc candidate with identical endpoints.

A slot key is canonical source URI plus its exact current tracked template
range. Candidate ordinal is never identity. Ready handling reserves this key
atomically and reuses an attached or detached matching slot before allocating.
Reuse replaces the entire stamp, ordinal, statuses, evidence, and content.
Reopening under a new epoch may reuse only after a new exact ready response.
Tracking updates registry keys atomically; a collision retains the lower slot
ID and marks the other `template-ambiguous`.

An initial `position` request has no slot association until valid `ready`
supplies an exact selection range. Its unavailable, transport, invalid/foreign,
or other current failure leaves every retained slot unchanged; a superseded or
stale result is discarded silently. `choose` and Quick Pick cancellation also
mutate nothing. Valid position `ready` atomically reuses only the slot at its
returned exact key or creates one, and changes no other slot.

An explicit `template-range` request is associated with a slot only when one
already exists at its exact canonical-source-URI/range key. A current
unavailable, transport, invalid/foreign, or foreign-stamp failure clears and
updates only that associated slot; without one it creates nothing. Background
rematch and refresh additionally retain the originating slot ID and generation
client-side. A current failure clears only that slot; a response superseded by
a newer generation or stamp is silently discarded and cannot clear newer
refreshing or ready content.

Never infer association from source URI alone, cursor containment, candidate
ordinal, nearest range, sole-slot state, or previous command history. V1 adds
no request or result field for this client-owned association.

### Exact editor EOL boundary

`TextDocumentContentProvider` does not guarantee line-ending preservation.
Every slot opens invisibly with empty content first. After the virtual
document's `EndOfLine` is known:

- an LF document accepts LF and rejects every CR;
- a CRLF document requires every LF to be immediately preceded by CR and every
  CR to be immediately followed by LF;
- bare CR and mixed line endings are unavailable; and
- text with no CR/LF is compatible with either.

After provider change, require `document.getText() === ready.text` before the
initial editor is shown. A mismatch clears and waits for verified empty
content, then enters client-only `editor-eol-normalization`. Later incompatible
updates clear immediately. Never transform line endings, substitute
placeholders, or label normalized text exact.

Client-only slot reasons add `editor-eol-normalization`, `source-closed`, and
`target-lost`; Go never sends them.

### Virtual URI, title, and metadata

Slot IDs are positive lowercase base-10 safe integers, monotonically increasing
and never reused during one extension-host lifetime. Source label construction:

1. take only `Uri.path` basename;
2. retain ASCII letters, digits, `.`, `_`, and `-`;
3. replace each maximal run of other code points with one `-`;
4. remove leading/trailing `.`, `_`, and `-`;
5. truncate to 40 ASCII characters; and
6. use `source` when empty.

The initial line is one-based and frozen at slot creation. Construct the URI
exactly; authority and fragment remain empty:

```ts
vscode.Uri.from({
  scheme: "crux-prompt-preview",
  path: `/Static preview — ${sourceLabel} L${initialLine} — ${slotId}.md`,
  query: `slot=${slotId}`,
});
```

Its tab title is:

```text
Static preview — <sourceLabel> L<initialLine> — <slotId>.md
```

Register only a `TextDocumentContentProvider`, plus one scheme-scoped
`CodeLensProvider`. The CodeLens uses range `(0,0)..(0,0)` and internal no-op
command `crux.promptText.previewMetadata`; its title is metadata and never
enters copied content. Do not add a filesystem provider, status item, text
decoration, webview, parser, evaluator, or save path.

Ready CodeLens title:

```text
Static preview — unknown values are placeholders · <source>:<line> · <evidence> · request <requestStatus> · template <templateStatus> · preview <previewStatus><suffix>
```

The suffix is `: max preview bytes` or `: max fragment depth`; a complete empty
preview appends ` · empty`. Refreshing and unavailable titles are:

```text
Static preview — refreshing · <source>:<line>
Static preview — unavailable · <source>:<line> · <reason>
```

Use the same sanitized source label and current one-based line. Never present
directories, URI authority/query, hashes, source text, fragment names, or
expression text.

Verify language `markdown`. If `languages.setTextDocumentLanguage` is required,
enter a one-shot `language-transition` state: ignore only the matching
synthetic close, bind the matching open/returned document, and publish/show
nothing until it resolves. Failure, another URI, or a second unmatched close
disposes the slot. Ordinary later closes dispose immediately.

Show the pinned, focused editor with:

```ts
{
  viewColumn: vscode.ViewColumn.Beside,
  preserveFocus: false,
  preview: false,
}
```

Reopening reveals the same resource. Split editors count as one slot.

### Refresh, tracking, and capacity

Edit handling clears content synchronously, marks refreshing, cancels work,
increments the slot generation, transforms the target, and waits exactly 150
ms after the last edit before requesting the current stamp. Apply only when
generation, source URI, epoch, version, hash, and target range still match.

Track the pre-event template as UTF-16 offsets `[s,e)`, `s < e`. For one ranged
change `[a,b)` with replacement length `n` and `d = n - (b-a)`:

- insertion before the target shifts both by `n`;
- insertion strictly inside extends `e` by `n`;
- insertion strictly after is unchanged;
- insertion exactly at either boundary loses the target;
- replacement ending at/before `s` shifts both by `d`;
- replacement starting at/after `e` is unchanged;
- replacement strictly inside adjusts `e` by `d`; and
- every other overlap, boundary touch, crossing, or covering loses the target.

All changes in one event use valid `rangeOffset`/`rangeLength` against the
pre-event document. Reject full-document changes, invalid or overlapping
ranges. Sort valid changes by descending offset, apply them in that order, then
convert final offsets through the post-event document. Any lost case clears
and stops automatic retargeting.

Refresh requests repull every attached slot whose source is open; they never
republish cached bytes. Source close cancels/clears and retains the tab as
`source-closed`. Reopen may re-request only after the new didOpen stamp exists.
Rename/move detaches without following. Reconnect/handover cancels and clears,
then re-requests still-open unchanged sources after fresh stamps. Virtual
document close disposes its slot/content/CodeLens/request. Deactivation
disposes every slot, provider, CodeLens provider, and request. There is no
closed-result cache.

At most 16 preview resources may be active; split views count once. Reuse is
allowed at capacity. Never auto-close a tab or evict an active slot. A
seventeenth distinct preview shows:

```text
Crux already has 16 static previews open. Close one before opening another.
```

Server unavailable messages are:

```text
document-not-open: Open the source document before previewing it.
revision-mismatch: The source changed before the static preview completed. Try again.
analysis-unavailable: Static preview is temporarily unavailable.
request-unsupported: Static preview does not support this document.
template-not-found: No PromptText template was found at the selected location.
template-ambiguous: Crux could not uniquely identify the selected PromptText template.
template-unsupported: This PromptText template cannot be statically previewed.
preview-unavailable: Static preview is unavailable for this PromptText template.
```

An unavailable response to an explicit command shows its mapped message.
Background edit/refresh unavailability only updates the retained slot CodeLens.
If an explicit ready response fails the editor EOL gate, show the empty
unavailable tab and:

```text
VS Code cannot preserve this preview’s exact line-ending bytes.
```

## Exact-preview Runtime Bridge

Phase 15 adds one explicit, target-scoped Runtime Bridge command:

```text
prompt.previewExact → canonical Prompt.inspect()
```

It preserves the existing `store.read` command unchanged. The first release
advertises only canonical Prompt definitions. It does not advertise contexts,
named or anonymous fragments, ownerless prompts, arbitrary callbacks or
workspace paths, or message-mode prompts whose canonical `InspectResult` does
not expose their message payload. Contexts remain static-preview-only until
Core has a public `Context.inspect()` API; the bridge must not add a private
context renderer.

One process-owned active prompt catalogue is shared by WebSocket and HTTP
transports. Go and editor clients never hold callback registries or render
prompts. The application runtime is the sole execution owner.

### Strict wire schemas

Every new exact-preview object rejects unknown fields recursively. Optional
fields are omitted rather than encoded as `null`; `null` remains valid inside
user JSON values. Existing `store.read` objects keep their current
compatibility behavior and must not be tightened as a side effect. The bridge
capability and request schemas become discriminated unions with a legacy store
branch and the following preview branch.

```ts
const PromptPreviewCatalogueRevisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

type StrictJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StrictJsonValue[]
  | { readonly [key: string]: StrictJsonValue };

const ScalarValidStringSchema = z.string().superRefine((value, context) => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) continue;

    const next = value.charCodeAt(index + 1);
    if (codeUnit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      index += 1;
      continue;
    }

    context.addIssue({ code: "custom", message: "Invalid Unicode scalar." });
    return;
  }
});

const StrictJsonValueSchema: z.ZodType<StrictJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    ScalarValidStringSchema,
    z.array(StrictJsonValueSchema),
    z.record(ScalarValidStringSchema, StrictJsonValueSchema),
  ]),
);

const StrictJsonObjectSchema = z.record(
  ScalarValidStringSchema,
  StrictJsonValueSchema,
);

const PromptPreviewInputDescriptorSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z
    .object({
      mode: z.literal("schema"),
      schema: StrictJsonObjectSchema,
    })
    .strict(),
  z.object({ mode: z.literal("raw") }).strict(),
]);

const PromptPreviewTargetSchema = z
  .object({
    definitionId: z.string().min(1).max(512),
    kind: z.literal("prompt"),
    name: z.string().min(1).max(512),
    description: z.string().min(1).max(4096).optional(),
    input: PromptPreviewInputDescriptorSchema,
  })
  .strict();

const PromptPreviewCapabilitySchema = z
  .object({
    command: z.literal("prompt.previewExact"),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    targets: z.array(PromptPreviewTargetSchema).min(1).max(512),
  })
  .strict();

const PromptPreviewOptionsSchema = z
  .object({
    provider: z.string().min(1).max(128).optional(),
    modelId: z.string().min(1).max(256).optional(),
    tokenBudget: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

const PromptPreviewPayloadSchema = z
  .object({
    input: StrictJsonObjectSchema,
    options: PromptPreviewOptionsSchema.optional(),
  })
  .strict();

const PromptPreviewRequestSchema = z
  .object({
    type: z.literal("command.request"),
    commandId: z.string().min(1).max(128),
    command: z.literal("prompt.previewExact"),
    targetId: z.string().min(1).max(512),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    payload: PromptPreviewPayloadSchema,
    deadlineMs: z.number().int().positive().max(30_000),
  })
  .strict();
```

`targetId` is exactly the canonical Project Index `definitionId`. It is never
an authored ID, source path, source ref, symbol, or fragment ID.

### Catalogue targets and lifecycle

For an eligible prompt, use:

```ts
const definitionId = promptDefinitionRef(prompt.id).id;
const name = prompt.id;
```

A target is eligible only when all of these hold:

- it is a Core `Prompt`;
- it has a nonempty authored ID;
- it uses the canonical system/prompt inspection mode rather than
  `config.messages`;
- it belongs to the current active public configuration registry; and
- its complete bounded wire projection is valid.

Input descriptors mean:

- `none`: the prompt has no merged input schema and accepts only `{}`;
- `schema`: Core's canonical Zod-to-JSON-Schema projection can represent the
  merged schema; and
- `raw`: a merged schema exists but cannot be represented. Runtime validation
  remains authoritative.

Sort targets by code-point order of `definitionId`. Existing duplicate authored
prompt IDs remain a configuration error. If distinct prompts collide on the
canonical definition ID, omit every target in that collision. Omit an
individually invalid target or a target whose compact schema exceeds 65,536
UTF-8 bytes. After those and collision omissions, omit the entire preview
capability, while retaining valid `store.read`, when no targets remain, more
than 512 targets remain, or the complete compact capability exceeds 1,048,576
UTF-8 bytes:

| Bound                    | Limit                 |
| ------------------------ | --------------------- |
| Remaining targets        | 1..512                |
| One compact schema       | 65,536 UTF-8 bytes    |
| Complete capability JSON | 1,048,576 UTF-8 bytes |

The omission warning contains only a fixed stable code and aggregate counts.
It must not contain IDs, schemas, descriptions, or other target data.

The active prompt catalogue is an immutable process-owned slot in Core's
existing process registry. Advance that registry's internal version when
introducing the slot. A successful public `configure()` atomically publishes a
frozen catalogue, including an empty one, with a monotonically increasing,
positive safe-integer `catalogueRevision`. A failed configure leaves the
previous catalogue and revision unchanged. A newer public configuration
replaces the older one. Disposing the active configuration publishes an empty
catalogue at a new revision; disposing an older configuration is a no-op and
must never resurrect it.

The internal `configure({ prompts: [] })` used during configuration assembly is
private and nonpublishing. A Runtime Bridge created after publication includes
the current initial manifest and subscribes to later replacements. WebSocket
connections receive a complete replacement `runtime.hello` with the same
`peerId`; Go treats it as an atomic capability replacement and increments a
private manifest revision. HTTP returns the current manifest on every GET and
revalidates it for every POST. Configuration replacement closes old bridge
resources before opening new ones, and disposal unsubscribes.

Catalogue objects, prompt callbacks, requests, and results are memory-only.

### Input validation and limits

`payload.input` is always a JSON object. Nested arrays, objects, scalar-valid
strings, finite numbers including `-0`, booleans, and `null` are accepted.
Reject `undefined`, array holes, functions, symbols, bigint, nonfinite numbers,
cycles, accessors, foreign prototypes, lone surrogates, and duplicate raw JSON
keys.

The schemas above validate the decoded recursive JSON value. The shared bounded
wire validator separately checks raw JSON for duplicate keys before decoding
and checks object prototypes/accessors at programmatic Core entry points,
because decoded Zod validation cannot prove either raw-wire property.

Both Go before dispatch and Core immediately before inspection enforce the same
limits:

| Measurement                   | Limit               |
| ----------------------------- | ------------------- |
| Compact command request JSON  | 262,144 UTF-8 bytes |
| Container depth               | 32                  |
| Value nodes                   | 10,000              |
| Object keys                   | 5,000               |
| One key                       | 256 UTF-8 bytes     |
| One string value              | 65,536 UTF-8 bytes  |
| Decoded JSON value accounting | 131,072 bytes       |

Equality fits. The root object has depth one; entering an object or array adds
one. Node count includes the root and every property value or array element,
but not keys. Key count includes every property after duplicate rejection.
Decoded value accounting is deterministic:

- `null` costs 4, `true` costs 4, `false` costs 5, and a number costs 8;
- a string costs its Unicode-scalar UTF-8 bytes;
- an array costs 2 plus commas plus child weights; and
- an object costs 2 plus commas, key UTF-8 bytes, colons, and child weights.

The only inspection options are `provider`, `modelId`, and `tokenBudget`.
Sampling options, tools, model objects, adapters, and execution settings are
not accepted.

Call `Prompt.inspect()` exactly once. Its existing resolver performs input
parse, refinements, transformations, and coercion. Do not preflight with a
second `safeParse()`. The resolver exposes failed input parsing internally as
a structured `PromptInputValidationError`, retaining the public validation
message. The bridge catches that error; the one normalized value from the
failed/successful parse is never echoed.

### Validation result

Expected user-input failures are successful command results:

```ts
const PromptPreviewValidationIssueSchema = z
  .object({
    code: z.string().min(1).max(64),
    path: z
      .array(
        z.union([
          z.string().max(256),
          z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        ]),
      )
      .max(32),
    message: z.string().min(1).max(1024),
  })
  .strict();

const PromptPreviewValidationResultSchema = z
  .object({
    status: z.literal("validation-error"),
    targetId: z.string().min(1).max(512),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    issues: z.array(PromptPreviewValidationIssueSchema).max(128),
    omittedIssueCount: z.number().int().nonnegative(),
  })
  .strict();
```

Preserve issue order, return the first 128 issues, and report the exact omitted
count. Return no input values, normalized values, schema, stack, or cause.
A throwing refinement is an inspection failure, not a validation result.

### Ready result and provenance

The ready projection contains only the inspect result's system, prompt,
token-total, context-decision, token-budget, and tool-name fields:

```ts
const PromptPreviewSegmentSchema = z
  .object({
    kind: z.enum(["static", "dynamic", "unknown"]),
    startUtf16: z.number().int().nonnegative(),
    endUtf16: z.number().int().nonnegative(),
    source: z.string().min(1).max(512).optional(),
    observedAt: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    sourceVersion: z.string().min(1).max(256).optional(),
  })
  .strict();

const PromptPreviewPartSchema = z
  .object({
    source: z.string().min(1).max(512),
    text: z.string(),
    tokens: z.number().int().nonnegative(),
    skipped: z.boolean(),
    segments: z.array(PromptPreviewSegmentSchema),
    staticTokens: z.number().int().nonnegative().optional(),
    dynamicTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const PromptPreviewDroppedContextSchema = z
  .object({
    source: z.string().min(1).max(512),
    text: z.string(),
    tokens: z.number().int().nonnegative(),
    priority: z.number().finite(),
    segments: z.array(PromptPreviewSegmentSchema),
  })
  .strict();

const PromptPreviewExcludedContextSchema = z
  .object({
    source: z.string().min(1).max(512),
    reason: z.string().max(1024),
  })
  .strict();

const PromptPreviewReadyResultSchema = z
  .object({
    status: z.literal("ready"),
    targetId: z.string().min(1).max(512),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    inspection: z
      .object({
        system: z
          .object({
            text: z.string(),
            tokens: z.number().int().nonnegative(),
            coverage: z.enum(["complete", "partial"]),
            parts: z.array(PromptPreviewPartSchema).max(1024),
          })
          .strict(),
        prompt: z
          .object({
            text: z.string(),
            tokens: z.number().int().nonnegative(),
            segments: z.array(PromptPreviewSegmentSchema),
            staticTokens: z.number().int().nonnegative().optional(),
            dynamicTokens: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        totalTokens: z.number().int().nonnegative(),
        droppedContexts: z.array(PromptPreviewDroppedContextSchema).max(1024),
        excludedContexts: z.array(PromptPreviewExcludedContextSchema).max(1024),
        tokenBudget: z.number().int().nonnegative().optional(),
        tools: z.array(z.string().min(1).max(512)).max(1024).optional(),
      })
      .strict(),
  })
  .strict();

const PromptPreviewResultSchema = z.discriminatedUnion("status", [
  PromptPreviewReadyResultSchema,
  PromptPreviewValidationResultSchema,
]);

const PromptPreviewResultEnvelopeSchema = z
  .object({
    type: z.literal("command.result"),
    commandId: z.string().min(1).max(128),
    result: PromptPreviewResultSchema,
  })
  .strict();
```

Run IDs, trace IDs, approval data, input schema, runtime ports, stacks, causes,
and inputs are never projected. Go rejects those fields even when empty.

Segment coordinates are zero-based, half-open UTF-16 offsets relative to their
containing text. Preserve resolver order. Valid nonempty resolver segments
must exactly reconstruct the containing text, with static/dynamic kinds and
only segment-owned `source`, `observedAt`, and `sourceVersion` metadata. If
segments are absent, malformed, overlapping, or do not concatenate exactly,
emit one `unknown` segment spanning the whole nonempty text; empty text uses an
empty segment array.

`system.coverage` is `complete` only when joining every non-skipped, nonempty
part text with `\n\n` exactly equals `system.text`. It is `partial` otherwise,
including when provider adaptation changes the final system text.

Ready results are all-or-nothing and are never truncated:

| Measurement                                | Limit                 |
| ------------------------------------------ | --------------------- |
| Aggregate UTF-8 bytes of all string fields | 1,048,576             |
| Provenance segments                        | 10,000                |
| Compact result JSON before its envelope    | 2,097,152 UTF-8 bytes |

Repeated strings count every time. Equality fits. Overflow returns
`result_limit_exceeded`.

### Errors, cancellation, and retirement

Validation failures use the result union above. Every other failure uses:

```ts
const PromptPreviewErrorCodeSchema = z.enum([
  "invalid_request",
  "target_unavailable",
  "catalogue_changed",
  "target_retired",
  "input_limit_exceeded",
  "inspection_timeout",
  "inspection_failed",
  "result_limit_exceeded",
  "internal_error",
]);

const PromptPreviewErrorSchema = z
  .object({
    code: PromptPreviewErrorCodeSchema,
    message: z.string().min(1).max(1024),
    details: z
      .object({
        targetId: z.string().min(1).max(512).optional(),
        expectedCatalogueRevision:
          PromptPreviewCatalogueRevisionSchema.optional(),
        actualCatalogueRevision:
          PromptPreviewCatalogueRevisionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const PromptPreviewErrorEnvelopeSchema = z
  .object({
    type: z.literal("command.error"),
    commandId: z.string().min(1).max(128),
    error: PromptPreviewErrorSchema,
  })
  .strict();
```

Never include a stack, cause, error object, input, normalized value, output,
provenance, schema, source key, or arbitrary details. For
`inspection_failed`, a scalar-valid `Error.message` may be UTF-8 safely
truncated to 1024 bytes for the local control-plane response only. A non-Error
uses exactly `Prompt inspection failed.` Neither form may enter logs or events.
Legacy generic result/error envelopes remain valid for legacy commands only.

`deadlineMs` is required and capped at 30 seconds. Local uses 15 seconds unless
the caller supplies a shorter deadline; the earliest request context or
deadline wins. Core races inspection against deadline and catalogue
retirement. Go stops waiting on request cancellation, deadline, disconnect, or
target invalidation. Because `ResolveCallOptions` has no abort signal,
application callbacks may finish after retirement; late outcomes are discarded
and never sent, logged, or cached.

WebSocket cancellation is:

```ts
const PromptPreviewCancelSchema = z
  .object({
    type: z.literal("command.cancel"),
    commandId: z.string().min(1).max(128),
    reason: z.enum(["cancelled", "deadline-exceeded", "target-retired"]),
  })
  .strict();
```

HTTP cancellation uses the request context. Cancellation retires response
ownership.

Execution captures the exact `{ catalogueRevision, target }`. Any catalogue
replacement or disposal retires it, even if the new catalogue contains the
same definition ID. Return `target_retired` only when the transport still owns
a reply; otherwise discard. A newer same-ID target requires a fresh request.

### Execution and side-effect boundary

Only an explicit Preview dispatch may call `Prompt.inspect()`. Opening the
panel or command, editing inputs, saving source, discovery, capability refresh,
and rendering must not dispatch.

Inspection may execute trusted application code through input
refinements/transforms, sanitizers, prompt callbacks, context predicates and
system callbacks, contributors, retrieval, memory, and canonical memo
read/write. These callbacks may perform side effects or I/O. The Phase 16 UI
must state this clearly at the explicit confirmation boundary.

Inspection must not perform provider generation, tool invocation, adapter or
Core observability, or ordinary Run creation; it creates no run ID or trace ID.
Inputs and outcomes never enter Project Index, LSP, bridge, Local, or Devtools
caches or persistent storage.

### Go normalization and deterministic selection

Go uses typed exact-preview structs after decoding; it does not pass raw JSON
through dispatch. Extend its dispatch request with:

```go
type DispatchRequest struct {
	// Existing fields remain.
	Environment       string
	CatalogueRevision uint64
}
```

Preview dispatch requires target ID, catalogue revision, payload, and deadline.
Legacy store dispatch keeps its existing optional behavior.

Normalize at most one valid preview capability per peer. A duplicate or
invalid preview capability invalidates the whole preview group while retaining
a valid store capability. Unknown fields, `null`, foreign commands, duplicate
targets, or invalid bounds invalidate the group. Sort peers by `peerId` and
targets by code-point order.

Selection is deterministic:

1. validate the request;
2. snapshot live peers sorted by `peerId`;
3. apply an explicit `peerId`, if supplied;
4. apply an explicit exact environment enum, if supplied;
5. retain preview-capable peers;
6. retain peers advertising the target;
7. retain peers at the requested catalogue revision;
8. return the most specific zero-match error;
9. return ambiguity when more than one peer remains; otherwise
10. dispatch to the sole peer.

The stable Local result codes and exact messages are:

| Code                      | Message                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `invalid_request`         | `The exact-preview request is invalid.`                                       |
| `no_peer`                 | `No live runtime peer is available.`                                          |
| `environment_unavailable` | `No live runtime peer matches the selected environment.`                      |
| `capability_unavailable`  | `No live runtime peer supports exact prompt preview.`                         |
| `target_unavailable`      | `No live runtime peer advertises this prompt target.`                         |
| `catalogue_changed`       | `The runtime prompt catalogue changed. Refresh and try again.`                |
| `ambiguous_peer`          | `Multiple runtime peers can inspect this prompt. Select one and retry.`       |
| `peer_disconnected`       | `The selected runtime peer disconnected.`                                     |
| `target_disappeared`      | `The prompt target changed while preview was running. Refresh and try again.` |
| `deadline_exceeded`       | `Exact preview timed out.`                                                    |
| `cancelled`               | `Exact preview was cancelled.`                                                |
| `invalid_response`        | `The runtime returned an invalid exact-preview response.`                     |
| `command_failed`          | `Exact preview failed in the application runtime.`                            |
| `endpoint_not_allowed`    | `The selected HTTP runtime endpoint is not allowed.`                          |

The zero-match precedence is `invalid_request`, `no_peer`,
`environment_unavailable`, `capability_unavailable`, `target_unavailable`,
`catalogue_changed`; ambiguity follows those filters.

An ambiguous selection returns only sorted
`PeerChoice { PeerID, RuntimeName, Environment }` records. It exposes no
endpoint, labels, capabilities, targets, or schemas. Existing `store.read`
implicit selection remains the lexicographically first capable peer and must
not inherit the preview ambiguity rule.

Repeated `runtime.hello` atomically replaces capabilities for the same live
connection and advances a private manifest revision. Immediately before send
and before accepting a terminal response, revalidate connection identity,
manifest revision, target, and catalogue revision. Manifest or target loss,
reconnect, and out-of-order replacement become `target_disappeared`;
disconnect becomes `peer_disconnected`. Late responses never affect newer
requests.

HTTP and WebSocket decode command-aware envelopes, match `commandId`, and
reject foreign or `null` fields, target/revision mismatches, invalid UTF-16
coordinates or coverage, bound violations, and any run/trace fields. HTTP
retains loopback-only policy, never follows a redirect to a non-loopback
endpoint, and never logs response bodies.

### Privacy and telemetry

Never log, cache, persist, publish, or attach to events any input, normalized
value, output text, parts, segments, schemas, validation paths or messages,
runtime error messages, source keys, provenance, or `targetId`.

Go may retain only these ephemeral dispatch measurements:

- command name and command ID;
- peer ID, environment, and transport;
- stable terminal category/code;
- duration in milliseconds;
- request and result byte counts; and
- advertised target count.

Preview failure events keep `Event.Error` nil and carry only the stable terminal
code. Core emits no success or validation logs. Catalogue-bound warnings use
only fixed stable codes and aggregate counts.
