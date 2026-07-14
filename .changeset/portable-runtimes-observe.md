---
"@use-crux/ai": minor
"@use-crux/core": minor
"@use-crux/convex": patch
"@use-crux/next": patch
"@use-crux/otel": minor
"@use-crux/local": minor
"@use-crux/react": patch
"@use-crux/upstash": patch
---

Make portable application entrypoints verifiable in both source and staged npm
packages, remove package-wide Node engine restrictions where the primary graph
is portable, and include the Next integration in TypeScript release staging.

The `@use-crux/ai` root no longer downloads HTTPS transcription input
implicitly. Portable callers must provide materialized audio; Node callers can
import `transcribe` or `createAiSdkTranscribe` from the new
`@use-crux/ai/transcription/node` subpath to retain the bounded, DNS-pinned
download behavior. Portable data-URL transcription no longer relies on the
Node `Buffer` global.

Unify observability and host-lifecycle async scoping on Core's canonical
carrier so no-AsyncLocalStorage runtimes retain synchronous fallback behavior
while unsafe asynchronous ambient host scopes fail closed.

Add portable deployment identity and privacy-safe Project Index manifest
contracts to Core. The build-time Indexer now projects and verifies the same
deterministic artifact internally.

Carry immutable deployment identity through v3 observability graph records,
suspend/resume propagation, and local run detail while retaining persisted v2
reads as deployment-unspecified. `@use-crux/otel` now exports a portable
Resource-attribute mapper, maps lightweight identity per span, and projects
DefinitionRefs through bounded attributes and events.

Add daemon-free `crux check` with deterministic JSON and explicit CI exit
codes. `crux lint` now uses the same one-shot Project Index service and embedded
worker pipeline by default while retaining its no-gate compatibility behavior
and an explicit `--server` path.
