---
'@use-crux/ai': minor
'@use-crux/core': patch
'@use-crux/convex': patch
'@use-crux/next': patch
'@use-crux/otel': patch
'@use-crux/react': patch
'@use-crux/upstash': patch
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
