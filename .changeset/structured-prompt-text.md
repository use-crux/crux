---
"@use-crux/core": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
---

Add optional Markdown-oriented prompt composition with `md`, the opaque
`PromptText` type, and explicit `md.json()` snapshots. Existing strings remain
fully supported. Resolution still yields provider-neutral plain text;
`.inspect()` retains structural provenance for PromptText, and Project Index
records compiler-proven `md` regions with exact source ranges and
direct-versus-callback lifecycle metadata.

Export `configure`, `ConfigureOptions`, and `PromptRegistry` from the Core root
and let that explicit registry lifecycle publish a revisioned Prompt catalogue
for local exact inspection. Explicit preview dispatch invokes
`Prompt.inspect()` only; it creates no provider generation, tool invocation,
ordinary Run, or observability record. Trusted authored callbacks may still
perform their own side effects.

Project Index PromptText evidence now classifies every canonical source as an
owner, named fragment, or anonymous fragment, retains exact semantic fragment
joins, and emits conservative diagnostics for invalid interpolations, inline
sequences, and `md.json()` calls proven to return no text. JavaScript and
native semantic backends produce the same backend-neutral evidence.

`prompt.prompt` stays synchronous: callbacks return `string | PromptText`.
Runtime now rejects Promise results from untyped or cast async callbacks instead
of awaiting this unsupported shape, matching the existing synchronous public
type. An unconfigured user prompt stays absent through provider adaptations.
Context staticness follows `systemKind`, so inputless dynamic callbacks are
neither executed nor classified static during serialization or indexing.
Direct `ContextSystemContent` and `PromptText` use the static provider-cache
lifecycle, like direct strings.

Devtools now presents PromptText compiler evidence and hard diagnostics in
Catalog, shows structured exact-preview composition and validation, and keeps
PromptText segment provenance plus token attribution in ordinary captured Runs
when input capture policy permits it. Local persists that evidence through the
existing messages artifact; malformed or unavailable provenance falls back to
the ordinary plain-text Run Detail presentation.
