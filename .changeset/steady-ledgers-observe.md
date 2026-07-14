---
"@use-crux/ai": patch
"@use-crux/core": patch
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Restore observability configuration across bundled server module copies, retain
configured Quality experiment history across `crux dev` restarts, and reconcile
abandoned activity without treating it as currently running.

Also harden Quality cassette identity and failure replay, preserve provider
model metadata and grounded prompt types, and make omitted Static Index
configuration use the documented default.
