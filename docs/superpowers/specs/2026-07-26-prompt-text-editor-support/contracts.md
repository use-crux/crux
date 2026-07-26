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

## Best available view

The Go boundary is request-relative:

```go
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
- evidence level; and
- semantic source-profile hash.

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
