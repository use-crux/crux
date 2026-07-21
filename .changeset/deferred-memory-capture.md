---
'@use-crux/core': minor
'@use-crux/convex': patch
'@use-crux/indexer': minor
'@use-crux/local': minor
'@use-crux/otel': minor
---

Memory capture now follows the active execution lifecycle automatically.

Capture modes are now `inline | deferred`, with `deferred` as the default. Deferred capture uses the shared `config({ host })` retention binding; when retention is unavailable, Crux safely captures inline and emits one development warning instead of losing work. Retained failures remain observable through `memory.flush()`.

Adapters submit one completed turn and leave mode selection, deterministic tool-event fan-out, settlement, and block flushing to memory. Catalog exposes the effective configured mode, while Runs records one payload-free `memory.capture` lifecycle inside the owning generation Run with the actual inline, fallback, retained, or Eval-captured disposition.

Migrate `afterResponse` to `deferred`, replace `detached` with `deferred`, and remove memory-specific `capture.waitUntil` in favor of a shared host binding.
