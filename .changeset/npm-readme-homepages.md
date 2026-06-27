---
'@use-crux/core': patch
'@use-crux/ai': patch
'@use-crux/openai': patch
'@use-crux/anthropic': patch
'@use-crux/google': patch
'@use-crux/react': patch
'@use-crux/convex': patch
'@use-crux/upstash': patch
'@use-crux/otel': patch
'@use-crux/ingest': patch
'@use-crux/indexer': patch
'@use-crux/local': patch
---

Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

Document the single-turn provider bundle authoring path in adapter package READMEs.
