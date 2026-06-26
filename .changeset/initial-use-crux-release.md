---
'@use-crux/core': minor
'@use-crux/ai': minor
'@use-crux/anthropic': minor
'@use-crux/convex': minor
'@use-crux/google': minor
'@use-crux/indexer': minor
'@use-crux/ingest': minor
'@use-crux/local': minor
'@use-crux/openai': minor
'@use-crux/otel': minor
'@use-crux/react': minor
'@use-crux/upstash': minor
---

Prepare the first npm release under the `@use-crux` package scope.

Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
troubleshooting guidance.

Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
worker process is still running.
