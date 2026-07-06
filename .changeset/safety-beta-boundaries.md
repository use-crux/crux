---
"@use-crux/core": minor
"@use-crux/ai": patch
"@use-crux/devtools": patch
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Promote Safety to its stable beta boundary model. Guardrails and constraints now author through `{ id, on, run }` with typed `boundary.*` targets, duplicate policy ids fail fast, `safety.tune` controls per-call posture, structured-output rewrites keep returned text/object synchronized, and Safety audit/error/observability records are safe-by-default.

Streaming guardrails now protect ordinary output streams by default through sentence-gated checks, explicit final/disabled modes, bounded hold behavior, and the AI SDK stream bridge preserves policy-terminal completion errors without unhandled rejections.

Add the provider-agnostic Safety strategy pack (`guardrail.pii`, `guardrail.secrets`, `guardrail.injection`, `guardrail.classifier`, `constraint.judge`, `constraint.citations`, and `toolPolicy.*`), Project Index Safety facts/lints, Devtools Safety intervention surfacing, and updated docs with migration notes plus beta roadmap RFC links.
