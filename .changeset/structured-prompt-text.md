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

`prompt.prompt` stays synchronous: callbacks return `string | PromptText`.
Runtime now rejects Promise results from untyped or cast async callbacks instead
of awaiting this unsupported shape, matching the existing synchronous public
type. An unconfigured user prompt stays absent through provider adaptations.
Context staticness follows `systemKind`, so inputless dynamic callbacks are
neither executed nor classified static during serialization or indexing.
Direct `ContextSystemContent` and `PromptText` use the static provider-cache
lifecycle, like direct strings.
