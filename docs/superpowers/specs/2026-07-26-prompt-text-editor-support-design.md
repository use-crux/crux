# PromptText editor support

Status: **approved for implementation planning**

Tracking: [#271](https://github.com/use-crux/crux/issues/271)

Related: [#242](https://github.com/use-crux/crux/issues/242),
[#266](https://github.com/use-crux/crux/issues/266),
[#270](https://github.com/use-crux/crux/issues/270),
[#276](https://github.com/use-crux/crux/issues/276), and
[#277](https://github.com/use-crux/crux/issues/277)

Detailed references:

- [Contracts](./2026-07-26-prompt-text-editor-support/contracts.md)
- [Delivery](./2026-07-26-prompt-text-editor-support/delivery.md)

## Summary

Add editor support for `md` PromptText without introducing a second language
server, TypeScript service, renderer, index, or workspace evaluator.

The initial release combines:

- transient current-buffer Rust/Oxc analysis for template syntax, Markdown
  structure, folding, and safe static preview;
- saved semantic Project Index evidence for canonical Core identity,
  ownership, navigation, and construction diagnostics;
- mapped VS Code decorations for additive Markdown presentation without
  competing with native TypeScript semantic tokens; and
- Devtools and the Runtime Bridge for explicit exact preview and captured Runs.

The same consumers later accept #266 client-private dirty semantic views
through a request-relative `ViewProvider`.

## Product contract

The initial release covers every initial acceptance item in #271. The later
live-semantic upgrade is excluded.

Recognized PromptText gains:

- Markdown decoration of literal regions;
- folding, headings, and literal Markdown links;
- native TypeScript behavior inside every interpolation;
- canonical ownership and fragment navigation;
- the three construction diagnostics already owned by #270;
- evidence-gated fixes and an explicit byte-preserving string refactor;
- safe static preview in a read-only editor document;
- explicit exact preview in Devtools; and
- navigation to the latest captured Run.

Ordinary strings retain their current support. PromptText remains a composition
primitive, not compiled Markdown or an encoding/security API.

## Binding decisions

### Highlighting transport

Prove mapped `TextEditorDecorationType` ranges first.

Do not add a TextMate injection or Crux semantic-token provider. Lexical
grammars cannot prove aliases, re-exports, or shadowing, while another semantic
provider risks competing with TypeScript. Decorations are additive, reversible,
and leave the document language unchanged.

There is no syntax-only highlighting fallback in the initial release.
Canonical identity must be current and proven. Folding and explicitly labelled
static preview may still operate on lexical candidates.

The feasibility spike must prove:

- direct, aliased, namespace, and resolvable re-exported canonical tags;
- fail-closed local, shadowed, unrelated, ambiguous, cyclic, type-only,
  remapped-lookalike, and unresolved cases;
- literal-only ranges around multiline and nested interpolations;
- unchanged TypeScript semantic tokens and interpolation features;
- CRLF, Unicode, comments, and adjacent Markdown delimiters;
- Dark+, Light+, High Contrast Dark, and High Contrast Light;
- semantic highlighting enabled and disabled;
- theme changes without reload and immediate clearing through an off switch;
- legible selection, diagnostics, cursor, and role distinctions; and
- no stale or cancelled ranges.

If mapped decorations visibly flicker or cannot meet the theme bar without
fixed colors, stop for architecture review. Do not silently fall back.

### Markdown ownership

Rust owns production Markdown classification:

```text
syntax-oxc
  TypeScript source -> literal islands, interpolation barriers, source mappings

static-compiler/prompt_text
  projected islands -> normalized Markdown structure and static preview

protocol
  versioned AST-free response

Go
  identity join, policy, LSP projections, decoration payload

VS Code
  decoration roles -> ThemeColor and font styles
```

Keep the classifier as a private, crate-shaped module inside
`crates/static-compiler` initially. It has one consumer. It exposes one small
input/output boundary, keeps its parser dependency private, and owns independent
fixtures and benchmarks. Extract a crate if another consumer appears or
measurements show material incremental-build benefit.

Folding, symbols, links, decoration roles, and preview derive from one
normalized analysis per document revision. No consumer reparses Markdown.

### Preview surfaces

- `crux.promptText.previewStatic` opens a reusable read-only
  `crux-prompt-preview:` Markdown virtual document beside the source.
- `crux.promptText.previewExact` opens the owning Devtools exact-preview route.
- `crux.promptText.openLatestRun` resolves and opens the latest owning Run
  Detail at click time, or the Catalog owner's empty state.

There is no custom VS Code webview.

The virtual document contains only preview bytes. Label, source identity,
evidence level, and truncation use non-document UI so copying preserves exact
output.

Devtools owns exact-preview inputs, runtime selection, validation display, and
the explicit Preview action. The active application runtime invokes canonical
Core inspection through an advertised Runtime Bridge capability. Opening UI,
editing input, saving, or opening a panel never executes code. There is no
fallback workspace evaluation.

## Architecture

### Shared document state

Generalize the bounded open-document buffer from completion-only use to
transient compiler queries. It remains the single owner of URI, language, open
epoch, LSP version, source hash, UTF-16 edits, byte limits, and cleanup.
PromptText must not retain another copy of editor text.

### Transient analysis

One persistent-worker query performs tolerant current-buffer analysis. It is
cache-bypassing, cancellable, memory-only, and never enters Static Index stages.

It returns a discriminated `complete`, `truncated`, or `unsupported` result.
Malformed Markdown returns whatever is provable and never creates a Crux
diagnostic. Parser AST objects never cross the module boundary.

The normalized result carries template ranges, literal islands, interpolation
barriers, source mappings, blocks, spans, links, nesting, and static preview
segments. All coordinates are zero-based UTF-16.

### Analysis coordination

A client-session coordinator coalesces concurrent requests by:

```text
scope and source epoch
+ open epoch, document version, source hash
+ selected view revision
+ fragment-catalogue digest
```

It cancels superseded work, retains only the latest bounded result, and never
mutates the saved Store.

OWN mode calls the existing compiler process. ATTACHED mode uses a private
local-runtime HTTP query with the same contract. One transient source interface
owns completion and PromptText capabilities so ATTACHED/OWN lifecycle logic is
not duplicated.

### Best available view

`ViewProvider` selects one coherent immutable view relative to a request. It is
client-session-owned and does not mutate the saved Store or reuse runtime
registration overlays.

The saved provider retains the Store and captures one detached publication
under the Store read lock for every request. It does not mirror Store state in
a separately replaced immutable publication.

The saved view is exact when its source hash equals the buffer, including after
an edit returns to saved bytes. A future dirty view must match session, scope,
base generation, source profile, open epochs, versions, hashes, evidence, and
overlay revision.

Saved fallback permits editor-relative byte mismatch but never evidence
downgrade. Pending, cancelled, incomplete, older-document, or old-generation
dirty results are never fallback evidence. See the exact contract in
[Contracts](./2026-07-26-prompt-text-editor-support/contracts.md).

Semantic source-profile identity is private validation state for future dirty
views. It is not stored on saved views, persisted in Project Index data, or
derived from saved source rows.

## Feature evidence

| Feature                          | Transient analysis    | View request                           | Unavailable behavior          |
| -------------------------------- | --------------------- | -------------------------------------- | ----------------------------- |
| Folding                          | Required              | Optional                               | Proven lexical structure only |
| Static preview                   | Required              | Optional; semantic for fragments/owner | Preserve placeholders         |
| Decorations                      | Required              | Semantic, current                      | Clear immediately             |
| Symbols and links                | Required              | Semantic, current                      | Return none                   |
| Construction diagnostics/actions | Exact range mapping   | Semantic, current                      | Suppress                      |
| Ownership/fragment navigation    | Barrier/range support | Semantic, saved fallback               | Existing range transforms     |
| Hover metadata                   | Literal/block support | Semantic, saved fallback               | Omit unavailable details      |
| Exact preview/latest Run         | Selection support     | Current canonical owner                | Unavailable state             |

Crux returns no identity-sensitive feature inside an interpolation. TypeScript
remains authoritative for completion, hover, definition, rename, diagnostics,
brackets, and selection there.

## Client and LSP behavior

Standard LSP methods serve folding ranges, document symbols, document links,
diagnostics, hovers, definitions, references, and code actions.

A narrow versioned Crux request returns identity-filtered decoration roles and
ranges. A dedicated VS Code PromptText controller owns scheduling, staleness,
themes, settings, and cleanup separately from inline diagnostic decorations.
An exhaustive `Record<Role, DecorationType>` makes missing mappings a type
error.

Rust reports literal link destinations. Go allows bounded workspace-relative
files and safe web schemes. It rejects command/script/data schemes, malformed
destinations, and paths outside the active scope. Resolution never reads or
executes targets.

## Failure, privacy, and performance

Passive providers fail softly. Cancellation, timeout, unavailable worker,
unsupported syntax, missing identity, and stale results preserve normal
TypeScript behavior. Explicit preview may present bounded unavailable or
truncated states.

Source, snippets, expressions, placeholders, and preview output never enter
logs, traces, metrics, errors, caches, snapshots, broadcasts, or Devtools.
Telemetry is limited to hashed URI, counts, sizes, duration, revisions,
evidence level, result category, and stable reason.

Centralized limits cover source bytes, candidate count, projected bytes,
fragment count/depth, Markdown nodes, preview bytes, and duration. Truncation
is explicit; silent partial preview is forbidden.

## Success criteria

The implementation succeeds when:

- Markdown presentation is additive and never displaces TypeScript;
- canonical identity is fail-closed across aliases and re-exports;
- one current analysis drives every Markdown-derived feature;
- stale semantic evidence never produces decoration, diagnostics, or edits;
- static preview is visibly approximate and executes nothing;
- exact preview requires explicit runtime action;
- saved navigation remains useful before #266;
- caches and other sessions never observe dirty bytes; and
- a future dirty view changes evidence selection, not feature contracts.
