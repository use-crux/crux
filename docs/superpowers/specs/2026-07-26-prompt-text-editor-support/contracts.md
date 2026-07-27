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
unsupported template retains its candidate, tag, and template ranges, but its
literal islands, interpolation barriers, mappings, blocks, spans, links,
nesting, preview text, and preview segments are empty. CommonMark never
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
pub struct PromptTextInterpolationBarrier {
    pub index: u32,
    pub range: PromptTextRange,
    pub expression_range: PromptTextRange,
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
      readonly fragmentJoins?: readonly PromptTextFragmentJoinEvidence[];
    };
  };
}
```

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
worker join. A missing row/hash or failed invariant suppresses it. This record
changes semantic facts and the Go snapshot: bump
`SEMANTIC_FACTS_CACHE_EPOCH` and `ProjectIndexSnapshotCacheEpoch`, update both
semantic backends and parity/migration fixtures, but do not bump
`STATIC_PARSE_CACHE_EPOCH`.

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

## Diagnostic evidence

`IndexDiagnostic` gains an optional discriminated evidence field:

```ts
type PromptTextDiagnosticEvidence = {
  kind: "prompt-text";
  sourceRefId: string;
  interpolationIndex?: number;
  interpolationPath?: readonly number[];
  proof: "syntax-exact" | "semantic-exact";
  cause:
    | {
        kind: "invalid-interpolation";
        runtimeKinds: readonly PromptTextInvalidRuntimeKind[];
        mdJsonApplicable?: true;
      }
    | {
        kind: "inline-sequence";
        joinableWithComma?: true;
      }
    | {
        kind: "json-serialization";
        reason: "undefined-result";
      };
};
```

Runtime kinds are finite closed literals: non-finite number, boolean, bigint,
symbol, function, object, and cyclic array.

Only #270 construction diagnostics ship:

- `CRUX_PROMPT_TEXT_INVALID_INTERPOLATION`;
- `CRUX_PROMPT_TEXT_INLINE_SEQUENCE`; and
- `CRUX_PROMPT_TEXT_JSON_SERIALIZATION`.

They are hard compiler diagnostics, not configurable `IndexLintFinding`s.

Publication requires:

1. a resolved canonical source ref with matching owner/lifecycle;
2. normalized saved semantic diagnostic evidence; and
3. exact current transient syntax mapping.

Diagnose only when every possible value is invalid. Do not diagnose `any`,
`unknown`, unconstrained generics, or unions containing an accepted value.
Promises retain runtime kind `object`. Initial JSON diagnosis is limited to a
direct canonical `md.json(...)` proven to return undefined.

Both semantic backends emit normalized evidence with exact parity.

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
