---
"@use-crux/core": minor
"@use-crux/openai": minor
"@use-crux/google": major
"@use-crux/indexer": minor
"@use-crux/local": minor
"@use-crux/devtools": minor
---
Add eagerly executing, replayable `streamImage()` and `streamSpeech()` bounded
operations with provider-neutral events, final-result identity, cancellation,
deadlines, routing commitment, observability, and input/output Safety.

OpenAI uses genuine Images API previews and Speech API response-body chunks.
Google uses current Interactions image deltas and finite Generate Content TTS
PCM chunks. Unsupported models and controls fail before provider I/O; Crux
never synthesizes progressive events from a completed artifact or persists
media implicitly.

Project Index now recognizes both operations as authored media work with
static, semantic, native, and Local read-model parity. Catalog classifies them
as bounded streams with safe modality/support/source facts. Runs separates one
logical operation from its physical attempts and presents payload-free
progress, route commitment, timing, terminal, and output-media Safety facts.

`@use-crux/google` now requires `@google/genai` 2.x. This peer migration is a
breaking install change because the removed 1.x Interactions event schema is no
longer accepted.
