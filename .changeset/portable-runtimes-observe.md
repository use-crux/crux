---
"@use-crux/ai": minor
"@use-crux/core": minor
"@use-crux/convex": patch
"@use-crux/indexer": major
"@use-crux/next": minor
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

Add daemon-free `crux manifest` artifact generation and verified, idempotent
`crux catalog import`. Local observability now resolves runtime definition
references only against the exact immutable deployment manifest named by a run
and labels current-checkout comparisons separately.
Definition fingerprints now use normalized project-relative source identity so
identical checkouts produce the same manifest ID; static, semantic, and Go
snapshot cache epochs invalidate root-dependent historical fingerprints.

Add deterministic `crux catalog` list, show, status, and explain projections
with compiler provenance, safe source paths, Health/Quality/runtime joins, and
truthful partial or unknown state. The beta `crux index` list/show paths now
delegate to Catalog while category keywords and explicit reindex remain.
Durable definition evidence now retains canonical extractor and resolved
extension provenance, and Catalog explanations name every actual contributor
without changing the public evidence shape or phase producer identity.
Durable relation, source-reference, and diagnostic evidence now retains the
same exact extractor contributors across worker, cache, and restart boundaries.

Add opinionated `withCrux` lifecycle boundaries for Cloudflare Workers and
Next.js while retaining their low-level adapters. Workers and Next now compose
deferred work with contained, bounded post-response observability drains;
`createCruxConvex().run()` owns the corresponding bounded terminal drain and
preserves deployment identity across durable continuation boundaries.
Rejected promises returned by advisory drain reporters are contained without
delaying or replacing handler results or host-owned drain work.
Portable MCP entrypoints now fail closed when stdio is selected, while Node
runtimes resolve their lazy stdio adapters through private conditional imports.

Align public documentation around Catalog, Runs, Quality, and Health. Narrow
the published Indexer root to Crux-owned compiler contracts; third-party
authoring stays on the experimental `/extensions` subpath and is declarative,
limited to extractors plus relation declarations.
