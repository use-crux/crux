---
"@use-crux/core": minor
"@use-crux/local": minor
"@use-crux/ai": minor
"@use-crux/cloudflare": minor
"@use-crux/convex": minor
"@use-crux/devtools": minor
"@use-crux/indexer": minor
"@use-crux/anthropic": patch
"@use-crux/google": patch
"@use-crux/mcp": patch
"@use-crux/openai": patch
---
Replace the pre-release Quality authoring, execution, CLI, storage, and
Devtools model with Crux Evals V1. Applications now bind ordinary callable
production tasks with `generate.task()` or `stream.task()`, define inert typed
Cases and Variants through `@use-crux/core/eval`, run them with `crux eval`,
reuse exact safe evidence automatically, and explicitly accept complete Eval
run arms as Baselines. The old `@use-crux/core/quality` exports and
`crux quality` commands are removed without compatibility aliases.

Add Runtime-hosted Eval execution with generated identity-only registries,
strict offline and pre-spend planning, Node/serverless/Convex conformance, and
the first-party `@use-crux/cloudflare` Durable Object host. Add awaited
run-linked feedback through `@use-crux/core/feedback` and AI message metadata
through `@use-crux/ai/feedback`, plus durable Review and explicit Add-to-eval
workflows in Crux Local and Devtools.
