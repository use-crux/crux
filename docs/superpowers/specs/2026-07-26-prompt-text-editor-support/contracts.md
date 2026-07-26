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

Heading `range` contains the complete construct, including `#` markers and
trailing authored content. `textRange` contains only the parser-proven heading
text. Go and VS Code must never derive either range from the other.

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
