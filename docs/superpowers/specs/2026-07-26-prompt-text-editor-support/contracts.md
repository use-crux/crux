# PromptText editor contracts

Parent: [PromptText editor support](../2026-07-26-prompt-text-editor-support-design.md)

## Transient query

The request contains:

- protocol version;
- file, language, open epoch, document version, source hash, and text;
- a bounded catalogue of proven fragment source refs/snippets; and
- centralized size, candidate, traversal, and output limits.

Each analyzed template contains:

- request-local candidate identity;
- tag and template ranges;
- literal islands and interpolation barriers;
- projection-to-source mappings;
- normalized blocks, spans, links, and nesting; and
- static preview text, segments, placeholders, and truncation.

The fragment catalogue is backend-neutral. It contains IDs, symbols, snippets,
hashes, and source locations, never compiler AST/checker objects. Missing or
uncertain fragments remain placeholders.

Preview segments distinguish authored literals, known values, named fragments,
placeholders, and truncation markers. Their concatenation must reconstruct
preview text exactly.

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

### Fragment-catalogue identity

The transient coordinator computes the fragment-catalogue digest; callers
supply fragments, never a trusted digest. It validates the catalogue, sorts the
same records that will be sent to the worker, and hashes this canonical byte
stream with SHA-256:

```text
ASCII "crux-prompt-text-fragment-catalogue-v1\0"
u32be(record count)
records sorted lexicographically by their complete encoded record bytes
```

Each record encodes these fields in order:

```text
id, symbol, file, sourceHash, start.line, start.character,
end.line, end.character, snippet
```

Strings encode as `u32be(UTF-8 byte length) || exact UTF-8 bytes`; positions
encode as `u32be`. Digesting does not normalize Unicode, paths, line endings,
or hashes, and it does not use JSON. Catalogue construction must already have
produced canonical file and source-hash values. A repeated `id`, including an
identical duplicate, is invalid; different IDs with otherwise equal records
are permitted.

The empty catalogue digest is SHA-256 over the domain prefix followed by a
zero record count:

```text
98ae68c7e1000785759e8e128c5a5c4a3aadd3c86e8ce98aab3a1d97913216fe
```

Invalid UTF-8 or length overflow, malformed ranges, noncanonical required
identity fields, duplicate IDs, and catalogue limit violations make transient
analysis unavailable. The coordinator does not call the worker or reuse a
prior result. The digest enters the coalescing/cache key beside the selected
view revision.

This digest is private PromptText catalogue identity. Its domain, inputs, and
lifecycle are distinct from #266's semantic-source-profile digest; neither may
substitute for, include, or be included in the other.

`maxFragmentBytes` bounds the sum of all canonical encoded fragment-record
lengths, not each snippet or record:

```text
sum(encoded_record.len) <= maxFragmentBytes
```

The count includes, for every record, five big-endian `u32` string-length
prefixes, the exact UTF-8 bytes of `id`, `symbol`, `file`, `sourceHash`, and
`snippet`, and four big-endian `u32` range positions. It excludes the digest
domain prefix, catalogue count word, digest bytes, JSON syntax and escaping,
and all request fields outside the fragment records.

Go checks `maxFragments` first, then validates and encodes records in caller
order, rejects duplicate IDs, and accumulates encoded lengths with checked
`u64` addition. Equality fits. Excess or arithmetic/length overflow fails
closed. A zero byte or count limit permits only an empty catalogue; the limits
are conjunctive. Sorting occurs only after every record and the aggregate
budget validate. A failure yields no canonical vector or digest, cannot reuse a
cached/coalesced result, and never invokes the worker.

The strict ATTACHED V1 request-body limit is:

```text
MaxRequestBytes =
    6 * MaxDocumentBytes
  + 6 * defaultMaxFragmentBytes
  + 64 KiB
```

At the V1 defaults this is `13_041_664` bytes. The final 64 KiB is fixed JSON
envelope allowance for field names, quotes, punctuation, numeric rendering,
revision/file/language metadata, and at most 256 fragment objects; it is not
fragment payload capacity. A known larger `Content-Length` returns HTTP 413
before decoding. The identical `http.MaxBytesReader` bound handles absent or
dishonest lengths and also returns 413 without analyzer invocation.

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
#[serde(rename_all = "camelCase")]
pub struct PromptTextPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextRange {
    pub start: PromptTextPosition,
    pub end: PromptTextPosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextOffsetRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextDocumentRevision {
    pub open_epoch: u64,
    pub version: i64,
    pub source_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PromptTextAnalysisStatus {
    Complete,
    Truncated,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextLimits {
    pub max_source_bytes: u32,
    pub max_templates: u32,
    pub max_template_bytes: u32,
    pub max_traversal_nodes: u32,
    pub max_output_bytes: u32,
    pub max_fragments: u32,
    pub max_fragment_bytes: u32,
    pub max_fragment_depth: u32,
    pub max_preview_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextFragment {
    pub id: String,
    pub symbol: String,
    pub file: String,
    pub source_hash: String,
    pub range: PromptTextRange,
    pub snippet: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextQueryRequest {
    pub protocol_version: u16,
    pub file: String,
    pub language_id: String,
    pub revision: PromptTextDocumentRevision,
    pub source: String,
    pub fragments: Vec<PromptTextFragment>,
    pub limits: PromptTextLimits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextWorkerRequest {
    pub id: u64,
    pub method: String,
    pub query: PromptTextQueryRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextLiteralIsland {
    pub index: u32,
    pub range: PromptTextRange,
    pub projection_length: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextInterpolationBarrier {
    pub index: u32,
    pub range: PromptTextRange,
    pub expression_range: PromptTextRange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextSourceMapping {
    pub island: u32,
    pub projection_range: PromptTextOffsetRange,
    pub source_range: PromptTextRange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
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
    rename_all_fields = "camelCase"
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
    rename_all_fields = "camelCase"
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
    rename_all_fields = "camelCase"
)]
pub enum PromptTextNodeRef {
    Block { index: u32 },
    Span { index: u32 },
    Link { index: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextNesting {
    pub parent: PromptTextNodeRef,
    pub child: PromptTextNodeRef,
    pub ordinal: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PromptTextPreviewSegment {
    AuthoredLiteral {
        text: String,
        range: PromptTextRange,
    },
    KnownValue {
        text: String,
        interpolation: u32,
    },
    Fragment {
        text: String,
        fragment_id: String,
        source_hash: String,
    },
    Placeholder {
        text: String,
        interpolation: u32,
    },
    Truncation {
        text: String,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextPreview {
    pub text: String,
    pub segments: Vec<PromptTextPreviewSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct PromptTextQueryResponse {
    pub protocol_version: u16,
    pub file: String,
    pub revision: PromptTextDocumentRevision,
    pub status: PromptTextAnalysisStatus,
    pub templates: Vec<PromptTextTemplate>,
}
```

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

Rust may render only:

- literal chunks;
- known finite number, string, nullish, and false values;
- visible arrays of safe known values;
- proven local or named fragments within traversal limits; and
- canonical `md.json` over inert literal JSON without spreads, getters, or
  calls.

Every unknown becomes a visible bounded placeholder. Preview never imports
modules, executes callbacks/getters/functions, parses schemas, reads the
environment, accesses the network, invokes tools, or performs arbitrary JSON
serialization.

Runtime and Rust preview share golden fixtures for normalization, placement,
seams, arrays, JSON, fragments, and placeholders. Disagreement is a blocker.
